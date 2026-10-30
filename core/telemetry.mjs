// OTLP/HTTP JSON encoding of the engine's durable spans. No synthetic spans.
export function toOtlp(execution, spans) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "integration-os-worker" },
            },
            {
              key: "deployment.environment.name",
              value: { stringValue: execution.mode },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "integration-os.engine", version: "0.1.0" },
            spans: spans.map((s) => ({
              traceId: s.trace_id,
              spanId: s.id.replaceAll("-", "").slice(0, 16),
              ...(s.parent_id
                ? { parentSpanId: s.parent_id.replaceAll("-", "").slice(0, 16) }
                : {}),
              name: s.name,
              kind: s.service === "slack" ? 3 : 1,
              startTimeUnixNano: String(BigInt(s.started_at) * 1000000n),
              endTimeUnixNano: String(
                BigInt(s.ended_at || s.started_at) * 1000000n,
              ),
              attributes: [
                {
                  key: "workflow.execution.id",
                  value: { stringValue: execution.id },
                },
                {
                  key: "workflow.attempt",
                  value: { intValue: String(s.attempt) },
                },
                {
                  key: "workflow.component",
                  value: { stringValue: s.service },
                },
              ],
              status: {
                code: s.status === "error" ? 2 : s.status === "success" ? 1 : 0,
                ...(s.error ? { message: s.error } : {}),
              },
            })),
          },
        ],
      },
    ],
  };
}
