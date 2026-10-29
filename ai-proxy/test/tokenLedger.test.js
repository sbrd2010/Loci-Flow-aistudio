import { afterEach, expect, it, vi } from "vitest";
import { makeLedger } from "./ledgerHarness.js";

const request = async (ledger, path, body) => {
  const res = await ledger.get().fetch(`https://ledger/${path}`, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, ...await res.json() };
};
const reserve = (ledger, uid, tokens) => request(ledger, "reserve", { uid, tokens });
const settle = (ledger, id, actual) => request(ledger, "settle", { id, actual });
afterEach(() => vi.useRealTimers());

it("atomically reserves across a burst of parallel requests", async () => {
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 1000 });
  const results = await Promise.all(Array.from({ length: 20 }, () => reserve(ledger, "synthetic-user", 30)));
  expect(results.filter(r => r.status === 200)).toHaveLength(3);
  expect(results.filter(r => r.code === "daily_cap")).toHaveLength(17);
});
it("distinguishes a shared pool shortage from a per-person shortage", async () => {
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 100 });
  expect((await reserve(ledger, "user-a", 60)).status).toBe(200);
  expect((await reserve(ledger, "user-b", 50)).code).toBe("pool_empty");
  expect((await reserve(ledger, "user-a", 50)).code).toBe("daily_cap");
});
it("settles/refunds exactly once and persists across object reconstruction", async () => {
  const env = { AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 100 };
  const ledger = makeLedger(env);
  const reservation = await reserve(ledger, "user-a", 80);
  const reloaded = makeLedger(env, ledger.database);
  expect((await settle(reloaded, reservation.id, 20)).remaining).toBe(80);
  expect((await settle(reloaded, reservation.id, 0)).remaining).toBe(80);
  const failed = await reserve(reloaded, "user-a", 60);
  expect((await settle(reloaded, failed.id, 0)).remaining).toBe(80);
});
it("retains estimates without usage and charges usage above the estimate", async () => {
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 100 });
  const a = await reserve(ledger, "user-a", 30);
  expect((await settle(ledger, a.id, null)).remaining).toBe(70);
  const b = await reserve(ledger, "user-a", 30);
  expect((await settle(ledger, b.id, 80)).remaining).toBe(0);
  expect((await reserve(ledger, "user-a", 1)).code).toBe("daily_cap");
});
it("resets at UTC midnight and settles an in-flight request against its original day", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T23:59:50Z"));
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 100 });
  const a = await reserve(ledger, "user-a", 100);
  expect((await reserve(ledger, "user-a", 1)).status).toBe(429);
  vi.setSystemTime(new Date("2026-10-30T00:00:01Z"));
  expect((await settle(ledger, a.id, 80)).remaining).toBe(100);
  expect((await reserve(ledger, "user-a", 100)).status).toBe(200);
});
it("keeps only seven days of UID/count metadata and no prompt fields", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  const ledger = makeLedger(); await reserve(ledger, "synthetic-user", 10);
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z")); await reserve(ledger, "synthetic-user", 10);
  expect(ledger.database.prepare("SELECT * FROM usage").all()).toEqual([{ day: "2026-10-10", uid: "synthetic-user", tokens: 10 }]);
  expect(ledger.database.prepare("PRAGMA table_info(reservations)").all().map(row => row.name)).toEqual(["id", "day", "uid", "estimate", "closed"]);
});
