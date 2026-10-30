"use client";
import { useEffect, useState } from "react";
import { workspaceHeaders } from "./workspace-api";
type Workspace = { id: string; name: string; role: string };
type Row = {
  id: string;
  provider: string;
  status: string;
  version: number;
  local_data: Record<string, string>;
  remote_data: Record<string, string>;
};
type ApiResult = {
  error?: string;
  members: { user_id: string; role: string }[];
  jobs: {
    provider: string;
    enabled: number;
    error: string | null;
    cursor: string | null;
  }[];
  records: Row[];
  backups: { id: string; created_at: number; rows: number }[];
  workspace: string;
  code: string;
  rows: number;
  executions: number;
};
async function call(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<ApiResult> {
  const r = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : method,
    headers: { "Content-Type": "application/json", ...workspaceHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = (await r.json()) as ApiResult;
  if (!r.ok) throw Error(result.error || "Request failed");
  return result;
}
function download(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function WorkspaceOperations({
  workspace,
  workspaces,
  maintenance,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  maintenance?: {
    stale: boolean;
    lastWake: { status: string; finished_at: number | null } | null;
  };
}) {
  const [tab, setTab] = useState("Recovery"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<{ user_id: string; role: string }[]>(
      [],
    ),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("viewer"),
    [invite, setInvite] = useState(""),
    [join, setJoin] = useState("");
  const [jobs, setJobs] = useState<
      {
        provider: string;
        enabled: number;
        error: string | null;
        cursor: string | null;
      }[]
    >([]),
    [records, setRecords] = useState<Row[]>([]),
    [editing, setEditing] = useState<Row | null>(null),
    [fields, setFields] = useState<Record<string, string>>({});
  const [backups, setBackups] = useState<
      { id: string; created_at: number; rows: number }[]
    >([]),
    [days, setDays] = useState(90),
    [preview, setPreview] = useState<number | null>(null),
    [confirmation, setConfirmation] = useState("");
  async function load() {
    if (workspace.role !== "admin") return;
    if (tab === "Members") setMembers((await call("ops/members")).members);
    if (tab === "Sync") {
      const r = await call("ops/sync");
      setJobs(r.jobs);
      setRecords(r.records);
    }
    if (tab === "Backups") setBackups((await call("ops/backups")).backups);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [tab]);
  async function act(fn: () => Promise<void>, refresh = true) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (refresh) await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function switchTo(id: string) {
    if (
      !window.dispatchEvent(
        new Event("integrationos:before-navigate", { cancelable: true }),
      )
    ) {
      setError(
        "Publish or discard your Studio draft before switching workspace.",
      );
      return;
    }
    sessionStorage.setItem("integrationos.workspace", id);
    window.location.assign("/?view=overview");
  }
  return (
    <div className="operations-panel">
      <label>
        Active workspace
        <select
          aria-label="Active workspace"
          value={workspace.id}
          onChange={(e) => switchTo(e.target.value)}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.role} · {w.id.slice(-5)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        <code>{workspace.id}</code> · {workspace.role}
      </p>
      <div className="operations-tabs">
        {["Recovery", "Members", "Sync", "Backups"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => {
              setTab(t);
              setError("");
              setNotice("");
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p className="operations-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="operations-notice" role="status">
          {notice}
        </p>
      )}
      {tab === "Recovery" ? (
        <>
          <h3>Unattended operations</h3>
          <p>
            Last wake:{" "}
            <strong>
              {maintenance?.lastWake?.finished_at
                ? new Date(maintenance.lastWake.finished_at).toLocaleString()
                : "Not recorded yet"}
            </strong>
          </p>
          <p>
            {maintenance?.lastWake?.status || "Awaiting first wake"} ·{" "}
            {maintenance?.stale
              ? "Recovery heartbeat is stale or not verified."
              : "Recent recovery heartbeat recorded."}
          </p>
          <p className="muted">
            Recovery runs outside this browser. Paused approvals and uncertain
            deliveries stay paused for review. Limits: 200 active executions,
            5,000 new runs per rolling day, 20 workflows, and 25 members or
            pending invitations per workspace.
          </p>
          <label>
            Invitation code
            <input
              value={join}
              onChange={(e) => setJoin(e.target.value)}
              placeholder="Paste your workspace invitation"
            />
          </label>
          <button
            disabled={busy || !join}
            onClick={() =>
              act(async () => {
                const r = await call("join", { code: join });
                switchTo(r.workspace);
              })
            }
          >
            Join workspace
          </button>
        </>
      ) : workspace.role !== "admin" ? (
        <p>Workspace administration requires an admin role.</p>
      ) : tab === "Members" ? (
        <>
          <h3>Members & invitations</h3>
          <p className="muted">
            Invitations expire after 24 hours and require the recipient’s
            verified email. The recipient must also be allowed through the
            site’s private sharing settings.
          </p>
          {members.map((m) => (
            <div className="operations-row" key={m.user_id}>
              <code>{m.user_id}</code>
              <select
                aria-label={"Role for " + m.user_id}
                value={m.role}
                disabled={busy}
                onChange={(e) =>
                  act(async () => {
                    await call(
                      "ops/members",
                      { userId: m.user_id, role: e.target.value },
                      "PUT",
                    );
                    setNotice("Role updated.");
                  })
                }
              >
                {["viewer", "operator", "admin"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await call("ops/members", { userId: m.user_id }, "DELETE");
                    setNotice("Member removed.");
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <label>
            Invite email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Invite role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option>viewer</option>
              <option>operator</option>
            </select>
          </label>
          <button
            disabled={busy || !email}
            onClick={() =>
              act(async () => {
                setInvite((await call("ops/members", { email, role })).code);
                setNotice(
                  "Invitation created. Share the code privately with the intended recipient.",
                );
              })
            }
          >
            Create invitation
          </button>
          {invite && (
            <textarea
              aria-label="Invitation code to share"
              readOnly
              value={invite}
            />
          )}
        </>
      ) : tab === "Sync" ? (
        <>
          <h3>Continuous provider sync</h3>
          <p className="muted">
            Read mirrors use durable pagination and reconciliation. HubSpot
            two-way mode sends only edits you stage below. Conflicting or
            uncertain writes require review.
          </p>
          {["hubspot", "gmail", "slack"].map((provider) => {
            const job = jobs.find((j) => j.provider === provider);
            return (
              <div className="operations-row" key={provider}>
                <strong>{provider}</strong>
                <select
                  aria-label={provider + " sync mode"}
                  value={job?.enabled || 0}
                  disabled={busy}
                  onChange={(e) =>
                    act(async () => {
                      await call(
                        "ops/sync/" + provider,
                        { enabled: Number(e.target.value) },
                        "PUT",
                      );
                      setNotice("Sync configuration saved.");
                    })
                  }
                >
                  <option value={0}>Disabled</option>
                  <option value={1}>Read mirror</option>
                  {provider === "hubspot" && (
                    <option value={2}>Two-way · staged edits</option>
                  )}
                </select>
                <button
                  disabled={busy || !job?.enabled}
                  onClick={() =>
                    act(async () => {
                      const r = await call("ops/sync/" + provider + "/run", {});
                      if (r.error) throw Error(r.error);
                      setNotice("Sync page completed.");
                    })
                  }
                >
                  Run page
                </button>
                {job?.error && <small>{job.error}</small>}
              </div>
            );
          })}
          {records.map((r) => (
            <div className="operations-record" key={r.id}>
              <strong>
                {r.local_data.company ||
                  r.local_data.name ||
                  r.local_data.id ||
                  r.id.split(":").pop()}
              </strong>
              <span>
                {r.provider} · {r.status}
              </span>
              {r.provider === "hubspot" &&
                ["synced", "pending"].includes(r.status) && (
                  <button
                    onClick={() => {
                      setEditing(r);
                      setFields({ ...r.local_data });
                    }}
                  >
                    Edit contact
                  </button>
                )}
              {["conflict", "uncertain"].includes(r.status) && (
                <>
                  <pre>
                    {JSON.stringify(
                      { local: r.local_data, remote: r.remote_data },
                      null,
                      2,
                    )}
                  </pre>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await call("ops/records/" + encodeURIComponent(r.id), {
                          version: r.version,
                          decision: "remote",
                        });
                      })
                    }
                  >
                    Keep remote
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await call("ops/records/" + encodeURIComponent(r.id), {
                          version: r.version,
                          decision: "local",
                        });
                      })
                    }
                  >
                    Stage local version
                  </button>
                </>
              )}
              {r.status === "uncertain" && (
                <p>
                  Inspect the provider before reconciling this record. Automatic
                  retries are blocked.
                </p>
              )}
            </div>
          ))}
          {records.length >= 50 && (
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const r = await call(
                    "ops/sync?after=" +
                      encodeURIComponent(records[records.length - 1].id),
                  );
                  setRecords((old) => [...old, ...r.records]);
                }, false)
              }
            >
              Load more records
            </button>
          )}
          {editing && (
            <div className="operations-edit">
              <h4>Stage contact changes</h4>
              {["firstname", "lastname", "email", "company"].map((f) => (
                <label key={f}>
                  {f}
                  <input
                    value={fields[f] || ""}
                    onChange={(e) =>
                      setFields((v) => ({ ...v, [f]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await call(
                      "ops/records/" + encodeURIComponent(editing.id),
                      { version: editing.version, data: fields },
                      "PUT",
                    );
                    setEditing(null);
                    setNotice(
                      "Edit staged. Two-way sync sends it after checking the remote version.",
                    );
                  })
                }
              >
                Stage edit
              </button>
              <button onClick={() => setEditing(null)}>Cancel</button>
            </div>
          )}
        </>
      ) : (
        <>
          <h3>Verified, encrypted backups</h3>
          <p className="muted">
            Daily logical backups use protected object storage. Downloads
            contain workspace data, with provider credentials removed. Restore
            into a new database using the repository’s restore command.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await call("ops/backups", {});
                setNotice("Backup verified · " + r.rows + " rows.");
              })
            }
          >
            Create verified backup
          </button>
          {backups.map((b) => (
            <div className="operations-row" key={b.id}>
              <span>
                {new Date(b.created_at).toLocaleString()} · {b.rows} rows
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  act(async () =>
                    download(
                      await call("ops/backups/" + b.id),
                      "integration-os-backup-" + b.id + ".json",
                    ),
                  )
                }
              >
                Download backup
              </button>
            </div>
          ))}
          <h4>Retention preview</h4>
          <p className="muted">
            Automatic deletion is disabled. Cleanup removes old trace bodies and
            payloads while preserving delivery and idempotency evidence. Create
            a fresh verified backup before applying it.
          </p>
          <label>
            Keep history for days
            <input
              type="number"
              min={7}
              max={3650}
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setPreview(null);
              }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              act(async () =>
                setPreview(
                  (await call("ops/retention?days=" + days)).executions,
                ),
              )
            }
          >
            Preview retention
          </button>
          {preview !== null && (
            <>
              <p>{preview} completed executions qualify.</p>
              <label>
                Confirm workspace ID
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <button
                disabled={
                  busy || confirmation !== workspace.id || preview === 0
                }
                onClick={() =>
                  act(async () => {
                    await call("ops/retention", { days, confirmation });
                    setNotice("Retention cleanup completed.");
                    setPreview(null);
                    setConfirmation("");
                  })
                }
              >
                Apply retention cleanup
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
