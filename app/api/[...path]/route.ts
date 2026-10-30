import { env, waitUntil } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleApi } from "../../../core/api.mjs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return handleApi(request, env, await getChatGPTUser(), waitUntil);
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
