# Phase 1 production operations

## Recovery

The owner-only Site provides `recover_operations` and `operations_status` through its hosted MCP connection. These tools require MCP OAuth and the pinned owner identity; ordinary workspace admin roles cannot invoke global maintenance. A service caller instead uses `/api/worker` and `/api/worker/status`, sending the current Site service credential in both `OAI-Sites-Authorization` and `Authorization`. The service credential alone does not authenticate the separate `/mcp` OAuth boundary. The platform validates the first header; the application validates the second against `SITE_SERVICE_TOKEN_SHA256`. Only the digest is stored in runtime configuration. No credential belongs in a schedule prompt, URL, source file, or browser bundle.

The application still supports an independently supplied `WORKER_TOKEN` for operators deploying elsewhere. `POST /api/worker` now waits for a bounded maintenance result; `GET /api/worker/status` reads persisted results. A deployment outside Sites may attach the exported `scheduled` handler to its own cron. Scheduler cadence is a recovery target, not a guaranteed delivery SLA.

Execution recovery takes priority. When a wake drains executions, it defers sync/export/backup to a subsequent wake. Call again when the response reports `deferredOtherWork`, or when due work remains, at most three calls per scheduled run. A global fenced lock prevents overlapping maintenance. Individual execution leases and per-node receipts remain authoritative. Approval waits and uncertain deliveries are never approved or replayed automatically.

Every wake records start, finish, result and aggregate queue state in `maintenance_runs`. Workspace operations shows the heartbeat and flags it stale after 75 minutes by default, allowing for the managed scheduler's hourly minimum. Set MAINTENANCE_STALE_AFTER_MINUTES when using a different scheduler cadence. A crashed maintenance run is marked interrupted by its successor. The recovery canary endpoint creates an explicitly labelled, sandbox-only expired-lease fixture with a completed trigger checkpoint and deliberately does not wake the engine. It is capped at six probes per day. The automated hard-crash test separately exits a real child process immediately after committing a delivery receipt and verifies that recovery does not repeat that delivery.

If the platform service credential rotates, update its digest and deploy before resuming the service caller. Never remove authentication to get a schedule working. If the owner's verified email changes, update `SITE_OWNER_EMAIL_SHA256` through the controlled deployment path. Site audience remains owner-private; workspace invitations do not change Site sharing.

## Provider synchronization

Sync is disabled by default. Connect a provider, then use **Workspace settings → Sync** to enable a read mirror or HubSpot two-way mode. Each wake processes a bounded page from one due connection. Cursors, scan generations, local edits and remote baselines are durable. A full completed scan marks missing records; it does not delete remote objects. Mirrors are limited to 5,000 records per connection.

HubSpot supports existing-contact updates to firstname, lastname, email and company. An admin stages an edit; two-way mode compares the current remote baseline, patches only changed fields, and reads the object back. Concurrent remote changes become explicit conflicts. A timed-out or interrupted write becomes uncertain and requires human review. HubSpot does not expose a transactional compare-and-swap for this update: another writer can still race between the read and PATCH. Use a single writer per contact set or a dedicated integration sandbox until this limitation is accepted. This implementation does not create or delete contacts remotely.

Gmail mirrors message IDs/thread IDs under `gmail.readonly`; Slack mirrors channel metadata. Their writes are not presented as bidirectional sync. Slack messages remain explicit workflow actions with delivery receipts. Gmail history streaming, message-body ingestion, outbound mail, and provider webhook subscriptions are outside this bounded Phase 1 connector scope.

## Credentials and rotation

OAuth refresh uses an atomic database lease and token version. A second worker waits/retries; late results cannot resurrect a locally disconnected connection. Missing or malformed access tokens are rejected. An abandoned refresh lease requires reconnecting, because a rotating provider may have consumed its refresh token before interruption.

To rotate credential encryption without exposing an old key: add `TOKEN_ENCRYPTION_KEY_NEXT` as a new secret, deploy, invoke `POST /api/ops/rotate-credentials` for each admin workspace, and verify every response has `pending: 0`. New writes already use NEXT; reads accept either key. After in-flight refreshes have settled, recheck all workspaces, promote that same new value to `TOKEN_ENCRYPTION_KEY`, remove NEXT, and deploy. Keep the new value in your approved secret-management system during this procedure. Never discard the old key while old ciphertext remains. Real provider refresh/revocation still requires live-account validation.

Removing a connection is a local disconnect and fences in-flight refresh results. Revoke the provider grant in Slack, HubSpot or Google settings as well; local removal does not claim remote revocation. In-flight provider actions may already have completed.

Webhook signing is now workspace-scoped. An admin can retrieve their derived signing key through `GET /api/ops/webhook`; it never exposes the global master key. Sign `timestamp + "." + exactRawJsonBody` using HMAC-SHA256 and keep the existing timestamp/idempotency headers. A workspace key cannot authenticate another workspace's webhook.

## Backups and retention

The managed `BACKUPS` object-store binding holds AES-GCM-encrypted logical workspace snapshots. The worker creates one due workspace backup per non-recovery wake, targeting a daily interval. Each backup uses a consistent SQL batch, is read back and authenticated, and has its checksum verified before it is recorded as successful. Limits are 25,000 rows and 8 MB per workspace snapshot; oversized workspaces report an actionable failure rather than a truncated backup. Provider credentials and enabled sync settings are removed from downloads; reconnect providers after restore.

An admin can create, list and download verified backups from Workspace operations. Test recovery into a **new** database:

```sh
node scripts/restore-backup.mjs downloaded-backup.json NEW-database.sqlite
```

The restore tool refuses existing targets, applies the committed migrations, validates columns and tenant boundaries, inserts the snapshot transactionally and performs SQLite integrity checking. This is a logical restore rehearsal, not point-in-time recovery of the managed production database. Backups remain in the same hosting project. Off-site replication, key escrow, provider-level disaster recovery and agreed RPO/RTO still need an operator decision/platform facility.

Automatic history deletion is disabled. The retention preview defaults to 90 days but makes no changes. Applying cleanup requires an admin, exact workspace-ID confirmation and a verified backup less than an hour old. It removes old completed trace bodies, payloads and receipt contents while retaining idempotency/delivery tombstones. It excludes active runs, approval waits and uncertain deliveries. This does not purge older backup objects or identity/audit metadata and is not a claim of regulatory erasure compliance.

## Telemetry

The engine uses the OpenTelemetry trace SDK with an isolated provider and explicit parent context per execution. Persisted spans and SDK spans share IDs and start/end timestamps. Export payloads omit event bodies and contact details. Configure `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` for an HTTPS OTLP/HTTP JSON receiver and, if needed, `OTEL_EXPORTER_OTLP_AUTHORIZATION` as a secret. The collector transport uses a SQL outbox, fenced claims, timeouts, exponential backoff and an eight-attempt failure state. Delivery is at least once; the collector should deduplicate by trace/span ID. Collector failures do not fail business workflows. Without an endpoint, durable inspector traces continue and no export backlog is accumulated.

## Operational limits and release checks

Per workspace: 200 active executions, 5,000 new executions in a rolling 24 hours, 20 workflows, 25 members/invitations. Ingestion and publication limits are checked atomically. Per authenticated user: 300 reads and 120 writes per minute. Database rate counters work across isolates. Reverse-proxy edge protection remains the hosting platform's responsibility.

Local verification includes a 100-execution/10-tenant concurrent-drain load test, a real local HTTP collector test, fenced refresh contracts, crash recovery, encrypted backup restoration and desktop/mobile browser checks. Local SQLite timing is not a hosted load benchmark or a production SLO. Independent security review and real provider acceptance tests remain release requirements.
