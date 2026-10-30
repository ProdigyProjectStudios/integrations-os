import {
  AppError,
  id,
  hash,
  redact,
  assertRole,
  checkOrigin,
  verifyWebhook,
} from "./security.mjs";
import {
  one,
  all,
  execute,
  workspaceFor,
  auditLog,
  defaultConfig,
} from "./store.mjs";
import { referenceGraph } from "./graph.mjs";
import { enqueue, drain, seed, validateConfig } from "./engine.mjs";
import {
  providers,
  providerConfigured,
  exchange,
  saveTokens,
  synchronize,
} from "./adapters.mjs";
import { toOtlp } from "./telemetry.mjs";
import {
  authorizeWorker,
  recover,
  maintenanceStatus,
  recoveryProbe,
} from "./maintenance.mjs";
import { rateLimit } from "./limits.mjs";
import { operations, joinWorkspace, webhookSecret } from "./operations.mjs";
import { workspaceAccess } from "./portfolio.mjs";
import { handleDemo } from "./demo.mjs";

const reply = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function bodyText(request) {
  if (!request.body) throw new AppError("A JSON body is required.");
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) {
      await reader.cancel();
      throw new AppError("Request exceeds 64 KB.", 413);
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buffer.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(buffer);
}
async function jsonBody(raw) {
  try {
    const value = JSON.parse(raw || "");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new AppError("A JSON object is required.");
    return value;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Invalid JSON.");
  }
}
export async function handleApi(request, env, user, background, demoSession = null) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/");
  const route = parts[0];
  const db = env.DB;
  try {
    if (route === "demo" && !demoSession)
      return await handleDemo(request, env, background, handleApi);
    // Drain every bounded body, including bodyless-action endpoints. Leaving a
    // POST stream unread can terminate a reused connection in local workerd.
    const rawBody = request.body ? await bodyText(request) : null;
    if (!db) throw new AppError("Database binding unavailable.", 503);
    if (route === "health")
      return reply({
        status: "ok",
        storage: (await one(db, "SELECT 1 AS ok")).ok === 1,
      });
    if (route === "worker") {
      await authorizeWorker(request, env);
      if (request.method === "GET" && parts[1] === "status")
        return reply(await maintenanceStatus(db, env));
      if (request.method === "POST") {
        await rateLimit(db, "worker", 12);
        if (parts[1] === "probe") return reply(await recoveryProbe(db), 202);
        if (!parts[1]) return reply(await recover(db, env));
      }
      throw new AppError("Worker operation not found.", 404);
    }
    if (route === "webhooks" && request.method === "POST") {
      const raw = rawBody || "";
      if (
        !(await verifyWebhook(
          await webhookSecret(env, parts[1]),
          request.headers.get("x-ios-timestamp"),
          request.headers.get("x-ios-signature"),
          raw,
        ))
      )
        throw new AppError("Invalid or expired webhook signature.", 401);
      const workspace = parts[1];
      if (!(await one(db, "SELECT id FROM workspaces WHERE id=?", workspace)))
        throw new AppError("Workspace not found.", 404);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new AppError("Invalid JSON.");
      }
      const execution = await enqueue(
        db,
        workspace,
        "webhook",
        payload,
        request.headers.get("idempotency-key"),
        { source: "signed-webhook", workflowId: parts[2] },
      );
      background(drain(db, env, workspace));
      return reply(
        {
          id: execution.id,
          status: execution.status,
          trace_id: execution.trace_id,
        },
        202,
      );
    }
    if (!user?.userId)
      throw new AppError("Sign in to open your workspace.", 401);
    if (!demoSession && !(await workspaceAccess(user, env)))
      throw new AppError("This portfolio is read-only. Workspace access is restricted to its owner.", 403);
    await rateLimit(
      db,
      "user:" +
        user.userId +
        ":" +
        (request.method === "GET" ? "read" : "write"),
      request.method === "GET" ? 300 : 120,
    );
    if (route === "join" && request.method === "POST") {
      checkOrigin(request);
      return reply(
        await joinWorkspace(db, user, (await jsonBody(rawBody)).code),
      );
    }
    const personal = demoSession ? demoSession.workspace_id : await workspaceFor(db, user.userId);
    const workspace = request.headers.get("x-workspace-id") || personal;
    const member = await one(
      db,
      "SELECT role FROM members WHERE workspace_id=? AND user_id=?",
      workspace,
      user.userId,
    );
    if (!member) throw new AppError("Workspace access denied.", 403);
    const actor = user.userId;
    if (request.method !== "GET") {
      checkOrigin(request);
      assertRole(member.role);
    }
    if (route === "ops")
      return reply(
        await operations(
          request,
          env,
          user,
          workspace,
          member,
          parts,
          rawBody ? await jsonBody(rawBody) : {},
        ),
      );
    if (route === "snapshot" && request.method === "GET") {
      const windowHours = ["1", "24", "168"].includes(
        url.searchParams.get("hours"),
      )
        ? Number(url.searchParams.get("hours"))
        : 24;
      const since = Date.now() - windowHours * 3600000;
      const [runs, counts, connections, workflows, activity] =
        await Promise.all([
          all(
            db,
            "SELECT id,trace_id,workflow_name,workflow_version,status,mode,source,attempts,created_at,started_at,finished_at,error,payload,replay_of FROM executions WHERE workspace_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 100",
            workspace,
            since,
          ),
          all(
            db,
            "SELECT status,COUNT(*) AS count FROM executions WHERE workspace_id=? AND created_at>=? GROUP BY status",
            workspace,
            since,
          ),
          all(
            db,
            "SELECT provider,status,synced_at,summary FROM connections WHERE workspace_id=?",
            workspace,
          ),
          all(db, "SELECT * FROM workflows WHERE workspace_id=?", workspace),
          all(
            db,
            "SELECT * FROM audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30",
            workspace,
          ),
        ]);
      background(drain(db, env, workspace));
      return reply({
        workspace: {
          id: workspace,
          name: (
            await one(db, "SELECT name FROM workspaces WHERE id=?", workspace)
          ).name,
          role: demoSession ? "sandbox visitor" : member.role,
          user: user.displayName || user.email || "Workspace owner",
        },
        runs: runs.map((e) => ({ ...e, payload: JSON.parse(e.payload) })),
        counts,
        workflows: workflows.map((f) => ({
          ...f,
          config: JSON.parse(f.config),
        })),
        connections: connections.map((c) => ({
          ...c,
          configured: providerConfigured(env, c.provider),
          summary: c.summary ? JSON.parse(c.summary) : null,
        })),
        activity: activity.map((a) => ({ ...a, detail: JSON.parse(a.detail) })),
        serverTime: Date.now(),
        recovery:
          env.WORKER_TOKEN || env.SITE_SERVICE_TOKEN_SHA256
            ? "external-worker-endpoint"
            : "request-driven",
        maintenance: demoSession ? null : await maintenanceStatus(db, env).then((s) => ({
          stale: s.stale,
          lastWake: s.lastWake
            ? { status: s.lastWake.status, finished_at: s.lastWake.finished_at }
            : null,
        })),
        workspaces: await all(
          db,
          "SELECT w.id,w.name,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.user_id=?",
          user.userId,
        ),
      });
    }
    if (route === "executions" && parts[1] && request.method === "GET") {
      const execution = await one(
        db,
        "SELECT * FROM executions WHERE workspace_id=? AND id=?",
        workspace,
        parts[1],
      );
      if (!execution) throw new AppError("Execution not found.", 404);
      const spans = await all(
        db,
        "SELECT * FROM spans WHERE execution_id=? ORDER BY started_at,id",
        execution.id,
      );
      if (parts[2] === "otlp") return reply(toOtlp(execution, spans));
      const logs = await all(
        db,
        "SELECT * FROM audit WHERE workspace_id=? AND execution_id=? ORDER BY created_at",
        workspace,
        execution.id,
      );
      const nodeResults = await all(
        db,
        "SELECT node_id,status,output,attempts,updated_at FROM node_results WHERE execution_id=?",
        execution.id,
      );
      return reply({
        execution: {
          ...execution,
          config: JSON.parse(execution.config),
          payload: redact(JSON.parse(execution.payload)),
        },
        spans: spans.map((s) => ({
          ...s,
          input: JSON.parse(s.input),
          output: s.output ? JSON.parse(s.output) : null,
        })),
        logs,
        nodes: nodeResults.map((n) => ({
          ...n,
          output: n.output ? redact(JSON.parse(n.output)) : null,
        })),
      });
    }
    if (route === "approvals" && request.method === "POST") {
      const input = await jsonBody(rawBody);
      if (!["approved", "rejected"].includes(input.decision))
        throw new AppError("Choose approve or reject.");
      const run = await one(
        db,
        "SELECT * FROM executions WHERE id=? AND workspace_id=?",
        parts[1],
        workspace,
      );
      if (!run) throw new AppError("Execution not found.", 404);
      if (run.status !== "waiting_approval")
        throw new AppError("This execution is not waiting for review.", 409);
      const updated = await one(
        db,
        "UPDATE node_results SET status=?,updated_at=? WHERE execution_id=? AND node_id=? AND status='waiting' RETURNING node_id",
        input.decision,
        Date.now(),
        run.id,
        input.nodeId,
      );
      if (!updated)
        throw new AppError("Approval already resolved or not found.", 409);
      await auditLog(
        db,
        workspace,
        actor,
        "approval." + input.decision,
        { nodeId: input.nodeId },
        run.id,
      );
      await execute(
        db,
        "UPDATE executions SET status='queued',next_at=?,error=NULL WHERE id=? AND status='waiting_approval'",
        Date.now(),
        run.id,
      );
      background(drain(db, env, workspace));
      return reply({ accepted: true }, 202);
    }
    if (route === "executions" && request.method === "POST") {
      const input = await jsonBody(rawBody);
      let options = {
        scenario: input.scenario,
        forceSandbox: Boolean(demoSession) || input.mode !== "live",
        workflowId: input.workflowId,
        ...(demoSession ? { source: "public-demo" } : {}),
      };
      let payload = input.payload;
      if (parts[1] && parts[2] === "replay") {
        const previous = await one(
          db,
          "SELECT * FROM executions WHERE id=? AND workspace_id=?",
          parts[1],
          workspace,
        );
        if (!previous) throw new AppError("Execution not found.", 404);
        if (!["failed", "skipped"].includes(previous.status))
          throw new AppError(
            "Only failed or filtered executions can be replayed. Uncertain deliveries require provider investigation.",
            409,
          );
        const receipt = await one(
          db,
          "SELECT status FROM deliveries WHERE execution_id=? AND status!='retryable' LIMIT 1",
          previous.id,
        );
        if (receipt && receipt.status !== "retryable")
          throw new AppError(
            "A delivery record already exists. Replay is blocked to prevent duplicate delivery.",
            409,
          );
        payload = JSON.parse(previous.payload);
        if (!payload.company)
          throw new AppError(
            "This payload was removed by retention. Replay is unavailable.",
            409,
          );
        options = {
          replayOf: previous.id,
          forceSandbox: previous.mode === "sandbox",
          scenario: "success",
          source: "replay",
          workflowId: previous.workflow_id,
          snapshot: JSON.parse(previous.config),
          snapshotVersion: previous.workflow_version,
          snapshotName: previous.workflow_name,
        };
      }
      if (demoSession && (input.mode === "live" || options.snapshot?.mode === "live"))
        throw new AppError("Live actions are disabled in the public sandbox.", 403);
      if (demoSession) {
        options.forceSandbox = true;
        options.source = "public-demo";
      }
      if (input.mode === "live" || options.snapshot?.mode === "live")
        assertRole(member.role, "admin");
      const execution = await enqueue(
        db,
        workspace,
        actor,
        payload,
        options.replayOf
          ? `replay:${options.replayOf}`
          : request.headers.get("idempotency-key"),
        options,
      );
      background(drain(db, env, workspace));
      return reply({ id: execution.id, status: execution.status }, 202);
    }
    if (route === "seed" && request.method === "POST") {
      await seed(db, workspace, actor);
      background(drain(db, env, workspace));
      return reply({ accepted: true }, 202);
    }
    if (route === "workflows" && request.method === "POST") {
      assertRole(member.role, "admin");
      const input = await jsonBody(rawBody);
      const name = String(input.name || "Untitled workflow").trim();
      if (!name || name.length > 80)
        throw new AppError("Workflow name must be 1–80 characters.");
      if (
        (
          await one(
            db,
            "SELECT COUNT(*) AS count FROM workflows WHERE workspace_id=?",
            workspace,
          )
        ).count >= (demoSession ? 5 : 20)
      )
        throw new AppError(`Workspace limit: ${demoSession ? 5 : 20} workflows.`, 409);
      const flowId = id();
      const config = { ...defaultConfig, graph: referenceGraph(defaultConfig) };
      const created = await one(
        db,
        "INSERT INTO workflows(id,workspace_id,name,version,config,updated_at) SELECT ?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM workflows WHERE workspace_id=?)<? RETURNING id",
        flowId,
        workspace,
        name,
        JSON.stringify(config),
        Date.now(),
        workspace,
        demoSession ? 5 : 20,
      );
      if (!created) throw new AppError(`Workspace limit: ${demoSession ? 5 : 20} workflows.`, 409);
      await auditLog(db, workspace, actor, "workflow.created", {
        workflowId: flowId,
        name,
      });
      return reply({ id: flowId }, 201);
    }
    if (route === "workflows" && request.method === "PUT") {
      assertRole(member.role, "admin");
      const input = await jsonBody(rawBody);
      const config = validateConfig(input.config);
      if (demoSession && config.mode !== "sandbox")
        throw new AppError("Only sandbox workflows can be published in the public demo.", 403);
      const flowId = input.id || workspace + ":lead";
      const existing = await one(
        db,
        "SELECT * FROM workflows WHERE id=? AND workspace_id=?",
        flowId,
        workspace,
      );
      if (!existing) throw new AppError("Workflow not found.", 404);
      const name =
        input.name === undefined ? existing.name : String(input.name).trim();
      if (!name || name.length > 80)
        throw new AppError("Workflow name must be 1–80 characters.");
      if (config.mode === "live") {
        const required = config.graph
          ? [
              ...new Set(
                config.graph.nodes
                  .filter((n) => ["slack", "gmail", "hubspot"].includes(n.kind))
                  .map((n) => n.kind),
              ),
            ]
          : ["slack"];
        for (const provider of required) {
          const connection = await one(
            db,
            "SELECT status FROM connections WHERE workspace_id=? AND provider=?",
            workspace,
            provider,
          );
          if (connection?.status !== "connected")
            throw new AppError(
              `Connect ${provider} before enabling live delivery.`,
              409,
            );
        }
        if (
          config.graph?.nodes.some((n) => n.kind === "ai") &&
          (!env.OPENAI_API_KEY || !env.OPENAI_MODEL)
        )
          throw new AppError(
            "Configure the AI key and model before publishing a live AI workflow.",
            409,
          );
      }
      const updated = await one(
        db,
        "UPDATE workflows SET config=?,name=?,version=version+1,updated_at=? WHERE workspace_id=? AND version=? AND id=? RETURNING id",
        JSON.stringify(config),
        name,
        Date.now(),
        workspace,
        input.version,
        flowId,
      );
      if (!updated)
        throw new AppError(
          "Workflow changed in another session. Refresh before saving.",
          409,
        );
      await auditLog(db, workspace, actor, "workflow.updated", {
        version: input.version + 1,
      });
      return reply({ saved: true });
    }
    if (route === "connections" && Object.hasOwn(providers, parts[1])) {
      assertRole(member.role, "admin");
      const provider = parts[1];
      if (parts[2] === "authorize" && request.method === "POST") {
        if (!providerConfigured(env, provider))
          throw new AppError(
            "Configure OAuth client ID, client secret, and TOKEN_ENCRYPTION_KEY in deployment settings first.",
            409,
          );
        const p = providers[provider];
        const state = id() + id();
        const redirect =
          url.origin + "/api/connections/" + provider + "/callback";
        await execute(
          db,
          "INSERT INTO oauth_states (id,workspace_id,user_id,provider,expires_at,redirect_uri) VALUES (?,?,?,?,?,?)",
          await hash(state),
          workspace,
          actor,
          provider,
          Date.now() + 600000,
          redirect,
        );
        const target = new URL(p.auth);
        target.search = new URLSearchParams({
          client_id: env[p.prefix + "_CLIENT_ID"],
          scope: p.scope,
          redirect_uri: redirect,
          state,
          response_type: "code",
          ...(provider === "gmail"
            ? { access_type: "offline", prompt: "consent" }
            : {}),
        }).toString();
        return reply({ url: target.href });
      }
      if (parts[2] === "callback" && request.method === "GET") {
        const state = await one(
          db,
          "DELETE FROM oauth_states WHERE id=? AND workspace_id=? AND user_id=? AND provider=? AND expires_at>? RETURNING *",
          await hash(url.searchParams.get("state") || ""),
          workspace,
          actor,
          provider,
          Date.now(),
        );
        if (!state || !url.searchParams.get("code"))
          throw new AppError("Expired or invalid OAuth authorization.", 403);
        const tokens = await exchange(env, provider, {
          grant_type: "authorization_code",
          code: url.searchParams.get("code"),
          redirect_uri: state.redirect_uri,
        });
        if (!tokens.access_token)
          throw new AppError("Provider did not return an access token.", 502);
        await saveTokens(db, env, workspace, provider, tokens);
        await auditLog(db, workspace, actor, "connection.authorized", {
          provider,
        });
        return Response.redirect(url.origin + "/?view=integrations", 303);
      }
      if (parts[2] === "sync" && request.method === "POST") {
        const connection = await one(
          db,
          "SELECT status FROM connections WHERE workspace_id=? AND provider=?",
          workspace,
          provider,
        );
        let result;
        if (connection.status === "sandbox") {
          result = {
            mode: "sandbox",
            count: 0,
            message:
              "Test adapter health check passed; no external request was made.",
          };
          await execute(
            db,
            "UPDATE connections SET synced_at=?,summary=? WHERE workspace_id=? AND provider=?",
            Date.now(),
            JSON.stringify(result),
            workspace,
            provider,
          );
        } else result = await synchronize(db, env, workspace, provider);
        await auditLog(db, workspace, actor, "connection.checked", {
          provider,
          ...result,
        });
        return reply(result);
      }
      if (request.method === "DELETE") {
        await execute(
          db,
          "UPDATE connections SET encrypted_tokens=NULL,status='sandbox',summary=NULL,synced_at=NULL,token_version=token_version+1,refresh_lease=NULL,refresh_until=NULL WHERE workspace_id=? AND provider=?",
          workspace,
          provider,
        );
        await execute(
          db,
          "UPDATE sync_jobs SET enabled=0,lease_id=NULL,lease_until=NULL WHERE workspace_id=? AND provider=?",
          workspace,
          provider,
        );
        await auditLog(db, workspace, actor, "connection.disconnected", {
          provider,
        });
        return reply({ disconnected: true });
      }
    }
    throw new AppError("Endpoint not found.", 404);
  } catch (error) {
    if (!(error instanceof AppError))
      console.error(
        JSON.stringify({
          event: "api.error",
          route,
          type: error?.name || "Error",
        }),
      );
    return reply(
      {
        error:
          error instanceof AppError
            ? error.message
            : "An internal error occurred. Please retry.",
        code: error instanceof AppError ? error.status : 500,
      },
      error instanceof AppError ? error.status : 500,
    );
  }
}
