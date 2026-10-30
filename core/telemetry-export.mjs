import { TracerProvider } from "@opentelemetry/sdk-trace";
import { ROOT_CONTEXT, trace, SpanStatusCode } from "@opentelemetry/api";
import { all, one, execute } from "./store.mjs";
import { toOtlp } from "./telemetry.mjs";
import { AppError } from "./security.mjs";
export function executionTelemetry(db, env, e) {
  const pending = [],
    active = new Map();
  let failure = false;
  const flush = async () => {
    await Promise.all(pending.splice(0));
    if (failure) throw Error("Telemetry persistence failed");
  };
  const processor = {
    onStart() {},
    onEnd(span) {
      if (!env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return;
      const context = span.spanContext(),
        parent = span.parentSpanContext?.spanId;
      const ms = (t) => t[0] * 1000 + t[1] / 1e6;
      const payload = toOtlp(e, [
        {
          id: context.spanId,
          trace_id: context.traceId,
          parent_id: parent,
          name: span.name,
          service: span.attributes["workflow.component"],
          attempt: e.attempts,
          started_at: Math.round(ms(span.startTime)),
          ended_at: Math.round(ms(span.endTime)),
          status: span.attributes["workflow.status"],
          error: span.status.message,
        },
      ]);
      pending.push(
        execute(
          db,
          "INSERT OR IGNORE INTO telemetry_outbox (id,workspace_id,payload,next_at,created_at) VALUES (?,?,?,?,?)",
          context.spanId,
          e.workspace_id,
          JSON.stringify(payload),
          Date.now(),
          Date.now(),
        ).catch(() => {
          failure = true;
        }),
      );
    },
    forceFlush: flush,
    shutdown: flush,
  };
  const provider = new TracerProvider({
    idGenerator: {
      generateTraceId: () => e.trace_id,
      generateSpanId: () =>
        crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    },
    spanProcessors: [processor],
  });
  const tracer = provider.getTracer("integration-os.engine", "1.0.0");
  return {
    start(name, service, parent, at) {
      const ctx = parent
        ? trace.setSpanContext(ROOT_CONTEXT, {
            traceId: e.trace_id,
            spanId: parent,
            traceFlags: 1,
          })
        : ROOT_CONTEXT;
      const span = tracer.startSpan(
        name,
        {
          startTime: at,
          attributes: {
            "workflow.component": service,
            "workflow.execution.id": e.id,
          },
          kind: service === "slack" ? 3 : 1,
        },
        ctx,
      );
      const id = span.spanContext().spanId;
      active.set(id, span);
      return id;
    },
    end(id, status, error, at) {
      const span = active.get(id);
      if (!span) return;
      span.setAttribute("workflow.status", status);
      span.setStatus({
        code:
          status === "error"
            ? SpanStatusCode.ERROR
            : status === "success"
              ? SpanStatusCode.OK
              : SpanStatusCode.UNSET,
        ...(error ? { message: error } : {}),
      });
      span.end(at);
      active.delete(id);
    },
    async flush() {
      await provider.forceFlush({ timeoutMillis: 3000 });
      await provider.shutdown();
    },
  };
}
export async function exportTelemetry(db, env) {
  if (!env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return { configured: false };
  const url = new URL(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (
    url.protocol !== "https:" &&
    !(
      env.OTEL_ALLOW_LOCAL === "true" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new AppError("Collector URL must use HTTPS.", 409);
  const rows = await all(
    db,
    "SELECT id FROM telemetry_outbox WHERE status='pending' AND next_at<=? AND (lease_id IS NULL OR lease_until<?) ORDER BY created_at LIMIT 20",
    Date.now(),
    Date.now(),
  );
  let exported = 0,
    failed = 0;
  const deadline = Date.now() + 4000;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    const lease = crypto.randomUUID();
    const claimed = await one(
      db,
      "UPDATE telemetry_outbox SET lease_id=?,lease_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND (lease_id IS NULL OR lease_until<?) RETURNING *",
      lease,
      Date.now() + 15000,
      row.id,
      Date.now(),
    );
    if (!claimed) continue;
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(3000),
        headers: {
          "Content-Type": "application/json",
          ...(env.OTEL_EXPORTER_OTLP_AUTHORIZATION
            ? { Authorization: env.OTEL_EXPORTER_OTLP_AUTHORIZATION }
            : {}),
        },
        body: claimed.payload,
      });
      if (!response.ok) throw Error("Collector rejected batch");
      const body = await response.text();
      if (body) {
        const result = JSON.parse(body);
        if (Number(result.partialSuccess?.rejectedSpans) > 0)
          throw Error("Partial rejection");
      }
      await execute(
        db,
        "UPDATE telemetry_outbox SET status='sent',payload='{}',lease_id=NULL,lease_until=NULL,error=NULL WHERE id=? AND lease_id=?",
        row.id,
        lease,
      );
      exported++;
    } catch {
      await execute(
        db,
        "UPDATE telemetry_outbox SET status=?,next_at=?,error=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?",
        claimed.attempts >= 8 ? "failed" : "pending",
        Date.now() + Math.min(3600000, 5000 * 2 ** claimed.attempts),
        "Collector unavailable or rejected spans.",
        row.id,
        lease,
      );
      failed++;
      break; // Do not spend the wake retrying an unavailable endpoint.
    }
  }
  return { configured: true, exported, failed };
}
