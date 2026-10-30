import { spawn, spawnSync } from "node:child_process";
// Never run two Miniflare processes against the same SQLite files. Browser
// checks get their own migrated store, independent of the developer preview.
const env = {
  ...process.env,
  IOS_LOCAL_STATE_PATH: process.env.IOS_TEST_STATE_PATH || ".wrangler/e2e",
};
const migrated = spawnSync(process.execPath, ["scripts/migrate-local.mjs"], {
  stdio: "inherit",
  env,
});
if (migrated.status !== 0) process.exit(migrated.status || 1);
const server = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/sites-env.mjs",
    "./node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--local",
    "--persist-to",
    env.IOS_LOCAL_STATE_PATH,
    "--ip",
    "127.0.0.1",
    "--inspector-port",
    "0",
    "--port",
    "5180",
    "--var",
    "BACKUP_ENCRYPTION_KEY:test-only-browser-backup-key-1234567890123456",
  ],
  { stdio: "inherit", env },
);
process.on("SIGTERM", () => server.kill());
process.on("SIGINT", () => server.kill());
server.on("exit", (code) => process.exit(code || 0));
