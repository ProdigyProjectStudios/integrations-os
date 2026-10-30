import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './database.mjs';
import { handleApi } from '../core/api.mjs';
import { workspaceFor, one, all, execute, defaultConfig } from '../core/store.mjs';
import { hash } from '../core/security.mjs';
import { referenceGraph } from '../core/graph.mjs';
import { cleanupDemoSessions } from '../core/demo.mjs';
import { enqueue, processExecution } from '../core/engine.mjs';
import { scheduledBackup } from '../core/backup.mjs';

const origin = 'https://demo.test';
async function call(db, path, { cookie, method = 'GET', body, headers = {}, env = {}, user = null } = {}) {
  const jobs = [];
  const response = await handleApi(new Request(origin + '/api/' + path, { method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), 'Idempotency-Key': crypto.randomUUID(), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { DB: db, PUBLIC_PORTFOLIO_ONLY: 'true', SITE_OWNER_EMAIL_SHA256: await hash('owner@example.test'), ...env }, user, promise => jobs.push(promise));
  await Promise.all(jobs);
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
async function visitor(db) {
  const result = await call(db, 'demo/session', { method: 'POST', body: {} });
  assert.equal(result.status, 201);
  assert.match(result.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const snapshot = await call(db, 'demo/snapshot', { cookie: result.cookie });
  assert.equal(snapshot.status, 200);
  return { cookie: result.cookie, snapshot: snapshot.data };
}

test('visitor sessions isolate graphs, executions and traces from other visitors and the owner', async () => {
  const db = database();
  const ownerWs = await workspaceFor(db, 'owner');
  const ownerRun = await enqueue(db, ownerWs, 'owner', { company: 'PRIVATE OWNER EVENT', value: 4800, region: 'UK' }, 'owner-private-event');
  const a = await visitor(db), b = await visitor(db);
  assert.notEqual(a.cookie, b.cookie);
  assert.notEqual(a.snapshot.workspace.id, b.snapshot.workspace.id);
  assert.equal(a.snapshot.maintenance, null);
  assert.equal(a.snapshot.workspace.role, 'sandbox visitor');
  assert.equal(a.snapshot.workspaces.length, 1);
  assert.ok(a.snapshot.connections.every(c => !c.configured && c.status === 'sandbox'));
  const flow = a.snapshot.workflows[0];
  const graph = referenceGraph(defaultConfig);
  graph.nodes.push({ id: 'demo-proof', kind: 'transform', label: 'Visitor marker', position: { x: 1800, y: 100 }, config: { operation: 'set', field: 'marker', value: 'visitor-executed' } });
  graph.edges.push({ id: 'proof-edge', source: 'notify', target: 'demo-proof' });
  assert.equal((await call(db, 'demo/workflows', { cookie: a.cookie, method: 'PUT', body: { id: flow.id, version: flow.version, config: { ...defaultConfig, graph } } })).status, 200);
  const run = await call(db, 'demo/executions', { cookie: a.cookie, method: 'POST', body: { workflowId: flow.id, payload: { company: 'Demo input', value: 4800, region: 'UK' } } });
  assert.equal(run.status, 202);
  const trace = await call(db, 'demo/executions/' + run.data.id, { cookie: a.cookie });
  assert.equal(trace.data.execution.status, 'success');
  assert.equal(trace.data.execution.mode, 'sandbox');
  assert.equal(trace.data.execution.source, 'public-demo');
  assert.ok(trace.data.spans.length > 3);
  assert.ok(trace.data.nodes.some(n => n.node_id === 'demo-proof' && n.output.marker === 'visitor-executed'));
  for (const deniedId of [run.data.id, ownerRun.id]) assert.equal((await call(db, 'demo/executions/' + deniedId, { cookie: b.cookie })).status, 404);
  assert.equal((await call(db, 'demo/workflows', { cookie: b.cookie, method: 'PUT', body: { id: flow.id, version: 2, config: defaultConfig } })).status, 404);
  assert.equal((await call(db, 'demo/executions', { cookie: b.cookie, method: 'POST', body: { workflowId: flow.id, payload: { company: 'Attack', value: 4800, region: 'UK' } } })).status, 404);
  assert.equal((await call(db, 'demo/snapshot', { cookie: a.cookie, headers: { 'X-Workspace-Id': ownerWs } })).status, 403);
  assert.equal((await call(db, 'snapshot', { cookie: a.cookie })).status, 401);
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM executions WHERE workspace_id=?', ownerWs)).n, 1);
  db.close();
});

test('public sandbox denies live mode, administration, OAuth, forged/expired cookies and cross-origin writes', async () => {
  const db = database(), a = await visitor(db);
  for (const path of ['ops/members', 'ops/backups', 'ops/webhook', 'worker', 'worker/status', 'connections/slack/authorize', 'connections/slack/callback', 'join', 'seed', '../snapshot']) {
    const r = await call(db, 'demo/' + path, { cookie: a.cookie, method: 'POST', body: {} });
    assert.ok([401, 403].includes(r.status), path);
  }
  const flow = a.snapshot.workflows[0];
  assert.equal((await call(db, 'demo/workflows', { cookie: a.cookie, method: 'PUT', body: { id: flow.id, version: 1, config: { ...defaultConfig, mode: 'live' } } })).status, 403);
  assert.equal((await call(db, 'demo/executions', { cookie: a.cookie, method: 'POST', body: { mode: 'live', payload: { company: 'No delivery', value: 4800, region: 'UK' } } })).status, 403);
  assert.equal((await call(db, 'demo/session', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: {} })).status, 403);
  assert.equal((await call(db, 'demo/session', { method: 'POST', body: { tooLarge: 'x'.repeat(1500) } })).status, 413);
  assert.equal((await call(db, 'demo/workflows', { cookie: a.cookie, method: 'POST', headers: { Origin: 'https://evil.test' }, body: {} })).status, 403);
  assert.equal((await call(db, 'demo/snapshot', { cookie: '__Host-integrationos-demo=' + 'a'.repeat(64) })).status, 401);
  await execute(db, 'UPDATE demo_sessions SET expires_at=0');
  assert.equal((await call(db, 'demo/snapshot', { cookie: a.cookie })).status, 401);
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM executions')).n, 0);
  db.close();
});

test('sandbox quotas are atomic, guest backup/export is excluded and expiry cleanup preserves owner data and active leases', async () => {
  const db = database(), a = await visitor(db), b = await visitor(db);
  const owner = await workspaceFor(db, 'owner');
  await execute(db, 'UPDATE demo_sessions SET runs=29 WHERE workspace_id=?', a.snapshot.workspace.id);
  const attempts = await Promise.all(Array.from({ length: 4 }, () => call(db, 'demo/executions', { cookie: a.cookie, method: 'POST', body: { payload: { company: 'Quota', value: 4800, region: 'UK' } } })));
  assert.equal(attempts.filter(r => r.status === 202).length, 1);
  assert.equal(attempts.filter(r => r.status === 429).length, 3);
  const objects = new Map();
  const backupEnv = { BACKUP_ENCRYPTION_KEY: 'test-demo-backup-key-1234567890123456', BACKUPS: { async put(key, value) { objects.set(key, value); }, async get(key) { return objects.has(key) ? { text: async () => objects.get(key) } : null; } } };
  // Only an owner tenant may be selected, even though demo tenants were created first.
  assert.equal((await scheduledBackup(db, backupEnv)).verified, true);
  assert.ok([...objects.keys()].every(key => key.startsWith('workspaces/' + owner + '/')));
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM backups WHERE workspace_id!=?', owner)).n, 0);
  const run = await enqueue(db, b.snapshot.workspace.id, 'demo', { company: 'Telemetry', value: 1, region: 'UK' }, 'demo-telemetry-run', { forceSandbox: true, source: 'public-demo' });
  await processExecution(db, { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.invalid' }, run, { sleep: async () => {} });
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM telemetry_outbox')).n, 0);
  await execute(db, 'UPDATE demo_sessions SET expires_at=0');
  await execute(db, "UPDATE executions SET status='running',lease_until=? WHERE id=?", Date.now() + 60000, run.id);
  await cleanupDemoSessions(db);
  assert.ok(await one(db, 'SELECT id FROM workspaces WHERE id=?', owner));
  assert.equal(await one(db, 'SELECT id FROM workspaces WHERE id=?', a.snapshot.workspace.id), null);
  assert.ok(await one(db, 'SELECT id FROM workspaces WHERE id=?', b.snapshot.workspace.id));
  await execute(db, 'UPDATE executions SET lease_until=0 WHERE id=?', run.id);
  await cleanupDemoSessions(db);
  assert.equal((await all(db, 'SELECT * FROM demo_sessions')).length, 0);
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM workspaces')).n, 1);
  db.close();
});
