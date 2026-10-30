import { writeFileSync } from 'node:fs';
import { database } from '../tests/database.mjs';
import { workspaceFor, one, all } from '../core/store.mjs';
import { enqueue, processExecution } from '../core/engine.mjs';

// Disposable synthetic input; real engine execution and measured sandbox spans.
// Export only this explicit allowlist. Never export owner workspaces or payloads.
const db = database();
try {
  const workspace = await workspaceFor(db, 'portfolio-fixture');
  const runs = [];
  for (const [index, value] of [4800, 1200, 6200].entries()) {
    const execution = await enqueue(db, workspace, 'portfolio-fixture',
      { company: 'Portfolio sample ' + (index + 1), value, region: 'UK' },
      'portfolio-sample-' + index, { forceSandbox: true });
    await processExecution(db, {}, execution);
    runs.push({
      ...await one(db, 'SELECT id,trace_id,workflow_name,status,mode,attempts,started_at,finished_at FROM executions WHERE id=?', execution.id),
      spans: await all(db, 'SELECT id,parent_id,name,service,attempt,status,started_at,ended_at FROM spans WHERE execution_id=? ORDER BY started_at,id', execution.id),
    });
  }
  writeFileSync(new URL('../app/portfolio/recorded-runs.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2) + '\n');
  console.log('Exported ' + runs.length + ' real sandbox runs using an explicit public field allowlist.');
} finally { db.close(); }
