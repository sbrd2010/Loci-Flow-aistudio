// Exercise the production SQL against actual SQLite, including transactions
// and rebuilding the Durable Object wrapper over the same persisted database.
import { DatabaseSync } from "node:sqlite";
import { AITokenLedger } from "../src/tokenLedger.js";
export function makeLedger(env = {}, database = new DatabaseSync(":memory:")) {
  const storage = {
    sql: { exec(query, ...args) { const rows = database.prepare(query).all(...args); return { toArray: () => rows }; } },
    transactionSync(fn) {
      database.exec("BEGIN");
      try { const result = fn(); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  };
  const object = new AITokenLedger({ storage }, env);
  return { idFromName: () => "single-ledger", get: () => ({ fetch: (url, init) => object.fetch(new Request(url, init)) }), database };
}
