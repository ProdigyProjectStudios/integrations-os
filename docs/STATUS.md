# Phase 1 implementation and production gates

## Implemented

- [x] Command Center metrics and Execution Inspector waterfalls come from persisted engine runs, measured spans, receipts and audit records.
- [x] React Flow Studio supports drag/drop, wiring, configuration, undo/redo, import/export, publication, multiple workflows and concurrent-edit protection.
- [x] DAG execution supports branches, parallel dependencies, joins, durable node checkpoints, human approval and explicitly labelled sandbox/live adapters.
- [x] GSAP, Lenis and licensed React Bits interactions respect reduced motion. Animation initialization stays in browser effects.
- [x] SQL queue claims, idempotency, backoff, dead letters and conservative uncertain-delivery handling.
- [x] Browser-independent maintenance endpoints, owner-restricted MCP, fenced maintenance, heartbeat status and an expired-lease canary.
- [x] Stable Vinext 1.4 and patched dependencies; nonce script CSP and additional HTTP security headers.
- [x] Shared-workspace selection, email-bound invitations, RBAC membership administration, per-user rate limits and atomic tenant quotas.
- [x] Fenced OAuth refresh, disconnect-race protection, encryption-key rewrapping and workspace-specific webhook keys.
- [x] Opt-in paginated synchronization with durable cursors and reconciliation. HubSpot existing-contact edits support staged two-way sync and conflict/uncertain-write review. Slack and Gmail are read mirrors.
- [x] OpenTelemetry SDK spans use engine IDs and a durable HTTP export outbox without event payloads.
- [x] Encrypted logical R2 backups with verified readback/checksums, restore into a new database, retention preview and guarded manual cleanup.
- [x] CI quality/audit/browser gates and a Docker API smoke job are prepared.

## Local verification

- 48 backend tests pass against SQLite and generated migrations. Coverage includes a hard process exit after a delivery receipt, checkpoint recovery, refresh races, tenant isolation, quota races, sync conflicts, restore integrity, a real local HTTP collector, portfolio authorization and isolated public sandbox execution/cleanup.
- 12 desktop/mobile Playwright tests pass against the built Worker. Coverage includes graph editing/execution/traces, approvals, publication conflicts, integrations, membership operations, verified backups, retention preview, responsive layout and CSP violations.
- Two additional desktop/mobile portfolio checks pass on the final build, including recorded trace selection and absence of administrative controls. The working tree and all 218 pre-release Git history blobs passed the credential-pattern/secret-file scan before publication; runtime secrets remain outside Git.
- The interactive public sandbox adds two passing desktop/mobile checks (16 browser checks total): edit and wire a graph, publish, execute, inspect real node output, reload, and reject cross-visitor trace access. Anonymous checks explicitly remove the simulated owner headers used by the private-app test harness.
- Type checking and the production Worker/client build pass.
- The final dependency audit reports **0 vulnerabilities** at this release's audit time.
- A bounded local load check drains 100 executions across 10 tenants with two concurrent drain callers. This is not a distributed capacity or production-SLO certification.

## Hosted acceptance

The hosted Phase 1 deployment was verified on 30 October 2026. The enabled managed recovery job `Automation_1b1a1aaf7a8c8191a52236a1ace947cf` runs hourly at :47 (Europe/London); the platform permits at most one scheduled run per hour. Its initial unattended run recovered expired-lease canary `14e013ab-1961-467c-b3d2-f4ba3f071d3a`, trace `0e7cb507677049a29fe0ca6ef74062f9`, to success on attempt 2 at 03:45:54 UTC without a manual recovery request. Maintenance `cbdf4d70-01e3-4586-948c-3c644f3733fe` then completed at 03:46:04 UTC with no due execution work. Encrypted R2 backup `4e22bf32-60fb-47de-a9c1-0124df6a913e` passed readback/checksum verification and excluded credentials.

The Site is publicly shared. `/portfolio` contains explicitly allowlisted recorded sandbox runs and links to the interactive `/demo` Studio. Visitors get individual cookie-bound sandbox tenants and execute their own published graphs with persisted engine traces. The visitor API rejects live mode and all administration; normal workspace APIs retain the pinned-owner guard. See [PUBLIC-DEMO.md](PUBLIC-DEMO.md) for quotas, lifecycle and verification. Do not disable `PUBLIC_PORTFOLIO_ONLY` on this publicly shared portfolio instance.

## Owner-dependent acceptance

- [ ] Live Slack, HubSpot and Gmail consent, refresh/revocation, scope-loss/rate-limit handling and provider-side delivery/sync readback using dedicated test accounts.
- [ ] Live AI provider acceptance and an external OTLP collector endpoint/authorization.
- [ ] HubSpot concurrent-writer policy: its read/patch API has no transactional compare-and-swap; use a single writer or disposable test contacts until accepted.
- [ ] A successful GitHub-hosted CI/Docker run after repository publication under ProdigyProjectStudios. Local tests/build pass; Docker is not installed in this environment. Check the repository Actions page for the final hosted result.
- [ ] Offsite backup destination, key escrow, RPO/RTO and restore rehearsal; same-project R2 logical backups are not PITR or an independent disaster-recovery copy.
- [ ] Retention/data classification, production traffic/SLO targets and independent security review. Automatic retention deletion stays disabled.
- [ ] Comparison with the original visual reference, if exact matching remains required; the original image was absent from the attachment.

Exact environment names, redirect URLs, scopes and account requirements are in [OWNER-SETUP.md](OWNER-SETUP.md). Operational limits and procedures are in [PRODUCTION-RUNBOOK.md](PRODUCTION-RUNBOOK.md).

## Rollout and scope

Migrations are additive and preserve historical traces/receipts. Legacy fixed pipelines remain runnable; Studio publication promotes them to executable graphs. Maintenance never automatically approves decisions or replays uncertain deliveries.

This closes implementation gaps within the documented operating envelope; it is not blanket production certification. Document Intelligence and PropertyOps remain later phases.
