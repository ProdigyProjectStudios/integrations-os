import { hash, AppError } from "./security.mjs";
import { authorizeWorker, recover, maintenanceStatus } from "./maintenance.mjs";
const tools = [
  {
    name: "operations_status",
    description:
      "Read the recovery heartbeat and aggregate due-work count. No event payloads or provider credentials are returned.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "recover_operations",
    description:
      "Run bounded recovery of due or expired-lease executions, enabled provider sync, telemetry exports and a due verified backup. Existing approvals and uncertain deliveries remain paused. Restricted to the pinned Site owner.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
];
export async function handleMcp(request, env) {
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  let call;
  const respond = (value, status = 200) =>
    Response.json(value, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    });
  try {
    const reader = request.body?.getReader();
    let size = 0,
      raw = "";
    const decoder = new TextDecoder();
    if (!reader) throw new AppError("JSON-RPC body required.");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new AppError("MCP body exceeds 16 KB.", 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    call = JSON.parse(raw);
    if (!call || Array.isArray(call) || call.jsonrpc !== "2.0")
      throw new AppError("Invalid JSON-RPC request.");
    if (call.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    if (call.method === "server/discover")
      return respond({
        jsonrpc: "2.0",
        id: call.id,
        result: {
          supportedVersions: ["2026-07-28"],
          capabilities: { tools: {} },
        },
      });
    if (call.method === "initialize")
      return respond({
        jsonrpc: "2.0",
        id: call.id,
        result: {
          protocolVersion: "2026-07-28",
          capabilities: { tools: {} },
          serverInfo: { name: "IntegrationOS Operations", version: "1.0.0" },
        },
      });
    if (call.method === "tools/list")
      return respond({ jsonrpc: "2.0", id: call.id, result: { tools } });
    if (call.method !== "tools/call")
      return respond({
        jsonrpc: "2.0",
        id: call.id,
        error: { code: -32601, message: "Method not found" },
      });
    const email = request.headers.get("oai-authenticated-user-email"),
      user = request.headers.get("oai-authenticated-user-id");
    const owner =
      user &&
      email &&
      env.SITE_OWNER_EMAIL_SHA256 &&
      (await hash(email.toLowerCase())) === env.SITE_OWNER_EMAIL_SHA256;
    if (!owner) await authorizeWorker(request, env);
    const name = call.params?.name,
      args = call.params?.arguments === undefined ? {} : call.params.arguments;
    if (
      !tools.some((t) => t.name === name) ||
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      Object.keys(args).length
    )
      throw new AppError("Unknown tool or unsupported arguments.");
    const result =
      name === "operations_status"
        ? await maintenanceStatus(env.DB, env)
        : await recover(env.DB, env);
    return respond({
      jsonrpc: "2.0",
      id: call.id,
      result: { content: [{ type: "text", text: JSON.stringify(result) }] },
    });
  } catch (e) {
    return respond(
      {
        jsonrpc: "2.0",
        id: call?.id ?? null,
        error: {
          code: -32000,
          message:
            e instanceof AppError ? e.message : "Operations request failed.",
        },
      },
      e instanceof AppError && e.status === 401 ? 401 : 200,
    );
  }
}
