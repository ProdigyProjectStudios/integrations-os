import { appendFileSync } from "node:fs";
import { database } from "../database.mjs";
import { processExecution } from "../../core/engine.mjs";
const [file, execution, counter] = process.argv.slice(2),
  db = database(file),
  original = db.prepare.bind(db);
db.prepare = (sql) => {
  const wrap = (statement) => ({
    ...statement,
    bind(...args) {
      return wrap(statement.bind(...args));
    },
    async run() {
      const result = await statement.run();
      if (sql.startsWith("UPDATE deliveries SET status='delivered'"))
        process.exit(23);
      return result;
    },
  });
  return wrap(original(sql));
};
await processExecution(
  db,
  {},
  { id: execution },
  {
    sleep: async () => {},
    notify: async () => {
      appendFileSync(counter, "delivered\n");
      return { provider: "test", delivered: true };
    },
  },
);
process.exit(1);
