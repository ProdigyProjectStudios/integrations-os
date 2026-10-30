import { AppError, seal, unseal } from "./security.mjs";
import { one, execute } from "./store.mjs";
export const providers = {
  slack: {
    auth: "https://slack.com/oauth/v2/authorize",
    token: "https://slack.com/api/oauth.v2.access",
    scope: "chat:write,channels:read",
    prefix: "SLACK",
  },
  hubspot: {
    auth: "https://app.hubspot.com/oauth/authorize",
    token: "https://api.hubapi.com/oauth/2026-03/token",
    scope: "crm.objects.contacts.read crm.objects.contacts.write",
    prefix: "HUBSPOT",
  },
  gmail: {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    prefix: "GOOGLE",
  },
};
export function providerConfigured(env, provider) {
  const p = providers[provider];
  return Boolean(
    p &&
      env[p.prefix + "_CLIENT_ID"] &&
      env[p.prefix + "_CLIENT_SECRET"] &&
      env.TOKEN_ENCRYPTION_KEY?.length >= 32,
  );
}
export async function providerFetch(url, init) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new AppError(
      "Provider request interrupted; delivery outcome may be unknown.",
      502,
      false,
    );
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false || json.error) {
    const retryable = response.status === 429;
    const error = new AppError(
      retryable
        ? "Provider rate limit reached."
        : `Provider rejected request (${response.status}).`,
      502,
      retryable,
    );
    error.retryAfterMs = Math.min(
      3600000,
      Math.max(0, Number(response.headers.get("retry-after")) || 0) * 1000,
    );
    throw error;
  }
  return json;
}
export async function exchange(env, provider, values) {
  const p = providers[provider];
  if (!providerConfigured(env, provider))
    throw new AppError(
      "Configure this provider’s OAuth client and encryption key first.",
      409,
    );
  return providerFetch(p.token, {
    method: "POST",
    body: new URLSearchParams({
      ...values,
      client_id: env[p.prefix + "_CLIENT_ID"],
      client_secret: env[p.prefix + "_CLIENT_SECRET"],
    }),
  });
}
export async function openTokens(value, env, context) {
  for (const key of [
    env.TOKEN_ENCRYPTION_KEY_NEXT,
    env.TOKEN_ENCRYPTION_KEY,
  ].filter(Boolean)) {
    try {
      return await unseal(value, key, context);
    } catch {}
  }
  throw new AppError(
    "Stored credentials cannot be decrypted; reconnect or restore the encryption key.",
    409,
  );
}
export async function saveTokens(
  db,
  env,
  workspace,
  provider,
  tokens,
  fence = null,
) {
  if (
    typeof tokens.access_token !== "string" ||
    !tokens.access_token.trim() ||
    (tokens.refresh_token !== undefined &&
      (typeof tokens.refresh_token !== "string" || !tokens.refresh_token)) ||
    (tokens.expires_in !== undefined &&
      (!Number.isFinite(Number(tokens.expires_in)) ||
        Number(tokens.expires_in) <= 0))
  )
    throw new AppError("Provider returned an invalid token response.", 502);
  const payload = {
    ...tokens,
    expires_at: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : null,
  };
  const result = await execute(
    db,
    "UPDATE connections SET encrypted_tokens=?,status=?,token_version=token_version+1,refresh_lease=NULL,refresh_until=NULL WHERE workspace_id=? AND provider=?" +
      (fence ? " AND token_version=? AND refresh_lease=?" : ""),
    await seal(
      payload,
      env.TOKEN_ENCRYPTION_KEY_NEXT || env.TOKEN_ENCRYPTION_KEY,
      workspace + ":" + provider,
    ),
    "connected",
    workspace,
    provider,
    ...(fence ? [fence.version, fence.lease] : []),
  );
  if (!result.meta.changes)
    throw new AppError(
      "Connection changed while authorizing; reconnect and retry.",
      409,
    );
}
export async function token(db, env, workspace, provider) {
  const connection = await one(
    db,
    "SELECT * FROM connections WHERE workspace_id=? AND provider=?",
    workspace,
    provider,
  );
  if (!connection?.encrypted_tokens || connection.status !== "connected")
    throw new AppError(`${provider} is not connected.`, 409);
  let t = await openTokens(
    connection.encrypted_tokens,
    env,
    workspace + ":" + provider,
  );
  if (t.expires_at && t.expires_at < Date.now() + 60000) {
    if (!t.refresh_token)
      throw new AppError(
        "Provider authorization expired; reconnect the account.",
        409,
      );
    if (connection.refresh_lease && connection.refresh_until < Date.now()) {
      await execute(
        db,
        "UPDATE connections SET status='reconnect_required',token_version=token_version+1,refresh_lease=NULL,refresh_until=NULL WHERE id=? AND refresh_lease=?",
        connection.id,
        connection.refresh_lease,
      );
      throw new AppError(
        "A previous refresh was interrupted. Reconnect to avoid reusing a consumed token.",
        409,
      );
    }
    const lease = crypto.randomUUID();
    const claim = await one(
      db,
      "UPDATE connections SET refresh_lease=?,refresh_until=? WHERE id=? AND token_version=? AND refresh_lease IS NULL AND status='connected' RETURNING id",
      lease,
      Date.now() + 15000,
      connection.id,
      connection.token_version,
    );
    if (!claim) {
      const error = new AppError(
        "Authorization refresh in progress; retry shortly.",
        503,
        true,
      );
      error.retryAfterMs = 1000;
      throw error;
    }
    try {
      const fresh = await exchange(env, provider, {
        grant_type: "refresh_token",
        refresh_token: t.refresh_token,
      });
      // Validate the response itself: an omitted access token must not reuse the old one.
      if (typeof fresh.access_token !== "string" || !fresh.access_token)
        throw new AppError("Provider returned an invalid token response.", 502);
      t = {
        ...t,
        ...fresh,
        refresh_token: fresh.refresh_token || t.refresh_token,
      };
      await saveTokens(db, env, workspace, provider, t, {
        version: connection.token_version,
        lease,
      });
    } catch (error) {
      await execute(
        db,
        "UPDATE connections SET status=?,refresh_lease=NULL,refresh_until=NULL,token_version=token_version+1 WHERE id=? AND refresh_lease=?",
        error.retryable ? "connected" : "reconnect_required",
        connection.id,
        lease,
      );
      throw error;
    }
  }
  return t.access_token;
}
export async function rotateCredentials(db, env, workspace) {
  if (
    !env.TOKEN_ENCRYPTION_KEY_NEXT ||
    env.TOKEN_ENCRYPTION_KEY_NEXT.length < 32
  )
    throw new AppError(
      "Configure the next encryption key before rotation.",
      409,
    );
  const rows = (
    await db
      .prepare(
        "SELECT * FROM connections WHERE workspace_id=? AND encrypted_tokens IS NOT NULL",
      )
      .bind(workspace)
      .all()
  ).results;
  let rotated = 0;
  for (const row of rows) {
    const value = await openTokens(
      row.encrypted_tokens,
      env,
      workspace + ":" + row.provider,
    );
    const r = await execute(
      db,
      "UPDATE connections SET encrypted_tokens=?,token_version=token_version+1 WHERE id=? AND token_version=? AND refresh_lease IS NULL",
      await seal(
        value,
        env.TOKEN_ENCRYPTION_KEY_NEXT,
        workspace + ":" + row.provider,
      ),
      row.id,
      row.token_version,
    );
    rotated += r.meta.changes;
  }
  return { rotated, pending: rows.length - rotated };
}
export async function synchronize(db, env, workspace, provider) {
  const access = await token(db, env, workspace, provider);
  const urls = {
    slack:
      "https://slack.com/api/conversations.list?limit=100&exclude_archived=true",
    hubspot: "https://api.hubapi.com/crm/v3/objects/contacts?limit=100",
    gmail:
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100",
  };
  const data = await providerFetch(urls[provider], {
    headers: { Authorization: `Bearer ${access}` },
  });
  const summary = {
    count: (data.channels || data.results || data.messages || []).length,
    pageLimited: true,
    direction: "read",
    resource: { slack: "channels", hubspot: "contacts", gmail: "message IDs" }[
      provider
    ],
  };
  await execute(
    db,
    "UPDATE connections SET synced_at=?,summary=? WHERE workspace_id=? AND provider=?",
    Date.now(),
    JSON.stringify(summary),
    workspace,
    provider,
  );
  return summary;
}
export async function notifySlack(db, env, execution, payload, config) {
  const access = await token(db, env, execution.workspace_id, "slack");
  const text = config.message
    .replaceAll("{{company}}", payload.company)
    .replaceAll("{{value}}", String(payload.value));
  const result = await providerFetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
      traceparent: execution.traceparent,
    },
    body: JSON.stringify({
      channel: config.channel,
      text,
      mrkdwn: false,
      unfurl_links: false,
      unfurl_media: false,
      client_msg_id: execution.id,
    }),
  });
  if (
    result.ok !== true ||
    typeof result.ts !== "string" ||
    typeof result.channel !== "string"
  ) {
    throw new AppError(
      "Provider response did not confirm delivery; inspect the destination.",
      502,
    );
  }
  return {
    provider: "slack",
    mode: "live",
    timestamp: result.ts,
    channel: result.channel,
  };
}
