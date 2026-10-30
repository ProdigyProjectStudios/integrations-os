import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function database(filename = ":memory:") {
  const sql = new DatabaseSync(filename);
  sql.exec("PRAGMA foreign_keys = ON");
  if (
    !sql.prepare("SELECT name FROM sqlite_master WHERE name='workspaces'").get()
  )
    for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      sql.exec(
        readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"),
      );
  const prepare = (text, args = []) => ({
    bind(...next) {
      return prepare(text, next);
    },
    async first() {
      return sql.prepare(text).get(...args) || null;
    },
    async all() {
      return { results: sql.prepare(text).all(...args) };
    },
    async run() {
      if (sql.prepare(text).columns().length)
        return {
          results: sql.prepare(text).all(...args),
          meta: { changes: 0 },
        };
      return { meta: { changes: sql.prepare(text).run(...args).changes } };
    },
  });
  return {
    prepare,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      sql.close();
    },
  };
}
