import { one, all, execute, auditLog } from "./store.mjs";
import { AppError, assertRole, hash } from "./security.mjs";
import {
  backupWorkspace,
  readBackup,
  retentionPreview,
  applyRetention,
} from "./backup.mjs";
import { stageContact, resolveConflict, syncPage } from "./sync.mjs";
import { rotateCredentials } from "./adapters.mjs";
import { rateLimit } from "./limits.mjs";
export async function webhookSecret(env, workspace) {
  if (!env.WEBHOOK_SECRET)
    throw new AppError("Webhook signing is not configured.", 409);
  const encoder = new TextEncoder(),
    key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode("integration-os:webhook:" + workspace),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function joinWorkspace(db, user, code) {
  if (typeof code !== "string" || code.length > 100)
    throw new AppError("Invalid invitation.");
  const invitation = await one(
    db,
    "DELETE FROM invitations WHERE id=? AND email=? AND expires_at>? RETURNING *",
    await hash(code),
    user.email.toLowerCase(),
    Date.now(),
  );
  if (!invitation)
    throw new AppError(
      "Invitation expired or does not match your signed-in email.",
      403,
    );
  await execute(
    db,
    "INSERT INTO members (id,workspace_id,user_id,role) VALUES (?,?,?,?) ON CONFLICT(workspace_id,user_id) DO NOTHING",
    crypto.randomUUID(),
    invitation.workspace_id,
    user.userId,
    invitation.role,
  );
  await auditLog(db, invitation.workspace_id, user.userId, "member.joined", {
    role: invitation.role,
  });
  return { workspace: invitation.workspace_id };
}
export async function operations(
  request,
  env,
  user,
  workspace,
  member,
  parts,
  input,
) {
  const db = env.DB,
    method = request.method,
    url = new URL(request.url),
    route = parts[1];
  try {
    parts = parts.map(decodeURIComponent);
  } catch {
    throw new AppError("Invalid route encoding.");
  }
  assertRole(member.role, "admin");
  if (route === "members") {
    if (method === "GET")
      return {
        members: await all(
          db,
          "SELECT user_id,role FROM members WHERE workspace_id=?",
          workspace,
        ),
      };
    if (method === "POST") {
      if (
        typeof input.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
        input.email.length > 254 ||
        !["viewer", "operator"].includes(input.role)
      )
        throw new AppError("Provide an email and a viewer or operator role.");
      const count = await one(
        db,
        "SELECT (SELECT COUNT(*) FROM members WHERE workspace_id=?)+(SELECT COUNT(*) FROM invitations WHERE workspace_id=? AND expires_at>?) AS n",
        workspace,
        workspace,
        Date.now(),
      );
      if (count.n >= 25)
        throw new AppError("Workspace member/invitation limit is 25.", 429);
      const code = crypto.randomUUID() + crypto.randomUUID();
      const created = await one(
        db,
        "INSERT INTO invitations (id,workspace_id,email,role,expires_at,created_by) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM members WHERE workspace_id=?)+(SELECT COUNT(*) FROM invitations WHERE workspace_id=? AND expires_at>?)<25 RETURNING id",
        await hash(code),
        workspace,
        input.email.toLowerCase(),
        input.role,
        Date.now() + 86400000,
        user.userId,
        workspace,
        workspace,
        Date.now(),
      );
      if (!created)
        throw new AppError("Workspace member/invitation limit is 25.", 429);
      await auditLog(db, workspace, user.userId, "member.invited", {
        role: input.role,
      });
      return { code, expiresInHours: 24, requiresSiteAccess: true };
    }
    if (method === "PUT" || method === "DELETE") {
      const target = input.userId;
      if (
        typeof target !== "string" ||
        target === user.userId ||
        workspace === "ws_" + (await hash(target)).slice(0, 24)
      )
        throw new AppError(
          "The workspace owner and your own membership cannot be changed here.",
          409,
        );
      if (
        method === "PUT" &&
        !["viewer", "operator", "admin"].includes(input.role)
      )
        throw new AppError("Invalid role.");
      const sql =
        method === "DELETE"
          ? "DELETE FROM members"
          : "UPDATE members SET role=?";
      const r = await one(
        db,
        sql +
          " WHERE workspace_id=? AND user_id=? AND (role!='admin' OR (SELECT COUNT(*) FROM members WHERE workspace_id=? AND role='admin')>1) RETURNING user_id",
        ...(method === "PUT" ? [input.role] : []),
        workspace,
        target,
        workspace,
      );
      if (!r)
        throw new AppError(
          "Member not found or the last admin cannot be removed.",
          409,
        );
      await auditLog(
        db,
        workspace,
        user.userId,
        "member." + (method === "DELETE" ? "removed" : "role_changed"),
        { userId: target, role: input.role || null },
      );
      return { updated: true };
    }
  }
  if (route === "backups") {
    if (method === "GET" && parts[2])
      return readBackup(db, env, workspace, parts[2]);
    if (method === "GET")
      return {
        backups: await all(
          db,
          "SELECT id,created_at,checksum,bytes,rows FROM backups WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30",
          workspace,
        ),
        configured: Boolean(env.BACKUPS && env.BACKUP_ENCRYPTION_KEY),
      };
    if (method === "POST") {
      await rateLimit(db, "backup:" + workspace, 5, 86400000);
      const result = await backupWorkspace(db, env, workspace);
      await auditLog(db, workspace, user.userId, "backup.verified", {
        id: result.id,
        rows: result.rows,
      });
      return result;
    }
  }
  if (route === "retention") {
    if (method === "GET")
      return retentionPreview(
        db,
        workspace,
        Number(url.searchParams.get("days") || 90),
      );
    if (method === "POST") {
      const result = await applyRetention(
        db,
        workspace,
        input.days,
        input.confirmation,
      );
      await auditLog(db, workspace, user.userId, "retention.applied", {
        days: input.days,
        executions: result.executions,
      });
      return result;
    }
  }
  if (route === "sync") {
    if (method === "GET")
      return {
        jobs: await all(
          db,
          "SELECT * FROM sync_jobs WHERE workspace_id=?",
          workspace,
        ),
        records: (
          await all(
            db,
            "SELECT * FROM sync_records WHERE workspace_id=? AND id>? ORDER BY id LIMIT 50",
            workspace,
            url.searchParams.get("after") || "",
          )
        ).map((r) => ({
          ...r,
          local_data: JSON.parse(r.local_data),
          remote_data: JSON.parse(r.remote_data),
        })),
      };
    const provider = parts[2];
    if (!["hubspot", "gmail", "slack"].includes(provider))
      throw new AppError("Invalid provider.");
    if (method === "PUT") {
      if (
        ![0, 1, 2].includes(input.enabled) ||
        (input.enabled === 2 && provider !== "hubspot")
      )
        throw new AppError(
          "Choose disabled, read mirror, or HubSpot two-way sync.",
        );
      const c = await one(
        db,
        "SELECT status FROM connections WHERE workspace_id=? AND provider=?",
        workspace,
        provider,
      );
      if (input.enabled && c?.status !== "connected")
        throw new AppError(
          "Connect a live provider before enabling continuous sync.",
          409,
        );
      await execute(
        db,
        "INSERT INTO sync_jobs (id,workspace_id,provider,enabled,next_at) VALUES (?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,next_at=0",
        workspace + ":" + provider,
        workspace,
        provider,
        input.enabled,
      );
      await auditLog(db, workspace, user.userId, "sync.configured", {
        provider,
        mode: input.enabled,
      });
      return { saved: true };
    }
    if (method === "POST" && parts[3] === "run") {
      const job = await one(
        db,
        "SELECT * FROM sync_jobs WHERE workspace_id=? AND provider=? AND enabled>0",
        workspace,
        provider,
      );
      if (!job) throw new AppError("Enable sync before running it.", 409);
      const result = await syncPage(db, env, job);
      await auditLog(db, workspace, user.userId, "sync.manual", { provider });
      return result;
    }
  }
  if (route === "records" && method === "PUT") {
    const r = await stageContact(
      db,
      workspace,
      parts[2],
      input.version,
      input.data,
    );
    await auditLog(db, workspace, user.userId, "contact.staged", { id: r.id });
    return r;
  }
  if (route === "records" && method === "POST") {
    const r = await resolveConflict(
      db,
      workspace,
      parts[2],
      input.version,
      input.decision,
    );
    await auditLog(db, workspace, user.userId, "contact.conflict_resolved", {
      id: r.id,
      decision: input.decision,
    });
    return r;
  }
  if (route === "rotate-credentials" && method === "POST") {
    const result = await rotateCredentials(db, env, workspace);
    await auditLog(db, workspace, user.userId, "credentials.rotated", result);
    return result;
  }
  if (route === "webhook" && method === "GET")
    return {
      workspace,
      signingSecret: await webhookSecret(env, workspace),
      algorithm: 'HMAC-SHA256(timestamp + "." + exact raw JSON body)',
    };
  throw new AppError("Operation not found.", 404);
}
