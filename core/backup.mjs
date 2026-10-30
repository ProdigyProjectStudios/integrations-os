import { all, one, execute, query } from "./store.mjs";
import { AppError, hash, seal, unseal } from "./security.mjs";
const selectors = {
  workspaces: "SELECT * FROM workspaces WHERE id=?",
  members: "SELECT * FROM members WHERE workspace_id=?",
  workflows: "SELECT * FROM workflows WHERE workspace_id=?",
  executions: "SELECT * FROM executions WHERE workspace_id=?",
  spans:
    "SELECT s.* FROM spans s JOIN executions e ON e.id=s.execution_id WHERE e.workspace_id=?",
  deliveries:
    "SELECT d.* FROM deliveries d JOIN executions e ON e.id=d.execution_id WHERE e.workspace_id=?",
  node_results:
    "SELECT n.* FROM node_results n JOIN executions e ON e.id=n.execution_id WHERE e.workspace_id=?",
  audit: "SELECT * FROM audit WHERE workspace_id=?",
  connections:
    "SELECT id,workspace_id,provider,NULL AS encrypted_tokens,'sandbox' AS status,NULL AS synced_at,NULL AS summary,0 AS token_version,NULL AS refresh_lease,NULL AS refresh_until FROM connections WHERE workspace_id=?",
  sync_jobs:
    "SELECT id,workspace_id,provider,0 AS enabled,NULL AS cursor,generation,0 AS next_at,NULL AS lease_id,NULL AS lease_until,NULL AS error FROM sync_jobs WHERE workspace_id=?",
  sync_records: "SELECT * FROM sync_records WHERE workspace_id=?",
};
export async function snapshotWorkspace(db, workspace) {
  const names = Object.keys(selectors);
  const counts = [];
  for (const name of names) {
    const columns = await all(db, `PRAGMA table_info(${name})`);
    const json = columns.map((c) => `'${c.name}',b."${c.name}"`).join(",");
    counts.push(
      await one(
        db,
        `SELECT COUNT(*) AS rows,COALESCE(SUM(LENGTH(CAST(json_object(${json}) AS BLOB))),0) AS bytes FROM (${selectors[name]}) b`,
        workspace,
      ),
    );
  }
  if (
    counts.reduce((n, c) => n + c.rows, 0) > 25000 ||
    counts.reduce((n, c) => n + c.bytes, 0) > 8 * 1024 * 1024
  )
    throw new AppError(
      "Logical backup exceeds 25,000 rows or 8 MB. Arrange a platform database export.",
      409,
    );
  // A single D1 transaction provides a coherent view across related tables.
  const result = await db.batch(
    names.map((name) => query(db, selectors[name], workspace)),
  );
  const tables = Object.fromEntries(
    names.map((name, i) => [name, result[i].results]),
  );
  const rows = Object.values(tables).reduce((n, t) => n + t.length, 0);
  const document = {
    format: "integration-os.logical-backup.v1",
    workspace,
    createdAt: Date.now(),
    credentialsIncluded: false,
    tables,
  };
  const json = JSON.stringify(document);
  if (rows > 25000 || new TextEncoder().encode(json).length > 8 * 1024 * 1024)
    throw new AppError(
      "Logical backup exceeds 25,000 rows or 8 MB. Arrange a platform database export.",
      409,
    );
  return { document, json, rows };
}
export async function backupWorkspace(db, env, workspace) {
  if (!env.BACKUPS || !env.BACKUP_ENCRYPTION_KEY)
    throw new AppError(
      "Backup storage and encryption key are not configured.",
      409,
    );
  const { document, json, rows } = await snapshotWorkspace(db, workspace),
    id = crypto.randomUUID(),
    now = Date.now();
  const objectKey = "workspaces/" + workspace + "/" + id + ".json";
  const ciphertext = await seal(
    document,
    env.BACKUP_ENCRYPTION_KEY,
    workspace + ":backup:" + id,
    true,
  );
  await env.BACKUPS.put(objectKey, ciphertext, {
    httpMetadata: { contentType: "application/json" },
  });
  // Verify durable storage and authentication before recording a successful backup.
  const read = await env.BACKUPS.get(objectKey);
  if (!read) throw new AppError("Backup readback failed.", 502);
  const verified = await unseal(
    await read.text(),
    env.BACKUP_ENCRYPTION_KEY,
    workspace + ":backup:" + id,
  );
  const checksum = await hash(json);
  if ((await hash(JSON.stringify(verified))) !== checksum)
    throw new AppError("Backup checksum mismatch.", 502);
  await execute(
    db,
    "INSERT INTO backups (id,workspace_id,object_key,created_at,checksum,bytes,rows) VALUES (?,?,?,?,?,?,?)",
    id,
    workspace,
    objectKey,
    now,
    checksum,
    new TextEncoder().encode(json).length,
    rows,
  );
  return {
    id,
    created_at: now,
    checksum,
    rows,
    verified: true,
    credentialsIncluded: false,
  };
}
export async function readBackup(db, env, workspace, id) {
  const row = await one(
    db,
    "SELECT * FROM backups WHERE id=? AND workspace_id=?",
    id,
    workspace,
  );
  if (!row) throw new AppError("Backup not found.", 404);
  const object = await env.BACKUPS?.get(row.object_key);
  if (!object) throw new AppError("Backup object unavailable.", 503);
  const document = await unseal(
    await object.text(),
    env.BACKUP_ENCRYPTION_KEY,
    workspace + ":backup:" + id,
  );
  if ((await hash(JSON.stringify(document))) !== row.checksum)
    throw new AppError("Backup verification failed.", 502);
  return document;
}
export async function scheduledBackup(db, env) {
  if (!env.BACKUPS || !env.BACKUP_ENCRYPTION_KEY) return { configured: false };
  const ws = await one(
    db,
    "SELECT w.id FROM workspaces w LEFT JOIN backups b ON w.id=b.workspace_id GROUP BY w.id HAVING COALESCE(MAX(b.created_at),0)<? ORDER BY COALESCE(MAX(b.created_at),0) LIMIT 1",
    Date.now() - 86400000,
  );
  if (!ws) return { configured: true, due: false };
  try {
    return { configured: true, ...(await backupWorkspace(db, env, ws.id)) };
  } catch (e) {
    return {
      configured: true,
      error: e instanceof AppError ? e.message : "Backup failed.",
    };
  }
}
export async function retentionPreview(db, workspace, days = 90) {
  if (!Number.isInteger(days) || days < 7 || days > 3650)
    throw new AppError("Retention must be between 7 and 3,650 days.");
  const cutoff = Date.now() - days * 86400000;
  const count = await one(
    db,
    "SELECT COUNT(*) AS count FROM executions WHERE workspace_id=? AND status IN ('success','skipped','failed') AND finished_at<?",
    workspace,
    cutoff,
  );
  return { days, cutoff, executions: count.count, automaticDeletion: false };
}
export async function applyRetention(db, workspace, days, confirmation) {
  if (confirmation !== workspace)
    throw new AppError(
      "Confirm the workspace ID to purge expired completed executions.",
    );
  const preview = await retentionPreview(db, workspace, days);
  const backup = await one(
    db,
    "SELECT created_at FROM backups WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1",
    workspace,
  );
  if (!backup || backup.created_at < Date.now() - 3600000)
    throw new AppError(
      "Create and verify a fresh backup before retention cleanup.",
      409,
    );
  // Keep delivery/idempotency tombstones: delete sensitive trace bodies, not deduplication evidence.
  const scope =
    "SELECT id FROM executions WHERE workspace_id=? AND status IN ('success','skipped','failed') AND finished_at<?";
  await db.batch([
    query(
      db,
      `DELETE FROM spans WHERE execution_id IN (${scope})`,
      workspace,
      preview.cutoff,
    ),
    query(
      db,
      `UPDATE node_results SET output=NULL WHERE execution_id IN (${scope})`,
      workspace,
      preview.cutoff,
    ),
    query(
      db,
      `UPDATE deliveries SET receipt=NULL WHERE execution_id IN (${scope})`,
      workspace,
      preview.cutoff,
    ),
    query(
      db,
      `UPDATE executions SET payload='{}',error=NULL WHERE id IN (${scope})`,
      workspace,
      preview.cutoff,
    ),
    query(
      db,
      "UPDATE audit SET detail='{}' WHERE workspace_id=? AND created_at<?",
      workspace,
      preview.cutoff,
    ),
  ]);
  return { ...preview, redacted: true, tombstonesRetained: true };
}
