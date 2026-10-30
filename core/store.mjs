import { id, hash } from "./security.mjs";
export const query = (db, sql, ...args) => db.prepare(sql).bind(...args);
export const one = (db, sql, ...args) => query(db, sql, ...args).first();
export async function all(db, sql, ...args) {
  return (await query(db, sql, ...args).all()).results;
}
export const execute = (db, sql, ...args) => query(db, sql, ...args).run();
export const defaultConfig = {
  minimumValue: 1000,
  channel: "integration-events",
  message: "New qualified enquiry: {{company}} · £{{value}}",
  mode: "sandbox",
  maxAttempts: 3,
};
export async function auditLog(
  db,
  workspace,
  actor,
  action,
  detail = {},
  execution = null,
) {
  await execute(
    db,
    "INSERT INTO audit (id,workspace_id,execution_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?,?)",
    id(),
    workspace,
    execution,
    actor,
    action,
    JSON.stringify(detail),
    Date.now(),
  );
}
export async function workspaceFor(db, user) {
  const workspace = "ws_" + (await hash(user)).slice(0, 24);
  const now = Date.now();
  await db.batch([
    query(
      db,
      "INSERT OR IGNORE INTO workspaces (id,name,created_at) VALUES (?,?,?)",
      workspace,
      "Acme workspace",
      now,
    ),
    query(
      db,
      "INSERT OR IGNORE INTO members (id,workspace_id,user_id,role) VALUES (?,?,?,?)",
      workspace + ":owner",
      workspace,
      user,
      "admin",
    ),
    query(
      db,
      "INSERT OR IGNORE INTO workflows (id,workspace_id,name,version,config,updated_at) VALUES (?,?,?,?,?,?)",
      workspace + ":lead",
      workspace,
      "Enquiry → qualified lead",
      1,
      JSON.stringify(defaultConfig),
      now,
    ),
    ...["hubspot", "slack", "gmail"].map((provider) =>
      query(
        db,
        "INSERT OR IGNORE INTO connections (id,workspace_id,provider,status) VALUES (?,?,?,?)",
        workspace + ":" + provider,
        workspace,
        provider,
        "sandbox",
      ),
    ),
  ]);
  return workspace;
}
