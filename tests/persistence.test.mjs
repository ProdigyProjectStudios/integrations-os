import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "./database.mjs";
import { workspaceFor, one } from "../core/store.mjs";
import { enqueue, processExecution } from "../core/engine.mjs";
test("queued executions survive closing and reopening the database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ios-persistence-"));
  const filename = join(directory, "queue.sqlite");
  let db = database(filename);
  try {
    const ws = await workspaceFor(db, "durability-test");
    const run = await enqueue(
      db,
      ws,
      "tester",
      { company: "Persistent Estates", value: 4800 },
      "persistent-event",
    );
    db.close();
    db = database(filename);
    const restored = await one(
      db,
      "SELECT * FROM executions WHERE id=?",
      run.id,
    );
    assert.equal(restored.status, "queued");
    await processExecution(db, {}, restored, { sleep: async () => {} });
    db.close();
    db = database(filename);
    assert.equal(
      (await one(db, "SELECT * FROM executions WHERE id=?", run.id)).status,
      "success",
    );
    assert.equal(
      (await one(db, "SELECT * FROM deliveries WHERE execution_id=?", run.id))
        .status,
      "delivered",
    );
  } finally {
    db.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  }
});
