# Architecture decisions

## ADR 001 — Deploy the engine alongside the interface

**Decision:** use the hosting platform's React/Vinext Worker runtime with D1 SQL. The requested FastAPI/PostgreSQL/Redis/Celery stack is a preference, but cannot run on this managed host. All operations in the deployed interface must use a real backend. A modular Worker is preferable here to a decorative frontend over mocked responses.

**Consequences:** one deployable service, one durable store, no separately managed broker. Queue rows and execution rows share a transaction boundary. D1 SQL is SQLite-compatible, not PostgreSQL. The adapter has been upgraded to stable Vinext 1.4; production API and MCP routes stay at the Worker boundary. For a later Python deployment, preserve the HTTP contracts and execution state model while porting the claim/run/store modules, use `SELECT FOR UPDATE SKIP LOCKED` on PostgreSQL, and keep the outbox's uncertain-delivery semantics.

## ADR 002 — Durable SQL queue with leases

New events persist before the API returns 202. Worker wakes run through `waitUntil`, independent of the browser response. An atomic conditional `UPDATE ... RETURNING` claims a due execution. Concurrent workers cannot claim the same active lease. Leases expire after 60 seconds; the background platform limit is 30 seconds. A new attempt closes abandoned running spans, then resumes the pipeline.

Work wakes on enqueue and snapshot requests. A bounded maintenance wake also recovers expired leases without a browser, through the Worker `scheduled` handler, authenticated `POST /api/worker`, or owner-pinned `recover_operations` MCP tool. A SQL fence prevents overlapping maintenance, and heartbeat records expose stale wakes. Execution recovery takes priority over sync, telemetry and backups. Scheduling is a separate Sites cloud task, not a cron inferred from the hosting manifest; its deployment evidence is recorded in STATUS. Without an enabled scheduler, only request-triggered recovery is available.

## ADR 003 — At-least-once execution, conservative side effects

Idempotency is unique per workspace and client key. Reusing a key with different normalized inputs, scenario, or delivery mode returns 409. Each run snapshots its workflow version and configuration. Retries use the same execution ID; explicit replay creates a new trace and links `replay_of`.

Before external delivery, an outbox record changes to `sending`. A successful response is persisted as `delivered`. Future attempts reuse that receipt. A confirmed rate limit is retryable. Interrupted requests and other ambiguous failures become `uncertain` and stop in `needs_review`; replay is blocked. There is no distributed transaction with Slack, and no exactly-once guarantee. The engine chooses avoiding an accidental duplicate over automatically retrying an unknown outcome.

## ADR 004 — Durable trace data is the source of truth

Each attempt has a root orchestration span; validation, parallel normalization and delivery lookup, rules, rendering, delivery, and audit are children. Start/end times come from the worker clock. Sandbox adapters deliberately await bounded test latency to make overlap visible; the UI never invents durations. Logical component labels identify stages inside the Worker, not separately deployed microservices.

Trace IDs are 32 hex characters; new span IDs are 16 hex characters. The live adapter propagates a W3C trace context header. An OpenTelemetry SDK provider emits the persisted IDs, hierarchy, measured times and status into a leased export outbox; an optional HTTPS OTLP/HTTP JSON collector receives bounded, retried batches. A real local HTTP receiver test verifies ingestion and excludes event payloads. External collector acceptance still requires a configured endpoint. The authenticated `GET /api/executions/:id/otlp` export remains available. Provider instrumentation outside this system remains dependent on that provider.

## ADR 005 — Executable, validated graph definitions

The React Flow editor serializes only node IDs, kinds, labels, positions, validated configuration and edges. The server rejects cycles, unreachable nodes, duplicate IDs/connections, unsupported handles, unsafe field names and oversized definitions. Each workspace supports 20 workflows; each graph supports 24 nodes and 48 edges. Optimistic publication versions prevent silent concurrent edits. Executions snapshot the complete published definition. Older fixed-pipeline definitions remain executable for compatibility until republished as graphs.

The executor follows dependency readiness, runs at most four independent nodes concurrently, and persists node status/output in `node_results`. A condition selects true or false edges. Inactive paths get explicit skipped spans. A join waits for all parents and runs if any incoming route is active; it merges active parent outputs in source-ID order (later parent wins for conflicting fields). This is deterministic, documented any-branch join semantics, not an implicit all-branches-must-match join.

Successful node checkpoints are reused on retry and recovery. Each external action has its own outbox key and stable provider correlation ID, preventing unrelated action nodes from sharing receipts. The graph engine uses per-node retry counts. A bounded execution slice yields back to the queue when necessary. Every attempt, including resumption, has its own root span and checkpoint-reuse evidence.

Approval nodes persist `waiting` and release the lease. Workspace-authorized decisions atomically consume a waiting request, append an audit event and requeue the same execution. Rejection stops downstream work. AI nodes use a configured Responses API model with a strict category schema; test adapters are explicitly labeled. AI and connector actions never run in live mode without the required deployment configuration.

The graph and checkpoint migration is additive. No existing execution or receipt is rewritten. Legacy idempotency hashes remain recognized for the same workflow.

The identity boundary provisions one owner workspace per user. Server-side role checks support viewer/operator/admin, but multi-user membership administration is not yet exposed. Shared workspaces require a later membership/invitation design and audit coverage.
