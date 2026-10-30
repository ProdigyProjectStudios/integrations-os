import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './database.mjs';
import { handleApi } from '../core/api.mjs';
import { hash } from '../core/security.mjs';
import { workspaceAccess } from '../core/portfolio.mjs';
import { one } from '../core/store.mjs';

test('portfolio denies anonymous and visitor workspace access before provisioning; owner retains access', async () => {
  const db = database();
  const env = { DB: db, PUBLIC_PORTFOLIO_ONLY: 'true', SITE_OWNER_EMAIL_SHA256: await hash('owner@example.test') };
  const owner = { userId: 'owner', email: 'owner@example.test' };
  const visitor = { userId: 'visitor', email: 'visitor@example.test' };
  assert.equal(await workspaceAccess(null, env), false);
  assert.equal(await workspaceAccess(visitor, env), false);
  assert.equal(await workspaceAccess(owner, { PUBLIC_PORTFOLIO_ONLY: 'true' }), false);
  assert.equal(await workspaceAccess(owner, env), true);
  for (const user of [null, visitor]) {
    for (const path of ['snapshot', 'ops/members', 'executions', 'connections/slack/connect']) {
      const response = await handleApi(new Request('https://example.test/api/' + path), env, user, () => {});
      assert.equal(response.status, user ? 403 : 401);
    }
    const response = await handleApi(new Request('https://example.test/api/executions', { method: 'POST', headers: { Origin: 'https://example.test' }, body: '{}' }), env, user, () => {});
    assert.equal(response.status, user ? 403 : 401);
  }
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM workspaces')).n, 0);
  const response = await handleApi(new Request('https://example.test/api/snapshot'), env, owner, () => {});
  assert.equal(response.status, 200);
  db.close();
});
