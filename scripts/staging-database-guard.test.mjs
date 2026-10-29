import test from "node:test";
import assert from "node:assert/strict";
import { assertStagingDatabaseSafe } from "./staging-database-guard.mjs";
import { STAGING_PROJECT_ID as projectId } from "../web/src/utils/firebaseTarget.js";
const config = { apiKey: "synthetic-key", projectId, authDomain: `${projectId}.firebaseapp.com`,
  databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`, appId: "1:123:web:synthetic", messagingSenderId: "123" };
const rules = { rules: { sync: { ".read": false }, ".write": false } };
function inspect(current, root = null) {
  const calls = [];
  return { calls, config, rules, token: "synthetic-token", fetchImpl: async (url, options) => {
    calls.push(url); assert.ok(!options.method || options.method === "GET");
    return { ok: true, json: async () => url.includes("rules.json") ? current : root };
  } };
}
test("permits only an empty locked database or the same managed Loci rules", async () => {
  await assertStagingDatabaseSafe(inspect({ rules: { ".write": false, ".read": false } }));
  const managed = inspect({ rules: { ".write": false, sync: { ".read": false } } }, { synthetic: true });
  await assertStagingDatabaseSafe(managed);
  assert.equal(managed.calls.length, 1);
});
test("preserves previous project rules and any existing locked-database data", async () => {
  const unrelated = inspect({ rules: { legacy: { ".read": true } } });
  await assert.rejects(assertStagingDatabaseSafe(unrelated));
  assert.equal(unrelated.calls.length, 1);
  await assert.rejects(assertStagingDatabaseSafe(inspect({ rules: { ".read": false, ".write": false } }, { synthetic: true })));
});
test("rejects live project/database settings before issuing requests", async () => {
  const probe = inspect(rules);
  await assert.rejects(assertStagingDatabaseSafe({ ...probe, config: { ...config, databaseURL: "https://loci-flow-default-rtdb.firebaseio.com" } }));
  assert.equal(probe.calls.length, 0);
});
