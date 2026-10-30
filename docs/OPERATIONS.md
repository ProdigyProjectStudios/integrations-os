# Operations guide

## Environment

Set secrets in hosting runtime settings. `.openai/hosting.json` contains resource declarations only. For local development, copy the variable names from `.env.example` into ignored `.dev.vars`. Use distinct random values for encryption, webhook signing, and worker access.

The private deployment requires managed sign-in. A service caller needs separately authorized platform service access in addition to application-level authentication. Do not embed platform service-access credentials into browser code, webhook query strings, source, or docs.

## Ingest a signed event

`POST /api/webhooks/{workspace_id}` accepts `{ "company": "Meridian Estates", "value": 4800, "region": "UK" }`.

Append `/{workflow_id}` to route a signed event to a specific published graph. The workflow must belong to that workspace. Console runs use `workflowId` in `POST /api/executions`. Input is snapshotted before dispatch.

Headers:

- `Content-Type: application/json`
- `Idempotency-Key`: a stable event ID of 8–180 characters
- `X-IOS-Timestamp`: current Unix time in seconds
- `X-IOS-Signature`: hex HMAC-SHA256 of `timestamp + "." + exactRawJsonBody`, keyed by this workspace's signing key from the admin-only `/api/ops/webhook` endpoint. The master `WEBHOOK_SECRET` is never distributed to workspace clients.

The workspace ID is shown in Workspace settings. A valid event returns 202 and its execution/trace ID. Repeated events reuse the original execution. Invalid signatures or stale timestamps return 401; invalid input returns 400; key conflicts return 409.

Webhooks use the workflow's published delivery mode. The browser launcher defaults to sandbox independently. Do not publish a live workflow until the provider connection and target channel are verified.

## Recovery wake

`POST /api/worker` performs an awaited, bounded maintenance wake. It requires a configured worker token or pinned Sites service bearer and does not bypass the private hosting boundary. The owner-restricted `recover_operations` MCP tool is intended for a linked Sites cloud task. See [the production runbook](PRODUCTION-RUNBOOK.md) for heartbeat checks, an expired-lease canary, key rotation and scheduler setup. A deployment outside Sites can bind the exported Worker `scheduled` handler to cron.

The normal execution path wakes immediately. Snapshot polling also wakes due work; pausing polling is not a durable worker pause. It only pauses UI updates. Jobs already dispatched continue.

## Graph operation and human decisions

Publish from Workflow Studio before running changed definitions. Publication validates topology and configuration and advances the version atomically. Node positions are stored with the definition. Undo/redo operates on the current draft; changing workflows is blocked until the draft is published or discarded.

Conditions route true/false edges. Independent ready nodes run concurrently. Joins wait for all parents to settle and accept any active route; parent data merges in source-ID order. Completed nodes are checkpoints, so a retry of a later action does not repeat an earlier delivery. The inspector exposes node IDs, dependency IDs, checkpoints, branch outputs and skipped spans.

Approval nodes stop at `waiting_approval` without occupying a worker lease. Review the request in Execution Inspector and approve/reject it. The decision is audited, atomically consumed, and resumes the same run/trace. A second decision returns 409. Read-only roles and other workspaces cannot decide.

Local browser tests use `.wrangler/e2e`, while normal development uses `.wrangler/state`. Do not start multiple Miniflare processes on the same SQL directory. Both environments use the same generated schema migrations.

## Failure triage

1. Open **Execution Inspector → Needs attention**.
2. Inspect all attempts, then filter the failing attempt.
3. Select the error span; inspect input, output, error, and correlated logs.
4. For confirmed failed sandbox runs, **Safe replay** removes the injected fault and creates a new linked run.
5. For `needs_review`, inspect the provider manually. Replay is intentionally blocked. There is no automated uncertainty-resolution UI in this release.
6. Export the JSON trace. The alternative `/api/executions/:id/otlp` endpoint returns OTLP/HTTP JSON under the same tenant authorization.

## Deployment and rollback

Build and test the exact source commit. The Sites source helper pushes and packages that commit; save and deploy the archive privately. Hosted SQL migrations are applied by the platform before worker deployment. Local migration state is never uploaded.

Before a later production schema change, create and verify a logical backup and arrange any required full database export through the host. Daily encrypted logical backups are attempted during idle maintenance wakes. Roll back application code only when it remains compatible with already-applied migrations. Same-project R2 logical backups do not provide offsite disaster recovery or point-in-time recovery; test restore into a new database using the runbook.

## Demo reset

Reference initialization is idempotent and preserves historical runs. Generate new events using the launcher. There is deliberately no destructive “reset all data” button in the product. Local disposable databases can be recreated by an operator after stopping the dev server; do not delete production data for a demo.
