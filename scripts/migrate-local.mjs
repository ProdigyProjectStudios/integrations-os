import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const base = [
  "--import",
  "./scripts/sites-env.mjs",
  "./node_modules/wrangler/bin/wrangler.js",
  "d1",
  "execute",
  "DB",
  "--local",
  "--config",
  "dist/server/wrangler.json",
  "--persist-to",
  process.env.IOS_LOCAL_STATE_PATH || ".wrangler/state",
  "--json",
];
function run(args) {
  const p = spawnSync(process.execPath, [...base, ...args], {
    encoding: "utf8",
  });
  if (p.status !== 0) throw new Error(p.stderr || p.stdout);
  return JSON.parse(p.stdout);
}
run([
  "--command",
  "CREATE TABLE IF NOT EXISTS _ios_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
]);
const applied = new Set(
  run(["--command", "SELECT name FROM _ios_migrations"])[0].results.map(
    (r) => r.name,
  ),
);
for (const file of readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  if (applied.has(file)) continue;
  run(["--file", "drizzle/" + file]);
  run([
    "--command",
    `INSERT INTO _ios_migrations (name,applied_at) VALUES ('${file.replaceAll("'", "''")}',datetime('now'))`,
  ]);
  console.log("Applied", file);
}
