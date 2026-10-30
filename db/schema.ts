import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable("workspaces", {
  id: text().primaryKey(),
  name: text().notNull(),
  created_at: integer().notNull(),
});
export const demoSessions = sqliteTable("demo_sessions", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  workspace_id: text().notNull().unique(),
  created_at: integer().notNull(),
  expires_at: integer().notNull(),
  runs: integer().notNull().default(0),
}, (t) => [index("demo_expiry").on(t.expires_at)]);
export const members = sqliteTable(
  "members",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => workspaces.id),
    user_id: text().notNull(),
    role: text().notNull(),
  },
  (t) => [uniqueIndex("member_identity").on(t.workspace_id, t.user_id)],
);
export const workflows = sqliteTable("workflows", {
  id: text().primaryKey(),
  workspace_id: text()
    .notNull()
    .references(() => workspaces.id),
  name: text().notNull(),
  version: integer().notNull(),
  config: text().notNull(),
  updated_at: integer().notNull(),
});
export const executions = sqliteTable(
  "executions",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => workspaces.id),
    workflow_id: text().notNull(),
    workflow_name: text().notNull(),
    workflow_version: integer().notNull(),
    config: text().notNull(),
    trace_id: text().notNull(),
    status: text().notNull(),
    mode: text().notNull(),
    source: text().notNull(),
    scenario: text().notNull(),
    payload: text().notNull(),
    payload_hash: text().notNull(),
    idempotency_key: text().notNull(),
    replay_of: text(),
    attempts: integer().notNull().default(0),
    created_at: integer().notNull(),
    started_at: integer(),
    finished_at: integer(),
    next_at: integer().notNull(),
    lease_id: text(),
    lease_until: integer(),
    error: text(),
  },
  (t) => [
    uniqueIndex("execution_idempotency").on(t.workspace_id, t.idempotency_key),
    index("execution_queue").on(t.status, t.next_at),
    index("execution_tenant").on(t.workspace_id, t.created_at),
    index("execution_tenant_status").on(t.workspace_id, t.status),
  ],
);
export const spans = sqliteTable(
  "spans",
  {
    id: text().primaryKey(),
    execution_id: text()
      .notNull()
      .references(() => executions.id),
    trace_id: text().notNull(),
    parent_id: text(),
    name: text().notNull(),
    service: text().notNull(),
    attempt: integer().notNull(),
    status: text().notNull(),
    started_at: integer().notNull(),
    ended_at: integer(),
    input: text().notNull(),
    output: text(),
    error: text(),
  },
  (t) => [index("span_execution").on(t.execution_id, t.started_at)],
);
export const deliveries = sqliteTable("deliveries", {
  id: text().primaryKey(),
  execution_id: text()
    .notNull()
    .references(() => executions.id),
  status: text().notNull(),
  receipt: text(),
  updated_at: integer().notNull(),
});
export const audit = sqliteTable(
  "audit",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull(),
    execution_id: text(),
    actor: text().notNull(),
    action: text().notNull(),
    detail: text().notNull(),
    created_at: integer().notNull(),
  },
  (t) => [index("audit_tenant").on(t.workspace_id, t.created_at)],
);
export const connections = sqliteTable(
  "connections",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull(),
    provider: text().notNull(),
    encrypted_tokens: text(),
    status: text().notNull(),
    synced_at: integer(),
    summary: text(),
    token_version: integer().notNull().default(0),
    refresh_lease: text(),
    refresh_until: integer(),
  },
  (t) => [uniqueIndex("connection_tenant").on(t.workspace_id, t.provider)],
);
export const oauthStates = sqliteTable("oauth_states", {
  id: text().primaryKey(),
  workspace_id: text().notNull(),
  user_id: text().notNull(),
  provider: text().notNull(),
  expires_at: integer().notNull(),
  redirect_uri: text().notNull(),
});
export const nodeResults = sqliteTable(
  "node_results",
  {
    execution_id: text()
      .notNull()
      .references(() => executions.id),
    node_id: text().notNull(),
    status: text().notNull(),
    output: text(),
    attempts: integer().notNull().default(0),
    updated_at: integer().notNull(),
  },
  (t) => [uniqueIndex("node_checkpoint").on(t.execution_id, t.node_id)],
);
export const maintenanceRuns = sqliteTable("maintenance_runs", {
  id: text().primaryKey(),
  started_at: integer().notNull(),
  finished_at: integer(),
  status: text().notNull(),
  detail: text().notNull(),
});
export const locks = sqliteTable("locks", {
  id: text().primaryKey(),
  owner: text().notNull(),
  until: integer().notNull(),
});
export const rateLimits = sqliteTable("rate_limits", {
  id: text().primaryKey(),
  count: integer().notNull(),
  expires_at: integer().notNull(),
});
export const invitations = sqliteTable("invitations", {
  id: text().primaryKey(),
  workspace_id: text().notNull(),
  email: text().notNull(),
  role: text().notNull(),
  expires_at: integer().notNull(),
  created_by: text().notNull(),
});
export const syncJobs = sqliteTable("sync_jobs", {
  id: text().primaryKey(),
  workspace_id: text().notNull(),
  provider: text().notNull(),
  enabled: integer().notNull().default(0),
  cursor: text(),
  generation: integer().notNull().default(0),
  next_at: integer().notNull().default(0),
  lease_id: text(),
  lease_until: integer(),
  error: text(),
});
export const syncRecords = sqliteTable(
  "sync_records",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull(),
    provider: text().notNull(),
    remote_id: text().notNull(),
    remote_version: text().notNull(),
    remote_data: text().notNull(),
    local_data: text().notNull(),
    status: text().notNull(),
    version: integer().notNull().default(1),
    generation: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (t) => [
    index("sync_records_tenant").on(t.workspace_id, t.provider, t.status),
  ],
);
export const telemetryOutbox = sqliteTable(
  "telemetry_outbox",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull(),
    payload: text().notNull(),
    attempts: integer().notNull().default(0),
    next_at: integer().notNull(),
    created_at: integer().notNull(),
    status: text().notNull().default("pending"),
    lease_id: text(),
    lease_until: integer(),
    error: text(),
  },
  (t) => [index("telemetry_due").on(t.status, t.next_at)],
);
export const backups = sqliteTable(
  "backups",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull(),
    object_key: text().notNull(),
    created_at: integer().notNull(),
    checksum: text().notNull(),
    bytes: integer().notNull(),
    rows: integer().notNull(),
  },
  (t) => [index("backup_tenant").on(t.workspace_id, t.created_at)],
);
