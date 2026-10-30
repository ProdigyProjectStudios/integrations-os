const encoder = new TextEncoder();
export const id = () => crypto.randomUUID();
export const traceId = () => id().replaceAll("-", "");
export class AppError extends Error {
  constructor(message, status = 400, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}
export async function hash(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|secret|password|authorization|cookie|email|phone/i.test(k)
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  if (typeof value === "string")
    return value
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]");
  return value;
}
export function assertRole(role, required = "operator") {
  const rank = { viewer: 0, operator: 1, admin: 2 };
  if (!(role in rank) || rank[role] < rank[required])
    throw new AppError("Your workspace role does not permit this action.", 403);
}
export function checkOrigin(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new AppError("Invalid request origin.", 403);
}
export async function seal(data, key, context, compact = false) {
  if (!key || key.length < 32)
    throw new AppError(
      "TOKEN_ENCRYPTION_KEY must be configured before connecting a provider.",
      409,
    );
  const k = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(key)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
      k,
      encoder.encode(JSON.stringify(data)),
    ),
  );
  return JSON.stringify({
    v: compact ? 2 : 1,
    iv: Array.from(iv),
    data: compact
      ? btoa(
          Array.from({ length: Math.ceil(ciphertext.length / 8192) }, (_, i) =>
            String.fromCharCode(
              ...ciphertext.subarray(i * 8192, (i + 1) * 8192),
            ),
          ).join(""),
        )
      : Array.from(ciphertext),
  });
}
export async function unseal(value, key, context) {
  if (!key) throw new AppError("Credential encryption is not configured.", 409);
  const data = JSON.parse(value);
  const k = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(key)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(data.iv),
          additionalData: encoder.encode(context),
        },
        k,
        data.v === 2
          ? Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))
          : new Uint8Array(data.data),
      ),
    ),
  );
}
export async function verifyWebhook(
  secret,
  timestamp,
  signature,
  body,
  now = Date.now(),
) {
  if (
    !secret ||
    !/^\d+$/.test(timestamp || "") ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !/^[a-f0-9]{64}$/.test(signature || "")
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    new Uint8Array(signature.match(/.{2}/g).map((h) => parseInt(h, 16))),
    encoder.encode(`${timestamp}.${body}`),
  );
}
