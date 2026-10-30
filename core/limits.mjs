import { one } from "./store.mjs";
import { AppError } from "./security.mjs";
export async function rateLimit(
  db,
  scope,
  limit = 120,
  period = 60000,
  now = Date.now(),
) {
  const bucket = Math.floor(now / period);
  const result = await one(
    db,
    "INSERT INTO rate_limits (id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count",
    scope + ":" + bucket,
    (bucket + 2) * period,
  );
  if (result.count > limit)
    throw new AppError("Request limit reached. Retry after one minute.", 429);
}
export async function acquireLock(db, key, ttl = 60000) {
  const owner = crypto.randomUUID(),
    now = Date.now();
  return (await one(
    db,
    "INSERT INTO locks (id,owner,until) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until=excluded.until WHERE locks.until<? RETURNING owner",
    key,
    owner,
    now + ttl,
    now,
  ))
    ? owner
    : null;
}
