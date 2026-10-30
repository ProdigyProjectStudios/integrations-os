import { AppError, id, traceId, hash, redact } from "./security.mjs";
import { one, all, query, execute, auditLog } from "./store.mjs";
import { notifySlack } from "./adapters.mjs";
import { validateGraph, executeGraph } from "./graph.mjs";
import { executionTelemetry } from "./telemetry-export.mjs";

export function validatePayload(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.company !== "string" ||
    !value.company.trim() ||
    value.company.length > 120 ||
    typeof value.value !== "number" ||
    !Number.isFinite(value.value) ||
    value.value < 0 ||
    value.value > 100000000
  )
    throw new AppError(
      "Provide a company (1–120 characters) and a value between 0 and 100,000,000.",
    );
  return {
    company: value.company.trim(),
    value: value.value,
    region: ["UK", "EU", "US"].includes(value.region) ? value.region : "UK",
  };
}
export function validateConfig(c) {
  if (
    !c ||
    !Number.isFinite(c.minimumValue) ||
    c.minimumValue < 0 ||
    c.minimumValue > 100000000 ||
    !["sandbox", "live"].includes(c.mode) ||
    !Number.isInteger(c.maxAttempts) ||
    c.maxAttempts < 1 ||
    c.maxAttempts > 3 ||
    typeof c.channel !== "string" ||
    c.channel.length < 1 ||
    c.channel.length > 80 ||
    typeof c.message !== "string" ||
    c.message.length < 1 ||
    c.message.length > 1000
  )
    throw new AppError("Invalid workflow configuration.");
  return {
    minimumValue: c.minimumValue,
    channel: c.channel,
    message: c.message,
    mode: c.mode,
    maxAttempts: c.maxAttempts,
    ...(c.graph ? { graph: validateGraph(c.graph) } : {}),
  };
}
export async function enqueue(db, workspace, actor, input, key, options = {}) {
  if (typeof key !== "string" || key.length < 8 || key.length > 180)
    throw new AppError("An idempotency key of 8–180 characters is required.");
  const payload = validatePayload(input);
  const flow = await one(
    db,
    "SELECT * FROM workflows WHERE workspace_id=? AND id=?",
    workspace,
    options.workflowId || workspace + ":lead",
  );
  if (!flow) throw new AppError("Workflow not found.", 404);
  const config = options.snapshot || JSON.parse(flow.config);
  if (options.forceSandbox) config.mode = "sandbox";
  const scenario =
    config.mode === "sandbox" &&
    ["success", "transient", "failure"].includes(options.scenario)
      ? options.scenario
      : "success";
  const digest = await hash(
    JSON.stringify({
      payload,
      scenario,
      mode: config.mode,
      workflowId: flow.id,
    }),
  );
  const legacyDigest = await hash(
    JSON.stringify({ payload, scenario, mode: config.mode }),
  );
  const sameRequest = (row) =>
    row.payload_hash === digest ||
    (row.workflow_id === flow.id && row.payload_hash === legacyDigest);
  const existing = await one(
    db,
    "SELECT * FROM executions WHERE workspace_id=? AND idempotency_key=?",
    workspace,
    key,
  );
  if (existing) {
    if (!sameRequest(existing))
      throw new AppError(
        "This idempotency key belongs to a different payload.",
        409,
      );
    return existing;
  }
  const executionId = id();
  const now = Date.now();
  await execute(
    db,
    "INSERT OR IGNORE INTO executions (id,workspace_id,workflow_id,workflow_name,workflow_version,config,trace_id,status,mode,source,scenario,payload,payload_hash,idempotency_key,replay_of,created_at,next_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM executions WHERE workspace_id=? AND status IN ('queued','running','retry_wait','waiting_approval'))<200 AND (SELECT COUNT(*) FROM executions WHERE workspace_id=? AND created_at>=?)<5000",
    executionId,
    workspace,
    flow.id,
    options.snapshotName || flow.name,
    options.snapshotVersion || flow.version,
    JSON.stringify(config),
    traceId(),
    "queued",
    config.mode,
    options.source || "console",
    scenario,
    JSON.stringify(payload),
    digest,
    key,
    options.replayOf || null,
    now,
    now,
    workspace,
    workspace,
    now - 86400000,
  );
  const result = await one(
    db,
    "SELECT * FROM executions WHERE workspace_id=? AND idempotency_key=?",
    workspace,
    key,
  );
  if (!result)
    throw new AppError(
      "Workspace execution quota reached (200 active or 5,000 per day).",
      429,
    );
  if (!sameRequest(result))
    throw new AppError(
      "This idempotency key belongs to a different payload.",
      409,
    );
  if (result.id === executionId)
    await auditLog(
      db,
      workspace,
      actor,
      "execution.queued",
      { source: result.source, mode: config.mode },
      executionId,
    );
  return result;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function processExecution(db, env, candidate, options = {}) {
  const lease = id();
  const now = Date.now();
  const claimed = await query(
    db,
    "UPDATE executions SET status='running',lease_id=?,lease_until=?,attempts=attempts+1,started_at=COALESCE(started_at,?) WHERE id=? AND next_at<=? AND ((status IN ('queued','retry_wait')) OR (status='running' AND lease_until<?)) RETURNING *",
    lease,
    now + 60000,
    now,
    candidate.id,
    now,
    now,
  ).first();
  if (!claimed) return false;
  const e = claimed;
  const telemetry = executionTelemetry(db, env, e);
  const config = JSON.parse(e.config);
  const payload = JSON.parse(e.payload);
  const pause = options.sleep || sleep;
  const startSpan = async (name, service, input = {}, parent = null) => {
    const started = Date.now();
    const span = telemetry.start(name, service, parent, started);
    await execute(
      db,
      "INSERT INTO spans (id,execution_id,trace_id,parent_id,name,service,attempt,status,started_at,input) VALUES (?,?,?,?,?,?,?,?,?,?)",
      span,
      e.id,
      e.trace_id,
      parent,
      name,
      service,
      e.attempts,
      "running",
      started,
      JSON.stringify(redact(input)),
    );
    return span;
  };
  const endSpan = async (span, status, output = {}, error = null) => {
    const ended = Date.now();
    await execute(
      db,
      "UPDATE spans SET status=?,ended_at=?,output=?,error=? WHERE id=?",
      status,
      ended,
      JSON.stringify(redact(output)),
      error,
      span,
    );
    telemetry.end(span, status, error, ended);
  };
  await execute(
    db,
    "UPDATE spans SET status='error',ended_at=?,error='Worker lease expired before completion.' WHERE execution_id=? AND status='running'",
    now,
    e.id,
  );
  const root = await startSpan("workflow.execute", "orchestrator", {
    version: e.workflow_version,
    mode: e.mode,
    attempt: e.attempts,
  });
  async function step(name, service, input, fn) {
    const span = await startSpan(name, service, input, root);
    try {
      const output = await fn();
      await endSpan(
        span,
        output?.skipped
          ? "skipped"
          : output?.waiting_for_review
            ? "waiting_approval"
            : "success",
        output,
      );
      return output;
    } catch (error) {
      await endSpan(
        span,
        "error",
        {},
        error instanceof AppError ? error.message : "Internal step failure.",
      );
      throw error;
    }
  }
  try {
    if (config.graph) {
      const status = await executeGraph(
        db,
        env,
        { ...e, traceparent: `00-${e.trace_id}-${root}-01` },
        config.graph,
        payload,
        step,
        { ...options, sleep: pause },
      );
      await endSpan(
        root,
        status === "waiting_approval" ? "waiting_approval" : "success",
        { status, graph: true },
      );
      await execute(
        db,
        "UPDATE executions SET status=?,finished_at=?,lease_id=NULL,lease_until=NULL,error=NULL WHERE id=? AND lease_id=?",
        status,
        ["queued", "waiting_approval"].includes(status) ? null : Date.now(),
        e.id,
        lease,
      );
      return true;
    }
    await step("event.validate", "gateway", payload, async () => {
      validatePayload(payload);
      if (e.mode === "sandbox") await pause(95);
      return { schema: "enquiry.v1", valid: true };
    });
    const results = await Promise.allSettled([
      step("contact.normalize", "transform", payload, async () => {
        if (e.mode === "sandbox") await pause(160 + payload.company.length * 8);
        return { ...payload, company: payload.company.trim(), currency: "GBP" };
      }),
      step("delivery.check", "storage", { execution_id: e.id }, async () => {
        const receipt = await one(
          db,
          "SELECT status FROM deliveries WHERE execution_id=?",
          e.id,
        );
        if (e.mode === "sandbox") await pause(130);
        return {
          existing: receipt?.status || "none",
          idempotency: "execution",
        };
      }),
    ]);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    const qualified = await step(
      "condition.evaluate",
      "rules",
      { value: payload.value, minimum: config.minimumValue },
      async () => {
        if (e.mode === "sandbox") await pause(80);
        return {
          matched: payload.value >= config.minimumValue,
          rule: "value >= minimumValue",
        };
      },
    );
    if (qualified.matched) {
      const message = await step(
        "message.render",
        "transform",
        { template: config.message },
        async () => {
          if (e.mode === "sandbox") await pause(110);
          return {
            text: config.message
              .replaceAll("{{company}}", payload.company)
              .replaceAll("{{value}}", String(payload.value)),
            channel: config.channel,
          };
        },
      );
      await step(
        "slack.deliver",
        e.mode === "sandbox" ? "sandbox" : "slack",
        message,
        async () => {
          const previous = await one(
            db,
            "SELECT * FROM deliveries WHERE execution_id=?",
            e.id,
          );
          if (previous?.status === "delivered")
            return { ...JSON.parse(previous.receipt), reused: true };
          if (
            previous?.status === "sending" ||
            previous?.status === "uncertain"
          )
            throw new AppError(
              "Delivery outcome is uncertain; inspect the provider before replaying.",
              409,
            );
          if (e.mode === "sandbox") {
            await pause(260 + payload.company.length * 10);
            if (
              e.scenario === "failure" ||
              (e.scenario === "transient" && e.attempts === 1)
            )
              throw new AppError(
                "Sandbox fault injection: destination returned HTTP 429.",
                429,
                true,
              );
          }
          await execute(
            db,
            "INSERT INTO deliveries (id,execution_id,status,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='sending',updated_at=excluded.updated_at",
            e.id + ":slack",
            e.id,
            "sending",
            Date.now(),
          );
          let receipt;
          try {
            receipt =
              e.mode === "sandbox"
                ? {
                    mode: "sandbox",
                    provider: "test-adapter",
                    delivered: true,
                    receipt: id(),
                  }
                : await (options.notify || notifySlack)(
                    db,
                    env,
                    { ...e, traceparent: `00-${e.trace_id}-${root}-01` },
                    payload,
                    config,
                  );
          } catch (error) {
            await execute(
              db,
              "UPDATE deliveries SET status=?,updated_at=? WHERE execution_id=?",
              error.retryable ? "retryable" : "uncertain",
              Date.now(),
              e.id,
            );
            throw error;
          }
          await execute(
            db,
            "UPDATE deliveries SET status='delivered',receipt=?,updated_at=? WHERE execution_id=?",
            JSON.stringify(receipt),
            Date.now(),
            e.id,
          );
          return receipt;
        },
      );
    }
    await step(
      "audit.commit",
      "storage",
      { outcome: qualified.matched ? "delivered" : "filtered" },
      async () => {
        await auditLog(
          db,
          e.workspace_id,
          "worker",
          "execution.completed",
          { attempt: e.attempts, mode: e.mode },
          e.id,
        );
        return { persisted: true };
      },
    );
    const status = qualified.matched ? "success" : "skipped";
    await endSpan(root, "success", { status });
    await execute(
      db,
      "UPDATE executions SET status=?,finished_at=?,lease_id=NULL,lease_until=NULL,error=NULL WHERE id=? AND lease_id=?",
      status,
      Date.now(),
      e.id,
      lease,
    );
  } catch (error) {
    const delivery = await one(
      db,
      "SELECT status FROM deliveries WHERE execution_id=? ORDER BY CASE WHEN status IN ('sending','uncertain') THEN 0 ELSE 1 END LIMIT 1",
      e.id,
    );
    const uncertain = ["sending", "uncertain"].includes(delivery?.status);
    const retry =
      !uncertain &&
      error.retryable &&
      (error.nodeAttempt || e.attempts) < config.maxAttempts;
    const message =
      error instanceof AppError
        ? error.message
        : "Internal execution failure; inspect correlated spans.";
    const status = uncertain ? "needs_review" : retry ? "retry_wait" : "failed";
    await endSpan(
      root,
      "error",
      { retry_scheduled: Boolean(retry), status },
      message,
    );
    await execute(
      db,
      "UPDATE executions SET status=?,error=?,next_at=?,finished_at=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?",
      status,
      message,
      Date.now() +
        Math.max(
          error.retryAfterMs || 0,
          Math.min(8000, 1000 * 2 ** e.attempts),
        ) +
        Math.floor(Math.random() * 250),
      retry ? null : Date.now(),
      e.id,
      lease,
    );
    await auditLog(
      db,
      e.workspace_id,
      "worker",
      retry ? "execution.retry_scheduled" : "execution." + status,
      { attempt: e.attempts, error: message },
      e.id,
    );
  } finally {
    await telemetry
      .flush()
      .catch(() =>
        console.error(JSON.stringify({ event: "telemetry.flush_failed" })),
      );
  }
  return true;
}
export async function drain(db, env, workspace = null, options = {}) {
  // Each wake is bounded to keep background work below the platform's 30 s window.
  // SQL claims arbitrate concurrent wakes; a 60 s lease prevents overlap with timed-out workers.
  const deadline = Date.now() + 12000;
  for (let batch = 0; batch < 30 && Date.now() < deadline; batch++) {
    const due = await all(
      db,
      "SELECT id FROM executions WHERE (status IN ('queued','retry_wait') OR (status='running' AND lease_until<?)) AND next_at<=?" +
        (workspace ? " AND workspace_id=?" : "") +
        " ORDER BY created_at LIMIT 4",
      Date.now(),
      Date.now(),
      ...(workspace ? [workspace] : []),
    );
    if (!due.length) {
      const next = await one(
        db,
        "SELECT MIN(next_at) AS next_at FROM executions WHERE status='retry_wait'" +
          (workspace ? " AND workspace_id=?" : ""),
        ...(workspace ? [workspace] : []),
      );
      if (!next?.next_at || next.next_at >= deadline) break;
      await (options.sleep || sleep)(
        Math.max(50, Math.min(2000, next.next_at - Date.now())),
      );
      continue;
    }
    await Promise.allSettled(
      due.map((e) => processExecution(db, env, e, options)),
    );
  }
}
export async function seed(db, workspace, actor) {
  const names = [
    "Meridian Estates",
    "Oak & Avenue",
    "Northstar Group",
    "Atlas Living",
    "Horizon Partners",
    "Forma Property",
    "Cedar & Stone",
    "Lumen Spaces",
    "Urban Collective",
    "Westbridge",
    "Arcadia Homes",
    "Fieldwork",
  ];
  for (let i = 0; i < names.length; i++)
    await enqueue(
      db,
      workspace,
      actor,
      {
        company: names[i],
        value: i === 5 ? 450 : 1800 + i * 720,
        region: "UK",
      },
      "sandbox-seed-v1-" + i,
      {
        scenario: i === 8 ? "failure" : i === 3 ? "transient" : "success",
        forceSandbox: true,
        source: "sandbox-seed",
      },
    );
}
