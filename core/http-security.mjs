export function requestPolicy(request, development = false) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'" +
      (development ? " ws://127.0.0.1:* ws://localhost:*" : ""),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.chatgpt.site",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);
  return { request: new Request(request, { headers }), policy };
}
export function secureResponse(response, policy, url) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", policy);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (new URL(url).protocol === "https:")
    headers.set("Strict-Transport-Security", "max-age=31536000");
  if (headers.get("content-type")?.includes("text/html"))
    headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
