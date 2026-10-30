# Security and reliability

## Implemented controls

- Managed authentication in production, enforced by every user-data API route. The loopback development mock is excluded from production builds.
- Personal workspace IDs derive from authenticated user IDs. Shared-workspace selection requires a current membership lookup on every request; knowing a workspace ID grants no access.
- Owner membership and role checks precede mutations; connection and configuration changes require admin.
- Browser mutations require an exact same-origin `Origin` header. OAuth callbacks instead require expiring, single-use, identity-bound state.
- JSON ingestion is streamed with a 64 KB limit. Events are reduced to an allowlist of fields; graph definitions are bounded and validated independently.
- Generic webhooks verify SHA-256 HMAC through WebCrypto over `timestamp.rawBody`; timestamps expire after five minutes. Event deduplication uses a unique SQL index.
- Tokens are encrypted with AES-GCM, a random IV, and workspace/provider associated data. A caller cannot transplant ciphertext between connections.
- Provider requests target fixed allowlisted endpoints and have six-second timeouts. User input cannot choose the provider URL.
- Trace data is recursively redacted; unknown payload fields are discarded. Token bodies and provider error bodies are not logged.
- Execution leases and a durable outbox prevent concurrent active processing and reuse confirmed receipts.
- Ambiguous delivery goes to manual review. It is not represented as a confirmed failure suitable for blind retry.
- Configuration updates use optimistic version checks and immutable snapshots in queued runs.
- Graph expressions are a fixed operation catalog, not evaluated JavaScript. No user-defined URL can become an HTTP destination. Transform field names reject prototype-sensitive keys.
- Approval decisions require same-origin requests and workspace write access; atomic state transitions prevent duplicate decisions. Node outputs in the inspector are redacted.
- Each action node owns a separate outbox receipt. Node checkpoints prevent successful actions from being repeated when another branch fails.
- Token refresh uses a leased, version-fenced claim; disconnect invalidates in-flight refresh, and interrupted single-use refresh requires reconnection. A second encryption key supports staged rewrapping.
- SQL-backed request rate limits and atomic ingestion, workflow and membership quotas apply per tenant/user.
- Maintenance MCP requires the pinned platform owner identity or a service bearer fingerprint. Ordinary workspace admins cannot invoke global recovery.
- Worker responses enforce nonce-based script CSP, restricted destinations, anti-sniffing, referrer/permissions policy and HTTPS HSTS. Browser animations initialize after mount. Inline styles remain allowed for canvas positioning; scripts do not use an unsafe-inline policy.
- Encrypted R2 logical backups require authenticated readback and checksum verification. Retention cleanup requires an admin, typed workspace confirmation and a recent verified backup.

## Guarantees and limits

At-least-once orchestration does not imply exactly-once external side effects. A worker can stop after a provider accepts a message but before the receipt commits. The outbox marks that window for investigation. `client_msg_id` is correlation assistance, not a claimed provider-level exactly-once contract.

Unattended recovery requires an enabled cloud task or cron invoking the restricted maintenance boundary. A stale heartbeat is observable; runtime code alone is not evidence that a scheduler is enabled. See STATUS and the production runbook for deployment verification.

The current webhook is an IntegrationOS generic signed envelope, not native HubSpot or Slack webhook-signature compatibility. Register provider-native ingestion only after implementing that provider's exact verification rules.

Independent security review, production-scale load/SLO acceptance, offsite recovery and key escrow, retention/data-classification decisions, and tamper-resistant audit archival remain owner-dependent gates. Company names and commercial values are stored as SQL business data; backup encryption and redaction do not replace a data-classification policy. The 100-execution local SQLite test is a bounded concurrency check, not a distributed production benchmark.

Live OAuth, revoked scopes, refresh errors, 429 behavior, service access, and actual provider deliveries must be tested against dedicated sandbox accounts. Adapter contract tests use stubbed provider responses and are explicitly not live-provider certification.

No third-party credentials or live customer data are included in the repository or demo seed.
