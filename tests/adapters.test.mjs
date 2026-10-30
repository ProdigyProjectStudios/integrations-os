import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./database.mjs";
import { workspaceFor, one } from "../core/store.mjs";
import { saveTokens, notifySlack, synchronize } from "../core/adapters.mjs";
import { toOtlp } from "../core/telemetry.mjs";
const env = {
  TOKEN_ENCRYPTION_KEY: "test-only-random-encryption-material-32-chars",
};
test("unconfirmed Slack responses are never treated as successful deliveries", async () => {
  const db = database();
  const ws = await workspaceFor(db, "alice");
  await saveTokens(db, env, ws, "slack", { access_token: "fake-token" });
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(
      notifySlack(
        db,
        env,
        { id: "e1", workspace_id: ws, traceparent: "test" },
        { company: "Acme", value: 1200 },
        { channel: "C1", message: "test" },
      ),
      /did not confirm/,
    );
    globalThis.fetch = async () =>
      Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": "20" } },
      );
    await assert.rejects(
      notifySlack(
        db,
        env,
        { id: "e1", workspace_id: ws, traceparent: "test" },
        { company: "Acme", value: 1200 },
        { channel: "C1", message: "test" },
      ),
      (e) => e.retryable === true && e.retryAfterMs === 20000,
    );
  } finally {
    globalThis.fetch = previous;
    db.close();
  }
});
test("live Slack adapter reads encrypted credentials and sends a correlated request", async () => {
  const db = database();
  const ws = await workspaceFor(db, "alice");
  await saveTokens(db, env, ws, "slack", { access_token: "fake-test-token" });
  const stored = await one(
    db,
    "SELECT encrypted_tokens FROM connections WHERE workspace_id=? AND provider='slack'",
    ws,
  );
  assert.ok(!stored.encrypted_tokens.includes("fake-test-token"));
  const previous = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return Response.json({ ok: true, ts: "123.45", channel: "C0123" });
  };
  try {
    const receipt = await notifySlack(
      db,
      env,
      {
        id: "execution-1",
        workspace_id: ws,
        traceparent: "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01",
      },
      { company: "Meridian", value: 1000 },
      { channel: "C0123", message: "{{company}}: {{value}}" },
    );
    assert.equal(receipt.mode, "live");
    assert.equal(captured.url, "https://slack.com/api/chat.postMessage");
    assert.equal(
      captured.options.headers.Authorization,
      "Bearer fake-test-token",
    );
    assert.match(captured.options.headers.traceparent, /^00-/);
    const body = JSON.parse(captured.options.body);
    assert.equal(body.text, "Meridian: 1000");
    assert.equal(body.client_msg_id, "execution-1");
    assert.equal(body.mrkdwn, false);
  } finally {
    globalThis.fetch = previous;
    db.close();
  }
});
test("provider read persists a bounded, metadata-only synchronization result", async () => {
  const db = database();
  const ws = await workspaceFor(db, "alice");
  await saveTokens(db, env, ws, "gmail", { access_token: "fake-token" });
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ messages: [{ id: "one" }, { id: "two" }] });
  try {
    const summary = await synchronize(db, env, ws, "gmail");
    assert.equal(summary.count, 2);
    assert.equal(summary.pageLimited, true);
    const stored = await one(
      db,
      "SELECT summary FROM connections WHERE workspace_id=? AND provider='gmail'",
      ws,
    );
    assert.equal(JSON.parse(stored.summary).count, 2);
    assert.ok(!stored.summary.includes("one"));
  } finally {
    globalThis.fetch = previous;
    db.close();
  }
});
test("OTLP export preserves hierarchy, timing, status and correlation without event payloads", () => {
  const trace = "a".repeat(32);
  const result = toOtlp({ id: "e1", mode: "sandbox" }, [
    {
      id: "b".repeat(16),
      trace_id: trace,
      parent_id: null,
      name: "workflow.execute",
      service: "orchestrator",
      attempt: 1,
      started_at: 1000,
      ended_at: 1100,
      status: "success",
    },
    {
      id: "c".repeat(16),
      trace_id: trace,
      parent_id: "b".repeat(16),
      name: "slack.deliver",
      service: "slack",
      attempt: 1,
      started_at: 1010,
      ended_at: 1090,
      status: "error",
      error: "Rate limit",
    },
  ]);
  const spans = result.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans[1].parentSpanId, spans[0].spanId);
  assert.equal(spans[1].traceId, trace);
  assert.equal(spans[1].status.code, 2);
  assert.equal(spans[0].startTimeUnixNano, "1000000000");
  assert.equal(spans[1].kind, 3);
});
