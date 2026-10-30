// Credentials arrive over stdin only. Never persist them or print request headers.
import { createHash } from "node:crypto";
const chunks = [];
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdout.write("Ready for private service input (hidden).\n");
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  chunks.push(chunk);
  if (!/[\r\n]/.test(chunks.join(""))) return;
  process.stdin.pause();
  try {
    const input = JSON.parse(chunks.join("").trim());
    if (input.action === "fingerprint") {
      process.stdout.write(
        JSON.stringify({
          fingerprint: createHash("sha256").update(input.token).digest("hex"),
        }) + "\n",
      );
    } else {
      const origin = new URL(input.url);
      if (
        origin.protocol !== "https:" ||
        origin.hostname !==
          "integration-os-command.smart-wren-7193.chatgpt.site"
      )
        throw Error("Unexpected service origin");
      const request = async (method, path, body) => {
        const r = await fetch(new URL(path, origin), {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(60000),
          headers: {
            "OAI-Sites-Authorization": "Bearer " + input.token,
            Authorization: "Bearer " + input.token,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!r.ok) throw Error("Service returned HTTP " + r.status);
        return r.json();
      };
      const result =
        input.action === "mcp"
          ? await request("POST", "/mcp", {
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: input.tool || "operations_status",
                arguments: {},
              },
            })
          : input.action === "status"
            ? await request("GET", "/api/worker/status")
            : await request(
                "POST",
                input.action === "probe" ? "/api/worker/probe" : "/api/worker",
                {},
              );
      process.stdout.write(JSON.stringify(result) + "\n");
    }
    process.exitCode = 0;
  } catch (e) {
    const safeMessage = /^Service returned HTTP \d+$/.test(e.message)
      ? e.message
      : "Request failed; credentials were not logged.";
    process.stderr.write("Service operation failed: " + safeMessage + "\n");
    process.exitCode = 1;
  } finally {
    // Let Undici and Windows TTY handles close normally after a network call.
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.unref?.();
  }
});
