import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./database.mjs";
import {
  workspaceFor,
  execute,
  one,
  all,
  defaultConfig,
} from "../core/store.mjs";
import {
  enqueue,
  processExecution,
  validatePayload,
  validateConfig,
} from "../core/engine.mjs";
import { handleApi } from "../core/api.mjs";
import {
  AppError,
  hash,
  redact,
  seal,
  unseal,
  verifyWebhook,
} from "../core/security.mjs";
const payload = { company: "Meridian Estates", value: 4800, region: "UK" };
const options = { sleep: async () => {} };
test("action endpoints consume bounded request bodies and reject oversized input", async () => {
  const { db } = await setup();
  const req = new Request(
    "https://integration.test/api/connections/gmail/sync",
    {
      method: "POST",
      headers: { Origin: "https://integration.test" },
      body: "{}",
    },
  );
  const response = await handleApi(
    req,
    { DB: db },
    { userId: "alice", email: "alice@example.test" },
    () => {},
  );
  assert.equal(response.status, 200);
  assert.equal(req.bodyUsed, true);
  assert.equal((await response.json()).mode, "sandbox");
  assert.equal(
    (
      await request(db, "connections/gmail/sync", {
        method: "POST",
        body: { oversized: "x".repeat(70000) },
      })
    ).status,
    413,
  );
  assert.equal(
    (await request(db, "executions", { method: "POST", body: null })).status,
    400,
  );
  db.close();
});
test("repeated safe-replay requests reuse one linked execution", async () => {
  const { db, ws } = await setup();
  const original = await enqueue(db, ws, "alice", payload, "replay-source");
  await execute(
    db,
    "UPDATE executions SET status='failed',finished_at=? WHERE id=?",
    Date.now(),
    original.id,
  );
  const a = await request(db, `executions/${original.id}/replay`, {
    method: "POST",
    body: {},
    headers: { "Idempotency-Key": "click-one" },
  });
  const b = await request(db, `executions/${original.id}/replay`, {
    method: "POST",
    body: {},
    headers: { "Idempotency-Key": "click-two" },
  });
  assert.equal(a.status, 202);
  assert.equal(a.data.id, b.data.id);
  assert.equal(
    (await all(db, "SELECT * FROM executions WHERE replay_of=?", original.id))
      .length,
    1,
  );
  db.close();
});
async function setup() {
  const db = database();
  return { db, ws: await workspaceFor(db, "alice") };
}
async function get(db, id) {
  return one(db, "SELECT * FROM executions WHERE id=?", id);
}
async function request(
  db,
  path,
  {
    method = "GET",
    body,
    user = "alice",
    origin = "https://integration.test",
    headers = {},
    env = {},
  } = {},
) {
  const background = [];
  const result = await handleApi(
    new Request("https://integration.test/api/" + path, {
      method,
      headers: { origin, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { DB: db, ...env },
    user ? { userId: user, email: user + "@example.test" } : null,
    (p) => background.push(p),
  );
  await Promise.allSettled(background);
  return { status: result.status, data: await result.json() };
}
test("concurrent worker claims result in one attempt and one delivery", async () => {
  const { db, ws } = await setup();
  const e = await enqueue(db, ws, "alice", payload, "event-one");
  const results = await Promise.all([
    processExecution(db, {}, e, options),
    processExecution(db, {}, e, options),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal((await get(db, e.id)).attempts, 1);
  assert.equal((await get(db, e.id)).status, "success");
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 1);
  const spans = await all(db, "SELECT * FROM spans WHERE execution_id=?", e.id);
  assert.equal(spans.length, 8);
  assert.ok(
    spans.every((s) => s.ended_at >= s.started_at && s.trace_id === e.trace_id),
  );
  assert.equal(spans.filter((s) => !s.parent_id).length, 1);
  db.close();
});
test("idempotency reuses an execution and rejects a conflicting payload", async () => {
  const { db, ws } = await setup();
  const first = await enqueue(db, ws, "alice", payload, "stable-key");
  assert.equal(
    (await enqueue(db, ws, "alice", payload, "stable-key")).id,
    first.id,
  );
  await assert.rejects(
    enqueue(db, ws, "alice", { ...payload, value: 10 }, "stable-key"),
    /different payload/,
  );
  // The graph upgrade preserves idempotent events created by the first release.
  await execute(
    db,
    "UPDATE executions SET payload_hash=? WHERE id=?",
    await hash(
      JSON.stringify({ payload, scenario: "success", mode: "sandbox" }),
    ),
    first.id,
  );
  assert.equal(
    (await enqueue(db, ws, "alice", payload, "stable-key")).id,
    first.id,
  );
  db.close();
});
test("concurrent duplicate ingestion creates exactly one row", async () => {
  const { db, ws } = await setup();
  const results = await Promise.all([
    enqueue(db, ws, "alice", payload, "race-key-1"),
    enqueue(db, ws, "alice", payload, "race-key-1"),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal((await all(db, "SELECT * FROM executions")).length, 1);
  db.close();
});
test("transient faults back off, preserve attempts, then deliver once", async () => {
  const { db, ws } = await setup();
  const e = await enqueue(db, ws, "alice", payload, "transient-key", {
    scenario: "transient",
  });
  await processExecution(db, {}, e, options);
  assert.equal((await get(db, e.id)).status, "retry_wait");
  assert.ok((await get(db, e.id)).next_at > Date.now());
  assert.equal(await processExecution(db, {}, e, options), false);
  await execute(db, "UPDATE executions SET next_at=0 WHERE id=?", e.id);
  await processExecution(db, {}, e, options);
  assert.equal((await get(db, e.id)).status, "success");
  assert.equal((await get(db, e.id)).attempts, 2);
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 1);
  db.close();
});
test("persistent faults exhaust retry budget and become dead letters", async () => {
  const { db, ws } = await setup();
  const e = await enqueue(db, ws, "alice", payload, "failure-key", {
    scenario: "failure",
  });
  for (let i = 0; i < 3; i++) {
    await execute(db, "UPDATE executions SET next_at=0 WHERE id=?", e.id);
    await processExecution(db, {}, e, options);
  }
  assert.equal((await get(db, e.id)).status, "failed");
  assert.equal((await get(db, e.id)).attempts, 3);
  assert.equal(await processExecution(db, {}, e, options), false);
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 0);
  db.close();
});
test("a value below the configured threshold records a filtered trace without delivery", async () => {
  const { db, ws } = await setup();
  const e = await enqueue(
    db,
    ws,
    "alice",
    { ...payload, value: 10 },
    "filtered-key",
  );
  await processExecution(db, {}, e, options);
  assert.equal((await get(db, e.id)).status, "skipped");
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 0);
  db.close();
});
test("workflow updates do not change the snapshot of queued runs", async () => {
  const { db, ws } = await setup();
  const e = await enqueue(db, ws, "alice", payload, "snapshot-key");
  await execute(
    db,
    "UPDATE workflows SET config=?,version=2 WHERE workspace_id=?",
    JSON.stringify({ ...defaultConfig, minimumValue: 100000 }),
    ws,
  );
  await processExecution(db, {}, e, options);
  assert.equal((await get(db, e.id)).status, "success");
  assert.equal((await get(db, e.id)).workflow_version, 1);
  db.close();
});
test("lease recovery reuses a confirmed receipt instead of repeating an external action", async () => {
  const { db, ws } = await setup();
  const e = await enqueue(db, ws, "alice", payload, "recovery-key");
  await execute(
    db,
    "UPDATE executions SET status='running',lease_until=0,attempts=1 WHERE id=?",
    e.id,
  );
  await execute(
    db,
    "INSERT INTO deliveries (id,execution_id,status,receipt,updated_at) VALUES (?,?,?,?,?)",
    e.id + ":slack",
    e.id,
    "delivered",
    JSON.stringify({ mode: "sandbox", receipt: "previous-receipt" }),
    Date.now(),
  );
  await processExecution(db, {}, e, options);
  assert.equal((await get(db, e.id)).status, "success");
  const span = await one(
    db,
    "SELECT output FROM spans WHERE execution_id=? AND name='slack.deliver'",
    e.id,
  );
  assert.equal(JSON.parse(span.output).reused, true);
  db.close();
});
test("an uncertain external delivery stops in needs_review and cannot be replayed", async () => {
  const { db, ws } = await setup();
  await execute(
    db,
    "UPDATE workflows SET config=? WHERE workspace_id=?",
    JSON.stringify({ ...defaultConfig, mode: "live" }),
    ws,
  );
  const e = await enqueue(db, ws, "alice", payload, "uncertain-key");
  await processExecution(db, {}, e, {
    ...options,
    notify: async () => {
      throw new AppError("Network timeout; outcome unknown.", 502);
    },
  });
  assert.equal((await get(db, e.id)).status, "needs_review");
  assert.equal(
    (await one(db, "SELECT status FROM deliveries WHERE execution_id=?", e.id))
      .status,
    "uncertain",
  );
  const response = await request(db, `executions/${e.id}/replay`, {
    method: "POST",
    body: {},
    headers: { "Idempotency-Key": "blocked-replay" },
  });
  assert.equal(response.status, 409);
  db.close();
});
test("workspace isolation prevents another user from reading or replaying a run", async () => {
  const { db, ws } = await setup();
  const e = await enqueue(db, ws, "alice", payload, "isolation-key");
  assert.equal(
    (await request(db, "executions/" + e.id, { user: "bob" })).status,
    404,
  );
  assert.equal(
    (
      await request(db, `executions/${e.id}/replay`, {
        user: "bob",
        method: "POST",
        body: {},
      })
    ).status,
    404,
  );
  assert.equal((await request(db, "snapshot", { user: null })).status, 401);
  db.close();
});
test("read-only roles and cross-origin writes are rejected by the API", async () => {
  const { db, ws } = await setup();
  await execute(
    db,
    "UPDATE members SET role='viewer' WHERE workspace_id=?",
    ws,
  );
  assert.equal(
    (await request(db, "seed", { method: "POST", body: {} })).status,
    403,
  );
  assert.equal(
    (
      await request(db, "seed", {
        method: "POST",
        body: {},
        origin: "https://attacker.test",
      })
    ).status,
    403,
  );
  db.close();
});
test("configuration uses optimistic versioning and validates server-side", async () => {
  const { db } = await setup();
  const body = { version: 1, config: { ...defaultConfig, minimumValue: 2500 } };
  assert.equal(
    (await request(db, "workflows", { method: "PUT", body })).status,
    200,
  );
  assert.equal(
    (await request(db, "workflows", { method: "PUT", body })).status,
    409,
  );
  assert.throws(() => validateConfig({ ...defaultConfig, maxAttempts: 100 }));
  assert.throws(() => validatePayload({ ...payload, value: Infinity }));
  db.close();
});
test("authenticated encryption detects tampering and prevents cross-workspace decryption", async () => {
  const secret = "random-test-encryption-key-with-32-characters";
  const ciphertext = await seal(
    { access_token: "test-secret" },
    secret,
    "workspace:slack",
  );
  assert.ok(!ciphertext.includes("test-secret"));
  assert.equal(
    (await unseal(ciphertext, secret, "workspace:slack")).access_token,
    "test-secret",
  );
  await assert.rejects(unseal(ciphertext, secret, "other:slack"));
  const altered = JSON.parse(ciphertext);
  altered.data[0] ^= 1;
  await assert.rejects(
    unseal(JSON.stringify(altered), secret, "workspace:slack"),
  );
});
test("redaction recursively removes credentials and personal contact details", () => {
  assert.deepEqual(
    redact({
      nested: [{ access_token: "secret", email: "private@example.com" }],
      text: "Bearer abc.def and alice@example.com",
    }),
    {
      nested: [{ access_token: "[REDACTED]", email: "[REDACTED]" }],
      text: "Bearer [REDACTED] and [REDACTED]",
    },
  );
});
test("webhook signatures reject stale timestamps, tampered bodies and wrong keys", async () => {
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const body = JSON.stringify(payload);
  const secret = "test-signing-secret";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(timestamp + "." + body),
    ),
  ).toString("hex");
  assert.equal(
    await verifyWebhook(secret, timestamp, signature, body, now),
    true,
  );
  assert.equal(
    await verifyWebhook(secret, timestamp, signature, body + "x", now),
    false,
  );
  assert.equal(
    await verifyWebhook(secret, timestamp, signature, body, now + 600000),
    false,
  );
  assert.equal(
    await verifyWebhook("wrong", timestamp, signature, body, now),
    false,
  );
});
