import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { recover } from "../core/maintenance.mjs";
import { handleApi } from "../core/api.mjs";
import { handleMcp } from "../core/mcp.mjs";
import { requestPolicy, secureResponse } from "../core/http-security.mjs";
import { workspaceAccess } from "../core/portfolio.mjs";

const worker = {
  scheduled(
    _event: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    if (env.DB) ctx.waitUntil(recover(env.DB, env));
  },
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>,
  ) {
    const protectedRequest = requestPolicy(request, import.meta.env.DEV);
    request = protectedRequest.request;
    const secured = (response: Response) =>
      secureResponse(response, protectedRequest.policy, request.url);
    if (new URL(request.url).pathname === "/" && !(await workspaceAccess({
      userId: request.headers.get("oai-authenticated-user-id"),
      email: request.headers.get("oai-authenticated-user-email"),
    }, env))) return secured(new Response(null, { status: 302, headers: {
      Location: "/portfolio", "Cache-Control": "private, no-store", Vary: "Cookie",
    } }));
    // Handle JSON at the Worker boundary, avoiding RSC response transformations.
    if (new URL(request.url).pathname === "/mcp")
      return secured(await handleMcp(request, env));
    // Sites dispatch authenticates and supplies these headers in production.
    // This worker must not be exposed directly without that trusted gateway.
    if (new URL(request.url).pathname.startsWith("/api/")) {
      const userId = request.headers.get("oai-authenticated-user-id");
      const email = request.headers.get("oai-authenticated-user-email");
      const user =
        userId && email ? { userId, email, displayName: email } : null;
      return secured(
        await handleApi(request, env, user, (promise: Promise<unknown>) =>
          ctx.waitUntil(promise),
        ),
      );
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt)
            return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return {
              status: "request_context_expired",
              message: "This request has expired. Please try again.",
            };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return secured(
      await runWithConnectorBinding(binding, () =>
        handler.fetch(request, env, ctx),
      ),
    );
  },
};

export default worker;
