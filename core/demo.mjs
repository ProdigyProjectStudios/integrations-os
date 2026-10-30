import { AppError, checkOrigin, hash, id } from './security.mjs';
import { one, all, query, workspaceFor, defaultConfig } from './store.mjs';
import { referenceGraph } from './graph-definition.mjs';
import { rateLimit } from './limits.mjs';

const cookieName = '__Host-integrationos-demo';
const day = 86400000;
const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store', ...headers },
});
async function sessionFor(request, db) {
  const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
  return one(db, 'SELECT * FROM demo_sessions WHERE id=? AND expires_at>?', await hash(token), Date.now());
}

// The public API has an explicit capability allowlist. Gateway identities and
// caller-supplied workspace IDs never choose the visitor's tenant.
export async function handleDemo(request, env, background, workspaceApi) {
  const db = env.DB;
  if (!db) throw new AppError('Sandbox temporarily unavailable.', 503);
  const url = new URL(request.url);
  const path = url.pathname.slice('/api/demo/'.length);
  if (request.method !== 'GET') checkOrigin(request);
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new AppError('Cross-site sandbox access denied.', 403);
  let session = await sessionFor(request, db);
  if (path === 'session' && request.method === 'POST') {
    const reader = request.body?.getReader();
    if (reader) {
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024) { await reader.cancel(); throw new AppError('Session request exceeds 1 KB.', 413); }
      }
    }
    if (session) return json({ expiresAt: session.expires_at });
    await rateLimit(db, 'demo:new:global-hour', 40, 3600000);
    await rateLimit(db, 'demo:new:global-day', 200, day);
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    await rateLimit(db, 'demo:new:ip:' + (await hash(ip)).slice(0, 24), 10, 3600000);
    const token = id().replaceAll('-', '') + id().replaceAll('-', '');
    const digest = await hash(token), userId = 'demo:' + id();
    const workspace = await workspaceFor(db, userId);
    const now = Date.now(), expiresAt = now + day;
    await db.batch([
      query(db, 'INSERT INTO demo_sessions (id,user_id,workspace_id,created_at,expires_at) VALUES (?,?,?,?,?)', digest, userId, workspace, now, expiresAt),
      query(db, "UPDATE workspaces SET name='Visitor sandbox' WHERE id=?", workspace),
      query(db, 'UPDATE workflows SET config=? WHERE workspace_id=?', JSON.stringify({ ...defaultConfig, graph: referenceGraph(defaultConfig) }), workspace),
    ]);
    return json({ expiresAt }, 201, { 'Set-Cookie': `${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400` });
  }
  if (!session) throw new AppError('Your sandbox session expired. Reload this page to start a new sandbox.', 401);
  if (request.headers.has('x-workspace-id')) throw new AppError('Workspace switching is unavailable in the public sandbox.', 403);
  const allowed =
    (request.method === 'GET' && (path === 'snapshot' || /^executions\/[\w-]+(?:\/otlp)?$/.test(path))) ||
    (request.method === 'POST' && (['executions', 'workflows'].includes(path) || /^executions\/[\w-]+\/replay$/.test(path) || /^approvals\/[\w-]+$/.test(path))) ||
    (request.method === 'PUT' && path === 'workflows');
  if (!allowed) throw new AppError('This operation is not available in the public sandbox.', 403);
  await rateLimit(db, 'demo:request:' + session.id, request.method === 'GET' ? 180 : 30);
  if (request.method === 'POST' && path.startsWith('executions')) {
    await rateLimit(db, 'demo:runs:global-hour', 300, 3600000);
    await rateLimit(db, 'demo:runs:global-day', 1000, day);
    await rateLimit(db, 'demo:runs:' + session.id, 6);
    const permitted = await one(db, 'UPDATE demo_sessions SET runs=runs+1 WHERE id=? AND expires_at>? AND runs<30 RETURNING id', session.id, Date.now());
    if (!permitted) throw new AppError('This sandbox has reached its 30-run limit.', 429);
  }
  url.pathname = '/api/' + path;
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('oai-authenticated-user-id');
  headers.delete('oai-authenticated-user-email');
  const inner = new Request(url, { method: request.method, headers,
    ...(request.body ? { body: request.body, duplex: 'half' } : {}) });
  // No provider, signing, backup or export credentials enter visitor execution.
  return workspaceApi(inner, { DB: db }, { userId: session.user_id, displayName: 'Portfolio visitor' }, background, session);
}

export async function cleanupDemoSessions(db, now = Date.now()) {
  // Only explicitly registered expired visitor tenants are eligible. An active
  // execution lease defers deletion to a later maintenance wake.
  const expired = await all(db, "SELECT workspace_id FROM demo_sessions d WHERE expires_at<=? AND NOT EXISTS (SELECT 1 FROM executions e WHERE e.workspace_id=d.workspace_id AND e.status='running' AND e.lease_until>?) LIMIT 50", now, now);
  for (const { workspace_id: ws } of expired) {
    const eligible = "SELECT workspace_id FROM demo_sessions d WHERE workspace_id=? AND expires_at<=? AND NOT EXISTS (SELECT 1 FROM executions e WHERE e.workspace_id=d.workspace_id AND e.status='running' AND e.lease_until>?)";
    const statements = ['node_results', 'spans', 'deliveries'].map(table => query(db, `DELETE FROM ${table} WHERE execution_id IN (SELECT id FROM executions WHERE workspace_id IN (${eligible}))`, ws, now, now));
    for (const table of ['audit', 'telemetry_outbox', 'sync_records', 'sync_jobs', 'oauth_states', 'connections', 'invitations', 'backups', 'executions', 'workflows', 'members'])
      statements.push(query(db, `DELETE FROM ${table} WHERE workspace_id IN (${eligible})`, ws, now, now));
    // No FK from demo_sessions: retain the eligibility marker until tenant removal.
    statements.push(query(db, `DELETE FROM workspaces WHERE id IN (${eligible})`, ws, now, now));
    statements.push(query(db, 'DELETE FROM demo_sessions WHERE workspace_id=? AND expires_at<=? AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id=?)', ws, now, ws));
    await db.batch(statements);
  }
  return { inspected: expired.length };
}
