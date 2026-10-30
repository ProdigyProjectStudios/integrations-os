import { AppError, hash, id } from "./security.mjs";
import { one, all, execute, workspaceFor, defaultConfig } from "./store.mjs";
import { drain, enqueue } from "./engine.mjs";
import { acquireLock, rateLimit } from "./limits.mjs";
import { runSync } from "./sync.mjs";
import { exportTelemetry } from "./telemetry-export.mjs";
import { scheduledBackup } from "./backup.mjs";

export async function authorizeWorker(request, env) {
  const bearer = request.headers.get("authorization") || "";
  const candidate = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  const digest = await hash(candidate);
  if (
    !candidate ||
    !(
      (env.WORKER_TOKEN && digest === (await hash(env.WORKER_TOKEN))) ||
      (env.SITE_SERVICE_TOKEN_SHA256 &&
        digest === env.SITE_SERVICE_TOKEN_SHA256)
    )
  )
    throw new AppError("Unauthorized worker request.", 401);
}
export async function maintenanceStatus(db, env = {}) {
  const now = Date.now();
  const queue = await one(
    db,
    "SELECT COUNT(*) AS due,MIN(created_at) AS oldest FROM executions WHERE next_at<=? AND (status IN ('queued','retry_wait') OR (status='running' AND lease_until<?))",
    now,
    now,
  );
  const latest = await one(
    db,
    "SELECT * FROM maintenance_runs ORDER BY started_at DESC LIMIT 1",
  );
  return {
    queue,
    lastWake: latest ? { ...latest, detail: JSON.parse(latest.detail) } : null,
    staleAfterMinutes: Math.max(
      2,
      Math.min(1440, Number(env.MAINTENANCE_STALE_AFTER_MINUTES) || 75),
    ),
    stale:
      !latest?.finished_at ||
      now - latest.finished_at >
        Math.max(
          2,
          Math.min(1440, Number(env.MAINTENANCE_STALE_AFTER_MINUTES) || 75),
        ) *
          60000,
    probes: await all(
      db,
      "SELECT id,status,trace_id,attempts,finished_at FROM executions WHERE source='recovery-canary' ORDER BY created_at DESC LIMIT 3",
    ),
  };
}
export async function recover(db, env, options = {}) {
  const owner = await acquireLock(db, "maintenance", 120000);
  if (!owner) return { busy: true, ...(await maintenanceStatus(db, env)) };
  const started = Date.now(),
    run = id(),
    detail = {};
  await execute(
    db,
    "UPDATE maintenance_runs SET status='interrupted',finished_at=? WHERE status='running'",
    started,
  );
  await execute(
    db,
    "INSERT INTO maintenance_runs (id,started_at,status,detail) VALUES (?,?,?,?)",
    run,
    started,
    "running",
    "{}",
  );
  try {
    detail.before = (await maintenanceStatus(db, env)).queue;
    // Keep each HTTP/MCP call bounded: execution recovery has priority. Other
    // maintenance runs in a subsequent wake after the due execution queue drains.
    if (detail.before.due) {
      await drain(db, env, null, options);
      detail.sync = [];
      detail.telemetry = { deferred: true };
      detail.backup = { deferred: true };
      detail.deferredOtherWork = true;
    } else {
      detail.sync = await runSync(db, env);
      detail.telemetry = await exportTelemetry(db, env);
      detail.backup = await scheduledBackup(db, env);
    }
    await execute(db, "DELETE FROM rate_limits WHERE expires_at<?", Date.now());
    await execute(
      db,
      "DELETE FROM oauth_states WHERE expires_at<?",
      Date.now(),
    );
    await execute(db, "DELETE FROM invitations WHERE expires_at<?", Date.now());
    detail.after = (await maintenanceStatus(db, env)).queue;
    const degraded =
      detail.sync.some((s) => s.error) ||
      detail.telemetry.failed ||
      detail.backup.error;
    await execute(
      db,
      "UPDATE maintenance_runs SET status=?,finished_at=?,detail=? WHERE id=?",
      degraded ? "degraded" : "success",
      Date.now(),
      JSON.stringify(detail),
      run,
    );
    return { runId: run, ...(await maintenanceStatus(db, env)) };
  } catch (e) {
    await execute(
      db,
      "UPDATE maintenance_runs SET status='failed',finished_at=?,detail=? WHERE id=?",
      Date.now(),
      JSON.stringify({
        stage: "maintenance",
        error:
          e instanceof AppError
            ? e.message
            : "Maintenance failed; inspect server logs.",
      }),
      run,
    );
    throw e;
  } finally {
    await execute(
      db,
      "DELETE FROM locks WHERE id=? AND owner=?",
      "maintenance",
      owner,
    );
  }
}
export async function recoveryProbe(db) {
  await rateLimit(db, "recovery-canary", 6, 86400000);
  const workspace = await workspaceFor(db, "integration-os-recovery-canary");
  const graph = {
    nodes: [
      {
        id: "start",
        kind: "trigger",
        label: "Recovery trigger",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "finish",
        kind: "transform",
        label: "Recovered by unattended worker",
        position: { x: 320, y: 0 },
        config: { operation: "set", field: "recovery", value: "verified" },
      },
    ],
    edges: [{ id: "start-finish", source: "start", target: "finish" }],
  };
  const e = await enqueue(
    db,
    workspace,
    "service:recovery-probe",
    { company: "Unattended recovery probe", value: 1, region: "UK" },
    "recovery-" + id(),
    {
      snapshot: { ...defaultConfig, graph },
      forceSandbox: true,
      source: "recovery-canary",
    },
  );
  const now = Date.now();
  await execute(
    db,
    "UPDATE executions SET status='running',attempts=1,started_at=?,lease_id='expired-canary-lease',lease_until=? WHERE id=?",
    now - 61000,
    now - 1,
    e.id,
  );
  await execute(
    db,
    "INSERT INTO node_results (execution_id,node_id,status,output,attempts,updated_at) VALUES (?,'start','success',?,1,?)",
    e.id,
    e.payload,
    now - 61000,
  );
  return {
    id: e.id,
    trace_id: e.trace_id,
    status: "running",
    fixture: "expired lease with a completed trigger checkpoint",
    queuedWithoutWake: true,
  };
}
