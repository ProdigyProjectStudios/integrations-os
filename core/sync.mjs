import { one, all, execute, query } from "./store.mjs";
import { token, providerFetch } from "./adapters.mjs";
import { AppError, hash } from "./security.mjs";
const fields = ["firstname", "lastname", "email", "company"];
const contact = (record) =>
  Object.fromEntries(
    fields.map((k) => [k, String(record.properties?.[k] || "")]),
  );
const properties = fields.join(",");
export function validateContact(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k)) ||
    fields.some((k) => typeof value[k] !== "string" || value[k].length > 200)
  )
    throw new AppError(
      "Provide firstname, lastname, email and company, each at most 200 characters.",
    );
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
    throw new AppError("Invalid contact email.");
  return Object.fromEntries(fields.map((k) => [k, value[k]]));
}
export async function stageContact(db, workspace, recordId, version, data) {
  const result = await one(
    db,
    "UPDATE sync_records SET local_data=?,status='pending',version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND provider='hubspot' AND version=? AND status IN ('synced','pending') RETURNING id,version",
    JSON.stringify(validateContact(data)),
    Date.now(),
    recordId,
    workspace,
    version,
  );
  if (!result)
    throw new AppError(
      "Record changed or needs conflict review. Refresh before editing.",
      409,
    );
  return result;
}
export async function resolveConflict(
  db,
  workspace,
  recordId,
  version,
  decision,
) {
  if (!["remote", "local"].includes(decision))
    throw new AppError("Choose remote or local.");
  const r = await one(
    db,
    `UPDATE sync_records SET local_data=${decision === "remote" ? "remote_data" : "local_data"},status=?,version=version+1 WHERE id=? AND workspace_id=? AND version=? AND status IN ('conflict','uncertain') RETURNING id,version`,
    decision === "remote" ? "synced" : "pending",
    recordId,
    workspace,
    version,
  );
  if (!r) throw new AppError("Conflict changed; reload before resolving.", 409);
  return r;
}
async function pushOne(db, env, job, access) {
  const record = await one(
    db,
    "SELECT * FROM sync_records WHERE workspace_id=? AND provider='hubspot' AND status='pending' ORDER BY updated_at LIMIT 1",
    job.workspace_id,
  );
  if (!record) return 0;
  const url =
    "https://api.hubapi.com/crm/v3/objects/contacts/" +
    encodeURIComponent(record.remote_id);
  const current = await providerFetch(url + "?properties=" + properties, {
    headers: { Authorization: "Bearer " + access },
  });
  const remote = contact(current),
    digest = await hash(JSON.stringify(remote));
  if (digest !== record.remote_version) {
    await execute(
      db,
      "UPDATE sync_records SET status='conflict',remote_data=?,remote_version=?,version=version+1 WHERE id=? AND version=?",
      JSON.stringify(remote),
      digest,
      record.id,
      record.version,
    );
    return 0;
  }
  const claim = await one(
    db,
    "UPDATE sync_records SET status='sending' WHERE id=? AND version=? AND status='pending' RETURNING id",
    record.id,
    record.version,
  );
  if (!claim) return 0;
  try {
    const local = JSON.parse(record.local_data),
      base = JSON.parse(record.remote_data);
    const changes = Object.fromEntries(
      fields.filter((k) => local[k] !== base[k]).map((k) => [k, local[k]]),
    );
    const response = Object.keys(changes).length
      ? await providerFetch(url, {
          method: "PATCH",
          headers: {
            Authorization: "Bearer " + access,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties: changes }),
        })
      : current;
    if (!response.id || !response.properties)
      throw new AppError("Provider did not confirm the contact update.", 502);
    const confirmed = await providerFetch(url + "?properties=" + properties, {
      headers: { Authorization: "Bearer " + access },
    });
    if (confirmed.id !== record.remote_id || !confirmed.properties)
      throw new AppError(
        "Provider readback did not confirm the updated contact.",
        502,
      );
    const result = contact(confirmed),
      json = JSON.stringify(result);
    await execute(
      db,
      "UPDATE sync_records SET status='synced',remote_data=?,local_data=?,remote_version=?,version=version+1,updated_at=? WHERE id=? AND status='sending'",
      json,
      json,
      await hash(json),
      Date.now(),
      record.id,
    );
    return 1;
  } catch (e) {
    await execute(
      db,
      "UPDATE sync_records SET status=?,version=version+1 WHERE id=? AND status='sending'",
      e.retryable ? "pending" : "uncertain",
      record.id,
    );
    throw e;
  }
}
export async function syncPage(db, env, job) {
  const lease = crypto.randomUUID(),
    now = Date.now();
  const claimed = await one(
    db,
    "UPDATE sync_jobs SET lease_id=?,lease_until=? WHERE id=? AND enabled>0 AND (lease_id IS NULL OR lease_until<?) RETURNING *",
    lease,
    now + 60000,
    job.id,
    now,
  );
  if (!claimed) return { busy: true };
  try {
    // An interrupted write cannot safely be repeated automatically.
    await execute(
      db,
      "UPDATE sync_records SET status='uncertain',version=version+1 WHERE workspace_id=? AND provider=? AND status='sending'",
      job.workspace_id,
      job.provider,
    );
    const access = await token(db, env, job.workspace_id, job.provider);
    const pushed =
      claimed.enabled === 2 && job.provider === "hubspot"
        ? await pushOne(db, env, claimed, access)
        : 0;
    const urls = {
      hubspot:
        "https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=" +
        properties,
      gmail:
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100",
      slack:
        "https://slack.com/api/conversations.list?limit=100&exclude_archived=true",
    };
    const url = new URL(urls[job.provider]);
    if (claimed.cursor)
      url.searchParams.set(
        { hubspot: "after", gmail: "pageToken", slack: "cursor" }[job.provider],
        claimed.cursor,
      );
    const data = await providerFetch(url.href, {
      headers: { Authorization: "Bearer " + access },
    });
    const records = data.results || data.messages || data.channels;
    if (!Array.isArray(records) || records.length > 100)
      throw new AppError("Provider returned an invalid sync page.", 502);
    const cursor =
      job.provider === "hubspot"
        ? data.paging?.next?.after
        : job.provider === "gmail"
          ? data.nextPageToken
          : data.response_metadata?.next_cursor;
    if (
      cursor &&
      ((typeof cursor !== "string" && typeof cursor !== "number") ||
        String(cursor).length > 4096)
    )
      throw new AppError("Invalid provider cursor.", 502);
    const generation = claimed.cursor
      ? claimed.generation
      : claimed.generation + 1;
    const existing = await all(
      db,
      "SELECT * FROM sync_records WHERE workspace_id=? AND provider=?",
      job.workspace_id,
      job.provider,
    );
    const map = new Map(existing.map((r) => [r.remote_id, r]));
    if (existing.length + records.filter((r) => !map.has(r.id)).length > 5000)
      throw new AppError(
        "Sync mirror limit is 5,000 records per connection.",
        429,
      );
    const statements = [];
    for (const record of records) {
      if (typeof record.id !== "string" || !record.id || record.id.length > 180)
        throw new AppError("Invalid provider record ID.", 502);
      const projected =
        job.provider === "hubspot"
          ? contact(record)
          : job.provider === "gmail"
            ? { id: record.id, threadId: String(record.threadId || "") }
            : {
                id: record.id,
                name: String(record.name || ""),
                is_private: Boolean(record.is_private),
              };
      const json = JSON.stringify(projected),
        version = await hash(json),
        old = map.get(record.id),
        dirty =
          old &&
          ["pending", "conflict", "uncertain", "sending"].includes(old.status);
      const status = dirty
        ? old.remote_version !== version
          ? "conflict"
          : old.status
        : "synced";
      statements.push(
        query(
          db,
          "INSERT INTO sync_records (id,workspace_id,provider,remote_id,remote_version,remote_data,local_data,status,version,generation,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET remote_version=excluded.remote_version,remote_data=excluded.remote_data,local_data=CASE WHEN sync_records.status IN ('pending','conflict','uncertain','sending') THEN sync_records.local_data ELSE excluded.local_data END,status=CASE WHEN sync_records.status IN ('pending','conflict','uncertain') AND sync_records.remote_version!=excluded.remote_version THEN 'conflict' WHEN sync_records.version!=? THEN sync_records.status ELSE excluded.status END,version=sync_records.version+1,generation=excluded.generation,updated_at=excluded.updated_at",
          job.id + ":" + record.id,
          job.workspace_id,
          job.provider,
          record.id,
          version,
          json,
          dirty ? old.local_data : json,
          status,
          generation,
          now,
          old?.version || 0,
        ),
      );
    }
    if (!cursor)
      statements.push(
        query(
          db,
          "UPDATE sync_records SET status=CASE WHEN status='synced' THEN 'missing' ELSE 'conflict' END,version=version+1 WHERE workspace_id=? AND provider=? AND generation<? AND status NOT IN ('missing','uncertain')",
          job.workspace_id,
          job.provider,
          generation,
        ),
      );
    statements.push(
      query(
        db,
        "UPDATE sync_jobs SET cursor=?,generation=?,next_at=?,error=NULL,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?",
        cursor ? String(cursor) : null,
        generation,
        now + (cursor ? 0 : 300000),
        job.id,
        lease,
      ),
    );
    await db.batch(statements);
    return {
      provider: job.provider,
      read: records.length,
      pushed,
      more: Boolean(cursor),
    };
  } catch (e) {
    await execute(
      db,
      "UPDATE sync_jobs SET error=?,next_at=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?",
      e instanceof AppError ? e.message : "Sync failed.",
      Date.now() + 300000,
      job.id,
      lease,
    );
    return {
      provider: job.provider,
      error: e instanceof AppError ? e.message : "Sync failed.",
    };
  }
}
export async function runSync(db, env) {
  const jobs = await all(
    db,
    "SELECT j.* FROM sync_jobs j JOIN connections c ON c.workspace_id=j.workspace_id AND c.provider=j.provider WHERE j.enabled>0 AND j.next_at<=? AND c.status='connected' ORDER BY j.next_at LIMIT 1",
    Date.now(),
  );
  const results = [];
  for (const job of jobs) results.push(await syncPage(db, env, job));
  return results;
}
