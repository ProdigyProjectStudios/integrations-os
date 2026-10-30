# Remaining owner setup

Do not paste secrets into chat. Configure sensitive values through the Site's runtime environment settings, then deploy the new environment revision. Infrastructure encryption/signing keys and maintenance identity pins were provisioned by this task; you do not need to supply them to enable the current sandbox and recovery checks.

## Provider accounts

| Integration | Runtime values | Required account choice |
| --- | --- | --- |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | An installation in a test workspace and a channel ID the bot may post to; scopes `chat:write,channels:read`. |
| HubSpot | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | A developer/test portal with disposable contacts; scopes `crm.objects.contacts.read crm.objects.contacts.write`. |
| Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | A Google OAuth web client and permitted test mailbox; scope `https://www.googleapis.com/auth/gmail.readonly`, offline access. |
| Live AI | `OPENAI_API_KEY`, `OPENAI_MODEL` | An approved project/model and spending policy. The OpenAI Developers connection can be enabled to provision a key through its supported approval flow. |
| External traces | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, optionally `OTEL_EXPORTER_OTLP_AUTHORIZATION` | An HTTPS OTLP/HTTP JSON collector, with its retention/access policy. |

Register these exact redirect URLs with the relevant OAuth apps:

- Slack: `https://integration-os-command.smart-wren-7193.chatgpt.site/api/connections/slack/callback`
- HubSpot: `https://integration-os-command.smart-wren-7193.chatgpt.site/api/connections/hubspot/callback`
- Google: `https://integration-os-command.smart-wren-7193.chatgpt.site/api/connections/gmail/callback`

After configuring clients, use Integration Hub to grant consent. Agree on a disposable Slack message and HubSpot contact change for live acceptance testing. Keep continuous sync disabled until the test account is connected; explicitly choose two-way mode only for the intended HubSpot contact set. Google verification/test-user restrictions and provider app approvals are account-side prerequisites.

## Remaining decisions/access

- No recovery credentials are required: the enabled hourly cloud task obtains the current Site credential at run time and successfully recovered the hosted canary. The optional chat MCP connection still needs authenticated tool-call verification; it is not used by the recovery job. A sub-hour recovery target needs an external scheduler with deployment access because this platform limits schedules to one run per hour.
- The repository is being published privately under `ProdigyProjectStudios` with existing GitHub authentication. Check its Actions page for hosted CI/Docker results; Docker is not installed on this machine.
- Choose off-site backup destination/key escrow and desired recovery-point/recovery-time objectives. Current encrypted logical backups share the Site's hosting project.
- Decide how long to retain history and backup objects. Automatic destructive retention is currently disabled.
- Arrange an independent security review and define expected production traffic/SLOs for a hosted load test.
- Supply the original screenshot only if comparison against that reference is still an acceptance requirement.

These are separate from application implementation. A passing sandbox test does not certify OAuth consent, remote revocation, live provider rate limits, collector authentication, independent audit, or a disaster restore of the hosting platform.

## Exact live verification checklist

For each OAuth provider: grant consent in the test account, verify the granted scopes, run one bounded sync, verify pagination/cursor persistence, force token expiry and verify one refresh under concurrent calls, revoke the grant remotely, and confirm reconnect-required behavior. Validate missing scopes and provider 429/Retry-After handling using a controlled provider test or supported test harness; local fault injection alone does not prove live behavior.

For Slack: choose an authorized disposable channel, run a single live message action, confirm its provider message identifier and content, then verify checkpoint recovery/replay does not repeat delivery. For HubSpot: choose a disposable existing contact, verify read mirror, stage one permitted field update, read it back remotely, and exercise a remote-edit conflict plus uncertain-write review. Accept the single-writer limitation before enabling two-way sync. For Gmail: verify read-only message/thread ID results against the test mailbox and ensure no send/write scopes are requested.

For live AI: choose the approved model/budget, execute one redacted classification and inspect the recorded result/error paths. For external traces: provide collector endpoint/authentication, verify an engine trace by its exact trace/span IDs in the collector, then simulate an unavailable collector and confirm outbox retry/deduplication behavior.

## Sharing the portfolio

The Site is public. `/portfolio` introduces the product; `/demo` lets visitors build and run sandbox workflows in isolated, temporary tenants with real engine traces. `PUBLIC_PORTFOLIO_ONLY=true` restricts all normal workspace APIs to the pinned Site owner, even for signed-in visitors. The separate visitor API permits only sandbox capabilities; it cannot access owner data, live provider credentials or administration. Worker recovery still needs its service credential and webhooks still need a valid workspace HMAC. Shared-workspace invitees are also denied on this portfolio deployment. Keep a separate private deployment with the flag disabled for multi-user operations. Isolation, session expiry and resource limits are documented in [PUBLIC-DEMO.md](PUBLIC-DEMO.md).
