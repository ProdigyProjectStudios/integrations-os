import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { database } from "./database.mjs";
import {
  one,
  all,
  execute,
  workspaceFor,
  defaultConfig,
} from "../core/store.mjs";
import { hash, unseal } from "../core/security.mjs";
import { handleApi } from "../core/api.mjs";
import {
  recover,
  recoveryProbe,
  authorizeWorker,
  maintenanceStatus,
} from "../core/maintenance.mjs";
import { enqueue, processExecution, drain } from "../core/engine.mjs";
import { referenceGraph } from "../core/graph.mjs";
import {
  token,
  saveTokens,
  rotateCredentials,
  openTokens,
} from "../core/adapters.mjs";
import { syncPage, stageContact, resolveConflict } from "../core/sync.mjs";
import {
  backupWorkspace,
  readBackup,
  retentionPreview,
  applyRetention,
} from "../core/backup.mjs";
import { restoreBackup } from "../scripts/restore-backup.mjs";
import { exportTelemetry } from "../core/telemetry-export.mjs";
import { rateLimit } from "../core/limits.mjs";
import { webhookSecret } from "../core/operations.mjs";
import { handleMcp } from "../core/mcp.mjs";
const env = {
  TOKEN_ENCRYPTION_KEY: "test-only-encryption-key-123456789012345",
  SLACK_CLIENT_ID: "test",
  SLACK_CLIENT_SECRET: "test",
};
const payload = {
  company: "Production contract test",
  value: 4200,
  region: "UK",
};
const temp = fileURLToPath(
  new URL("../work/production-tests/", import.meta.url),
);
mkdirSync(temp, { recursive: true });
const freshFile = () => temp + crypto.randomUUID() + ".sqlite";
async function setup() {
  const db = database(),
    ws = await workspaceFor(db, "alice");
  return { db, ws };
}
async function request(
  db,
  path,
  body,
  user = "alice",
  workspace = "",
  extra = {},
) {
  return handleApi(
    new Request("https://integration.test/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: "https://integration.test",
        "Content-Type": "application/json",
        ...(workspace ? { "X-Workspace-Id": workspace } : {}),
        ...extra.headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { DB: db, ...extra.env },
    { userId: user, email: user + "@example.test" },
    () => {},
  );
}
test("service fingerprint authenticates recovery without visitor identity; expired checkpoint resumes", async () => {
  const { db } = await setup(),
    secret = "fake-platform-service-token",
    runtime = { DB: db, SITE_SERVICE_TOKEN_SHA256: await hash(secret) };
  await assert.rejects(
    authorizeWorker(new Request("https://app/api/worker"), runtime),
    /Unauthorized/,
  );
  await authorizeWorker(
    new Request("https://app/api/worker", {
      headers: { Authorization: "Bearer " + secret },
    }),
    runtime,
  );
  const probe = await recoveryProbe(db),
    before = await one(
      db,
      "SELECT * FROM node_results WHERE execution_id=? AND node_id='start'",
      probe.id,
    );
  const result = await recover(db, runtime, { sleep: async () => {} });
  assert.equal(result.lastWake.status, "success");
  assert.equal(result.queue.due, 0);
  const execution = await one(
    db,
    "SELECT * FROM executions WHERE id=?",
    probe.id,
  );
  assert.equal(execution.status, "success");
  assert.equal(execution.attempts, 2);
  assert.equal(execution.trace_id, probe.trace_id);
  const after = await one(
    db,
    "SELECT * FROM node_results WHERE execution_id=? AND node_id='start'",
    probe.id,
  );
  assert.equal(after.updated_at, before.updated_at);
  assert.equal(
    JSON.parse(
      (
        await one(
          db,
          "SELECT output FROM node_results WHERE execution_id=? AND node_id='finish'",
          probe.id,
        )
      ).output,
    ).recovery,
    "verified",
  );
  db.close();
});
test("hard process exit after a durable delivery does not repeat the side effect after recovery", async () => {
  const file = freshFile(),
    counter = file + ".receipts";
  let db = database(file);
  const ws = await workspaceFor(db, "crash-test");
  const e = await enqueue(db, ws, "test", payload, "hard-crash-recovery", {
    snapshot: { ...defaultConfig, mode: "live", graph: referenceGraph() },
  });
  db.close();
  const child = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./fixtures/crash-worker.mjs", import.meta.url)),
      file,
      e.id,
      counter,
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 23, child.stderr);
  db = database(file);
  await execute(db, "UPDATE executions SET lease_until=0 WHERE id=?", e.id);
  await processExecution(db, {}, e, {
    sleep: async () => {},
    notify: async () => {
      throw Error("delivery repeated");
    },
  });
  assert.equal(
    (await one(db, "SELECT status FROM executions WHERE id=?", e.id)).status,
    "success",
  );
  assert.equal(readFileSync(counter, "utf8"), "delivered\n");
  db.close();
});
test("refresh is fenced across callers and cannot resurrect a disconnected connection", async () => {
  const { db, ws } = await setup();
  await saveTokens(db, env, ws, "slack", {
    access_token: "old",
    refresh_token: "once",
    expires_in: 1,
  });
  const oldFetch = globalThis.fetch;
  let release,
    calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((r) => (release = r));
    return Response.json({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 3600,
    });
  };
  try {
    const first = token(db, env, ws, "slack");
    while (!release) await new Promise((r) => setTimeout(r, 1));
    await assert.rejects(
      token(db, env, ws, "slack"),
      (e) => e.retryable === true,
    );
    release();
    assert.equal(await first, "new");
    assert.equal(calls, 1);
    await saveTokens(db, env, ws, "slack", {
      access_token: "old",
      refresh_token: "once",
      expires_in: 1,
    });
    release = null;
    const second = token(db, env, ws, "slack");
    while (!release) await new Promise((r) => setTimeout(r, 1));
    await execute(
      db,
      "UPDATE connections SET encrypted_tokens=NULL,status='sandbox',token_version=token_version+1,refresh_lease=NULL WHERE workspace_id=? AND provider='slack'",
      ws,
    );
    release();
    await assert.rejects(second, /Connection changed/);
    assert.equal(
      (
        await one(
          db,
          "SELECT status FROM connections WHERE workspace_id=? AND provider='slack'",
          ws,
        )
      ).status,
      "sandbox",
    );
  } finally {
    globalThis.fetch = oldFetch;
    db.close();
  }
});
test("malformed or interrupted token refresh requires reconnection; rotation supports both key generations", async () => {
  const { db, ws } = await setup(),
    oldFetch = globalThis.fetch;
  try {
    await saveTokens(db, env, ws, "slack", {
      access_token: "old",
      refresh_token: "once",
      expires_in: 1,
    });
    globalThis.fetch = async () => Response.json({ expires_in: 3600 });
    await assert.rejects(token(db, env, ws, "slack"), /invalid token/);
    assert.equal(
      (
        await one(
          db,
          "SELECT status FROM connections WHERE workspace_id=? AND provider='slack'",
          ws,
        )
      ).status,
      "reconnect_required",
    );
    await saveTokens(db, env, ws, "slack", {
      access_token: "current",
      refresh_token: "valid",
    });
    const next = {
      ...env,
      TOKEN_ENCRYPTION_KEY_NEXT: "test-next-key-abcdefghijklmnopqrstuvwxyz",
    };
    assert.equal((await rotateCredentials(db, next, ws)).rotated, 1);
    const encrypted = (
      await one(
        db,
        "SELECT encrypted_tokens FROM connections WHERE workspace_id=? AND provider='slack'",
        ws,
      )
    ).encrypted_tokens;
    assert.equal(
      (await openTokens(encrypted, next, ws + ":slack")).access_token,
      "current",
    );
    await assert.rejects(
      unseal(encrypted, env.TOKEN_ENCRYPTION_KEY, ws + ":slack"),
    );
  } finally {
    globalThis.fetch = oldFetch;
    db.close();
  }
});
test("sync persists pagination, detects remote conflicts and pushes only approved field changes", async () => {
  const { db, ws } = await setup(),
    previous = globalThis.fetch;
  await saveTokens(db, env, ws, "hubspot", { access_token: "test" });
  const job = { id: ws + ":hubspot", workspace_id: ws, provider: "hubspot" };
  await execute(
    db,
    "INSERT INTO sync_jobs (id,workspace_id,provider,enabled) VALUES (?,?,?,2)",
    job.id,
    ws,
    "hubspot",
  );
  let remote = {
      firstname: "Ada",
      lastname: "Lovelace",
      email: "ada@example.test",
      company: "Initial",
    },
    patches = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === "PATCH") {
      const p = JSON.parse(init.body).properties;
      patches.push(p);
      remote = { ...remote, ...p };
      return Response.json({ id: "1", properties: remote });
    }
    return Response.json(
      String(url).includes("/contacts/1")
        ? { id: "1", properties: remote }
        : { results: [{ id: "1", properties: remote }] },
    );
  };
  try {
    assert.equal((await syncPage(db, env, job)).read, 1);
    let record = await one(
      db,
      "SELECT * FROM sync_records WHERE workspace_id=?",
      ws,
    );
    await stageContact(db, ws, record.id, record.version, {
      ...remote,
      company: "Local edit",
    });
    remote.company = "Remote edit";
    await syncPage(db, env, job);
    record = await one(db, "SELECT * FROM sync_records WHERE id=?", record.id);
    assert.equal(record.status, "conflict");
    assert.equal(patches.length, 0);
    assert.equal(JSON.parse(record.local_data).company, "Local edit");
    await resolveConflict(db, ws, record.id, record.version, "local");
    await syncPage(db, env, job);
    assert.deepEqual(patches, [{ company: "Local edit" }]);
    globalThis.fetch = async () =>
      Response.json({
        results: [{ id: "2", properties: remote }],
        paging: { next: { after: "next page" } },
      });
    await syncPage(db, env, job);
    assert.equal(
      (await one(db, "SELECT cursor FROM sync_jobs WHERE id=?", job.id)).cursor,
      "next page",
    );
    let cursorSeen = false;
    globalThis.fetch = async (url) => {
      cursorSeen = new URL(url).searchParams.get("after") === "next page";
      return Response.json({ results: [] });
    };
    await syncPage(db, env, job);
    assert.equal(cursorSeen, true);
    assert.equal(
      (await one(db, "SELECT cursor FROM sync_jobs WHERE id=?", job.id)).cursor,
      null,
    );
  } finally {
    globalThis.fetch = previous;
    db.close();
  }
});
test("encrypted backup verifies readback, restores into an empty database and supports guarded retention", async () => {
  const { db, ws } = await setup(),
    objects = new Map();
  const runtime = {
    ...env,
    BACKUP_ENCRYPTION_KEY: "backup-key-test-only-abcdefghijklmnopqrstuvwxyz",
    BACKUPS: {
      put: async (k, v) => objects.set(k, v),
      get: async (k) =>
        objects.has(k) ? { text: async () => objects.get(k) } : null,
    },
  };
  await saveTokens(db, env, ws, "slack", { access_token: "must-not-export" });
  const e = await enqueue(db, ws, "alice", payload, "backup-test-event");
  await processExecution(db, {}, e, { sleep: async () => {} });
  await execute(
    db,
    "UPDATE executions SET finished_at=? WHERE id=?",
    Date.now() - 100 * 86400000,
    e.id,
  );
  const result = await backupWorkspace(db, runtime, ws);
  assert.equal(result.verified, true);
  const backup = await readBackup(db, runtime, ws, result.id);
  assert.ok(!JSON.stringify(backup).includes("must-not-export"));
  assert.equal(
    backup.tables.connections.find((c) => c.provider === "slack").status,
    "sandbox",
  );
  const target = freshFile();
  assert.equal(restoreBackup(backup, target).restored, true);
  const restored = database(target);
  assert.equal(
    (await one(restored, "SELECT COUNT(*) AS n FROM executions")).n,
    1,
  );
  restored.close();
  assert.throws(() => restoreBackup(backup, target), /refusing to overwrite/);
  await assert.rejects(
    readBackup(db, runtime, "other", result.id),
    /not found/,
  );
  assert.equal((await retentionPreview(db, ws, 90)).executions, 1);
  await assert.rejects(applyRetention(db, ws, 90, "wrong"), /Confirm/);
  await applyRetention(db, ws, 90, ws);
  assert.equal((await one(db, "SELECT COUNT(*) AS n FROM spans")).n, 0);
  assert.equal((await one(db, "SELECT COUNT(*) AS n FROM deliveries")).n, 1);
  const dedup = await enqueue(db, ws, "alice", payload, "backup-test-event");
  assert.equal(dedup.id, e.id);
  db.close();
});
test("SDK emits matching trace hierarchy to a real HTTP receiver, retries collector failure and excludes payloads", async () => {
  const { db, ws } = await setup(),
    received = [];
  let reject = true;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(reject ? 503 : 200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const runtime = {
    OTEL_ALLOW_LOCAL: "true",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/traces`,
  };
  try {
    const e = await enqueue(db, ws, "alice", payload, "sdk-test-event");
    await processExecution(db, runtime, e, { sleep: async () => {} });
    const durable = await all(
        db,
        "SELECT * FROM spans WHERE execution_id=?",
        e.id,
      ),
      pending = await all(db, "SELECT * FROM telemetry_outbox");
    assert.equal(pending.length, durable.length);
    assert.equal((await exportTelemetry(db, runtime)).failed, 1);
    reject = false;
    await execute(db, "UPDATE telemetry_outbox SET next_at=0");
    await exportTelemetry(db, runtime);
    const exported = received.flatMap(
      (x) => x.resourceSpans[0].scopeSpans[0].spans,
    );
    assert.ok(exported.every((s) => s.traceId === e.trace_id));
    assert.ok(exported.some((s) => s.parentSpanId));
    assert.ok(!JSON.stringify(received).includes(payload.company));
    assert.equal(
      (
        await one(
          db,
          "SELECT COUNT(*) AS n FROM telemetry_outbox WHERE status='pending'",
        )
      ).n,
      0,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
test("email-bound invitations grant only the selected role and cannot cross tenants", async () => {
  const { db, ws } = await setup();
  const invite = await request(db, "ops/members", {
    email: "bob@example.test",
    role: "viewer",
  });
  assert.equal(invite.status, 200);
  const code = (await invite.json()).code;
  assert.equal((await request(db, "join", { code }, "eve")).status, 403);
  assert.equal((await request(db, "join", { code }, "bob")).status, 200);
  assert.equal((await request(db, "join", { code }, "bob")).status, 403);
  assert.equal(
    (await request(db, "snapshot", undefined, "bob", ws)).status,
    200,
  );
  assert.equal(
    (await request(db, "executions", payload, "bob", ws)).status,
    403,
  );
  assert.equal(
    (await request(db, "ops/members", undefined, "bob", ws)).status,
    403,
  );
  assert.equal(
    (await request(db, "snapshot", undefined, "eve", ws)).status,
    403,
  );
  db.close();
});
test("atomic tenant quotas cap concurrent ingestion and preserve idempotent retries", async () => {
  const { db, ws } = await setup();
  const results = await Promise.allSettled(
    Array.from({ length: 220 }, (_, i) =>
      enqueue(db, ws, "alice", payload, "quota-event-" + i),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 200);
  assert.equal((await one(db, "SELECT COUNT(*) AS n FROM executions")).n, 200);
  const original = await enqueue(db, ws, "alice", payload, "quota-event-0");
  assert.ok(original.id);
  const limits = await Promise.allSettled(
    Array.from({ length: 10 }, () => rateLimit(db, "test", 4)),
  );
  assert.equal(limits.filter((r) => r.status === "fulfilled").length, 4);
  db.close();
});
test("webhook signing keys are scoped to the destination workspace", async () => {
  assert.notEqual(
    await webhookSecret({ WEBHOOK_SECRET: "test" }, "one"),
    await webhookSecret({ WEBHOOK_SECRET: "test" }, "two"),
  );
});
test("maintenance MCP authorizes only the pinned owner or service credential and rejects argument injection", async () => {
  const { db } = await setup(),
    runtime = {
      DB: db,
      SITE_OWNER_EMAIL_SHA256: await hash("owner@example.test"),
    };
  const invoke = (email, args = {}) =>
    handleMcp(
      new Request("https://site.test/mcp", {
        method: "POST",
        headers: {
          "oai-authenticated-user-id": "signed-in-user",
          "oai-authenticated-user-email": email,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "operations_status", arguments: args },
        }),
      }),
      runtime,
    );
  assert.equal((await invoke("other@example.test")).status, 401);
  const result = await (await invoke("owner@example.test")).json();
  assert.equal(JSON.parse(result.result.content[0].text).queue.due, 0);
  assert.ok(
    (await (await invoke("owner@example.test", { workspace: "other" })).json())
      .error,
  );
  db.close();
});
test("local load: concurrent drains finish 100 queued executions exactly once across 10 tenants", async () => {
  const db = database(),
    started = performance.now();
  for (let t = 0; t < 10; t++) {
    const ws = await workspaceFor(db, "load-" + t);
    for (let i = 0; i < 10; i++)
      await enqueue(db, ws, "load", payload, `load-event-${t}-${i}`);
  }
  await Promise.all([
    drain(db, {}, null, { sleep: async () => {} }),
    drain(db, {}, null, { sleep: async () => {} }),
  ]);
  assert.equal(
    (
      await one(
        db,
        "SELECT COUNT(*) AS n FROM executions WHERE status='success' AND attempts=1",
      )
    ).n,
    100,
  );
  assert.equal((await one(db, "SELECT COUNT(*) AS n FROM deliveries")).n, 100);
  console.log(
    JSON.stringify({
      localLoad: {
        executions: 100,
        tenants: 10,
        concurrentDrains: 2,
        elapsedMs: Math.round(performance.now() - started),
      },
    }),
  );
  db.close();
});

test("heartbeat freshness follows the hourly managed cadence and can be tightened for external cron", async () => {
  const db = database();
  const age = Date.now() - 61 * 60000;
  await execute(
    db,
    "INSERT INTO maintenance_runs (id,started_at,finished_at,status,detail) VALUES (?,?,?,?,?)",
    "heartbeat",
    age - 1000,
    age,
    "success",
    "{}",
  );
  assert.equal((await maintenanceStatus(db)).stale, false);
  assert.equal(
    (await maintenanceStatus(db, { MAINTENANCE_STALE_AFTER_MINUTES: 20 }))
      .stale,
    true,
  );
  await execute(
    db,
    "UPDATE maintenance_runs SET finished_at=?",
    Date.now() - 76 * 60000,
  );
  assert.equal((await maintenanceStatus(db)).stale, true);
  db.close();
});
