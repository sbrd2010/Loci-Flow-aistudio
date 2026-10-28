import test from "node:test";
import assert from "node:assert/strict";
import { expiredIds, RETENTION_DAYS } from "./purge-deleted-accounts.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 28);

test("keeps copies younger than 30 days and erases the rest", () => {
  assert.equal(RETENTION_DAYS, 30);
  const ids = expiredIds({
    fresh: NOW - 1 * DAY,
    almost: NOW - 30 * DAY + 1,
    exactly: NOW - 30 * DAY,
    old: NOW - 90 * DAY,
  }, NOW);
  assert.deepEqual(ids.sort(), ["exactly", "old"]);
});

test("erases a copy with no valid date, so nothing is kept forever", () => {
  assert.deepEqual(expiredIds({ a: null, b: "yesterday", c: NaN }, NOW).sort(), ["a", "b", "c"]);
});

test("nothing to do with no copies", () => {
  assert.deepEqual(expiredIds(null, NOW), []);
  assert.deepEqual(expiredIds({}, NOW), []);
});
