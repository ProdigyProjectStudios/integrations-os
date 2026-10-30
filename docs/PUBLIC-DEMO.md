# Public interactive sandbox

Share `https://integration-os-command.smart-wren-7193.chatgpt.site/demo` for the interactive Studio, or `/portfolio` for the introduction and recorded trace examples.

Visitors can drag and connect graph nodes, configure steps, import/export graphs, create up to five workflows, publish sandbox versions, run test events, simulate retries, resolve approvals within their own sandbox, and inspect measured execution spans and outputs. This uses the same SQL-backed engine and Workflow Studio as the private application. Sandbox adapters simulate external systems; no provider delivery, OAuth or live AI request is made.

## Isolation

`POST /api/demo/session` issues a random 256-bit opaque cookie: HttpOnly, Secure, SameSite=Strict, host-only, with a 24-hour lifetime. Only its SHA-256 digest is stored. Each session gets an independent tenant and synthetic internal identity. Gateway identity, workspace headers, workflow IDs and execution IDs cannot select another tenant. Normal `/api/*` endpoints continue to require owner authorization on this deployment; demo cookies grant no access to them. Opening the demo as the owner also uses a separate visitor tenant.

The visitor API explicitly allows only session creation, its own snapshot, workflow creation/publication, sandbox execution/replay, trace reads/exports, and its own workflow approval decisions. It rejects workspace switching, membership, invitations, integrations, OAuth, sync, webhook keys, backups, retention, global recovery and all other routes. Live workflow publication and execution are rejected server-side. Only the database binding enters visitor execution; provider, backup, signing and telemetry secrets are withheld. Recovery can resume persisted sandbox runs without enabling external adapters.

The browser hides integration/admin navigation and live-mode choices. These UI restrictions complement the server checks; they are not the authorization boundary. The application depends on Sites dispatch stripping untrusted gateway identity headers, as verified on the hosted public deployment.

## Limits and lifecycle

- One browser cookie shares a sandbox across tabs; different browser sessions have independent tenants.
- Maximum 30 run submissions and five workflows per session. Invalid/repeated submissions can consume run allowance. Six run submissions per minute; normal graph validation bounds each workflow to 24 nodes and 48 edges.
- Session creation: 10/hour per gateway IP, 40/hour and 200/day globally. Execution submissions: 300/hour and 1,000/day globally. Shared networks may share an IP allowance. No CAPTCHA or paid abuse protection is claimed.
- Cookie access expires after 24 hours. Hourly maintenance deletes up to 50 expired visitor tenants per wake, deferring tenants with an active execution lease. Deletion includes graphs, payloads, traces and checkpoints. Data can remain longer if maintenance is delayed; expired sessions cannot access it.
- Guest tenants are excluded from scheduled backups and their spans are not exported to external OTLP collectors. Owner workspaces are never eligible for visitor cleanup.

Use synthetic/sample data. Visitors can export their graph before expiry; this is a portfolio sandbox, not durable customer storage.

## Verification

Backend checks cover graph execution/output, owner and visitor isolation, cross-tenant read/write attacks, live-mode rejection, denied administrative routes, CSRF, forged/expired cookies, bounded session bodies, atomic run quotas, backup/export exclusion and cleanup that preserves owner data and active leases. Desktop/mobile browser checks create and wire a node, publish it, execute it, inspect its real output, reload persisted traces, and verify a second browser cannot read the first browser's execution.

Private multi-user deployments can disable `PUBLIC_PORTFOLIO_ONLY`; keep it enabled on this publicly shared portfolio instance. Live third-party verification remains in [OWNER-SETUP.md](OWNER-SETUP.md). No Phase 2 or Phase 3 functionality is included.
