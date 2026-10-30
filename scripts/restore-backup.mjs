// Restore a downloaded logical backup into a NEW, isolated SQLite database.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function restoreBackup(document, target) {
  if (existsSync(target))
    throw Error("Restore target already exists; refusing to overwrite.");
  const tables = [
    "workspaces",
    "members",
    "workflows",
    "executions",
    "spans",
    "deliveries",
    "node_results",
    "audit",
    "connections",
    "sync_jobs",
    "sync_records",
  ];
  if (
    document.format !== "integration-os.logical-backup.v1" ||
    document.credentialsIncluded !== false ||
    tables.some((t) => !Array.isArray(document.tables?.[t]))
  )
    throw Error("Unsupported backup.");
  if (
    document.tables.workspaces.length !== 1 ||
    document.tables.workspaces[0].id !== document.workspace
  )
    throw Error("Invalid workspace backup.");
  const db = new DatabaseSync(target);
  try {
    db.exec("PRAGMA foreign_keys=ON");
    for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      db.exec(
        readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"),
      );
    db.exec("BEGIN");
    let count = 0;
    for (const table of tables)
      for (const row of document.tables[table]) {
        if (
          table === "connections" &&
          (row.encrypted_tokens || row.status !== "sandbox")
        )
          throw Error(
            "Backups must not contain reusable provider credentials.",
          );
        const allowed = new Set(
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((c) => c.name),
        );
        const keys = Object.keys(row);
        if (keys.some((k) => !allowed.has(k)))
          throw Error("Invalid backup column.");
        if (row.workspace_id && row.workspace_id !== document.workspace)
          throw Error("Cross-workspace record rejected.");
        db.prepare(
          `INSERT INTO ${table} (${keys.map((k) => '"' + k + '"').join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        ).run(...keys.map((k) => row[k]));
        count++;
      }
    db.exec("COMMIT");
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("Restored database failed integrity check.");
    return {
      restored: true,
      rows: count,
      workspace: document.workspace,
      credentialsRestored: false,
    };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target)
    throw Error(
      "Usage: node scripts/restore-backup.mjs downloaded-backup.json NEW-database.sqlite",
    );
  console.log(
    JSON.stringify(
      restoreBackup(JSON.parse(readFileSync(source, "utf8")), resolve(target)),
    ),
  );
}
