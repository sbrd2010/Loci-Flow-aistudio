// #643: horizon-review commands through real Firebase transactions — two
// signed-in clients on the RTDB emulator with the real database.rules.json,
// running the production command code (runReviewTransaction).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { get, goOffline, goOnline, onValue, ref, runTransaction, set, update } from "firebase/database";
import { mergeLocalIntoServer } from "../src/utils/normalizePayload";
import { pendingReviews } from "../src/utils/horizonReview";
import { joinRoute } from "../src/hooks/useDayRoute";
import { doneCommand, runReviewTransaction, undoCommand, whenConnected } from "../src/utils/reviewCommands";

let env;
const uid = "review-sample";
const path = `sync/${uid}`;
const SUN = "2026-11-01", MON = "2026-11-02", NEXT_MON = "2026-11-09";
const task = (u, extra = {}) => ({ id: u, uuid: u, title: `Sample ${u}`, userId: "s@example.test", horizonLevel: "week",
  isCompleted: false, isDeleted: false, isParked: false, orderIndex: 0, lastUpdated: 10, ...extra });
const seed = () => ({ userId: "s@example.test", timestamp: 1,
  config: { userId: "s@example.test", lastUpdated: 1, horizonReviews: { week: { through: "2026-10-25" } } },
  tasks: [task("a"), task("b")], contributions: [], brainDump: [], brainDumpUpdatedAt: 1 });

const client = () => env.authenticatedContext(uid).database();
const serverNow = async () => (await get(ref(client(), path))).val();
// As in the app: commands run once the listener has delivered.
const listen = db => new Promise(res => { const off = onValue(ref(db, path), s => { if (s.exists()) res(off); }); });
// As in the app (useSync runReviewCommand).
const run = (db, cmd) => runReviewTransaction(ref(db, path), cmd, { whenOnline: () => whenConnected(db) })
  .catch(err => ({ outcome: "failed", reason: String(err?.message || err) }));
const detect = (day, now) => ({ kind: "detect", day, now });
const done = (server, choices = {}, op = "op-1") =>
  doneCommand(pendingReviews(server.config, server.tasks, MON).find(r => r.id === "week"), choices, MON, 100, op);
const wait = ms => new Promise(res => setTimeout(res, ms));

async function seedDetected() {
  const a = client();
  await set(ref(a, path), seed());
  const off = await listen(a);
  const r = await run(a, detect(MON, 50));
  off();
  expect(r.outcome).toBe("accepted");
  return serverNow();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-loci-review",
    database: { host: "127.0.0.1", port: 9000, rules: readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8") } });
});
beforeEach(async () => { await env.clearDatabase(); });
afterAll(async () => { await env?.cleanup(); });

describe("#643 S1: null never writes over, or creates, an account", () => {
  it("with the listener delivered, the first run sees the server's data", async () => {
    await set(ref(client(), path), seed());
    const c = client(); const off = await listen(c);
    const r = await run(c, detect(MON, 50));
    off();
    expect(r.outcome).toBe("accepted");
    expect((await serverNow()).tasks).toHaveLength(2);
  });
  it("without a listener a fresh client may fail, but never destroys data", async () => {
    await set(ref(client(), path), seed());
    const r = await run(client(), detect(MON, 50));
    expect(["accepted", "failed"]).toContain(r.outcome);
    expect((await serverNow()).tasks).toHaveLength(2);
  });
  it("an empty account stays empty", async () => {
    const r = await run(client(), detect(MON, 50));
    expect(r).toEqual({ outcome: "failed", reason: "no-data" });
    expect(await serverNow()).toBeNull();
  });
});

describe("#643 S2–S6, S8: commands decided on the server's copy", () => {
  it("S2: two devices press Done — the first wins, the second changes nothing", async () => {
    const s = await seedDetected();
    const a = client(); const b = client(); const offA = await listen(a); const offB = await listen(b);
    const ra = await run(a, done(s, { a: "today" }));
    const rb = await run(b, done(s, { a: "drop", b: "drop" }, "op-2"));
    offA(); offB();
    expect([ra.outcome, rb.outcome, rb.reason]).toEqual(["accepted", "conflict", "already-reviewed"]);
    const f = await serverNow();
    expect(f.tasks.find(t => t.uuid === "a").horizonLevel).toBe("today");
    expect(f.tasks.some(t => t.isDeleted)).toBe(false);
    expect(f.config.horizonReviews.week.last.op).toBe("op-1");
  });
  it("S3: a stale device's Detect after Done is a no-op; a newer period still opens", async () => {
    const s = await seedDetected();
    const a = client(); const offA = await listen(a);
    await run(a, done(s));
    const r1 = await run(a, detect(MON, 300));
    const r2 = await run(a, detect(NEXT_MON, 400));
    offA();
    expect([r1.outcome, r2.outcome]).toEqual(["noop", "accepted"]);
    const f = await serverNow();
    expect(f.config.horizonReviews.week.pending.end).toBe("2026-11-08");
    expect(f.config.horizonReviews.week.last.op).toBe("op-1");
  });
  it("S4: a Done for an older period can't close a newer one", async () => {
    const old = await seedDetected();
    const a = client(); const offA = await listen(a);
    await run(a, detect(NEXT_MON, 200));
    const r = await run(a, done(old));
    offA();
    expect([r.outcome, r.reason]).toEqual(["conflict", "stale-period"]);
    expect((await serverNow()).config.horizonReviews.week.pending.end).toBe("2026-11-08");
  });
  it("S5: Done conflicts when a shown task changed on the server", async () => {
    const s = await seedDetected();
    const a = client(); const offA = await listen(a);
    await update(ref(a), { [`${path}/tasks/1/title`]: "Sample edited elsewhere", [`${path}/tasks/1/lastUpdated`]: 999 });
    const r = await run(a, done(s));
    offA();
    expect([r.outcome, r.reason]).toEqual(["conflict", "tasks-changed"]);
    expect((await serverNow()).config.horizonReviews.week.pending).toBeTruthy();
  });
  // A clock is ordering, not an edit (24 Nov: Done refused on every tap while
  // one shown task lagged the server only by its lastUpdated).
  it("S5b: Done goes through when only a shown task's clock moved on the server", async () => {
    const s = await seedDetected();
    const a = client(); const offA = await listen(a);
    await update(ref(a), { [`${path}/tasks/1/lastUpdated`]: 999 });
    const r = await run(a, done(s));
    offA();
    expect(r.outcome).toBe("accepted");
    expect((await serverNow()).config.horizonReviews.week.pending).toBeFalsy();
  });
  it("S6: Undo is all or nothing, then restores the review and the moved task", async () => {
    const s = await seedDetected();
    const a = client(); const offA = await listen(a);
    const cmd = done(s, { a: "today" });
    const r = await run(a, cmd);
    const undo = { ...undoCommand(cmd, r.before, r.after), now: 600 };
    const doneTitle = r.after.tasks.find(t => t.uuid === "a").title;
    await update(ref(a), { [`${path}/tasks/0/title`]: "Renamed elsewhere" }); // another device edited it
    const r1 = await run(a, undo);
    const mid = await serverNow();
    await update(ref(a), { [`${path}/tasks/0/title`]: doneTitle });
    const r2 = await run(a, undo);
    offA();
    expect([r1.outcome, r1.reason]).toEqual(["conflict", "changed-since"]);
    expect(mid.config.horizonReviews.week.pending).toBeFalsy();
    expect(r2.outcome).toBe("accepted");
    const f = await serverNow();
    expect(f.config.horizonReviews.week.pending.end).toBe(SUN);
    expect(f.tasks.find(t => t.uuid === "a").horizonLevel).toBe("week");
  });
  it("S12: Undo after Today's route took the task in, through a real save (CI on #644)", async () => {
    const s = await seedDetected();
    const a = client(); const offA = await listen(a);
    const cmd = done(s, { a: "today" });
    const r = await run(a, cmd);
    // The Today screen adds the task to the route and saves it.
    const local = { ...r.after, tasks: joinRoute(r.after.tasks, MON, { stamp: false }) || r.after.tasks };
    await runTransaction(ref(a, path), cur => mergeLocalIntoServer(cur, local, r.after), { applyLocally: false });
    const routed = (await serverNow()).tasks.find(t => t.uuid === "a");
    expect(routed.dayMapDate).toBe(MON);
    const u = await run(a, { ...undoCommand(cmd, r.before, r.after), now: 700 });
    offA();
    expect(u.outcome).toBe("accepted");
    const f = await serverNow();
    expect(f.config.horizonReviews.week.pending.end).toBe(SUN);
    expect(f.tasks.find(t => t.uuid === "a").horizonLevel).toBe("week");
  });
  it("S8: online, a command and a child update() in the same tick both land", async () => {
    const s = await seedDetected();
    const a = client(); const offA = await listen(a);
    const pending = run(a, done(s));
    await update(ref(a), { [`${path}/config/other`]: "y" });
    const r = await pending;
    offA();
    const f = await serverNow();
    expect(r.outcome).toBe("accepted");
    expect(f.config.other).toBe("y");
    expect(f.config.horizonReviews.week.last.op).toBe("op-1");
  });
});

// The outcome a device reports must match the server: "accepted" exactly when
// its op is there, and anything else with nothing of it written.
const agrees = (r, f, op) => (r.outcome === "accepted") === (f.config.horizonReviews.week.last?.op === op);

describe("#643 S11: ordinary saves around a Done (ChatGPT review of #644)", () => {
  it("full saves from this device's stale copy and from another device, during Done, and a failed save resent after: nothing lost", async () => {
    const s = await seedDetected();
    const a = client(); const b = client(); const offA = await listen(a); const offB = await listen(b);
    // A's edit to an unrelated task whose save failed: still only on A.
    const extra = task("c", { horizonLevel: "today", title: "Sample unsent edit", lastUpdated: 30 });
    const aLocal = { ...s, tasks: [...s.tasks, extra] };
    const cmd = done(s, { a: "today", b: "drop" });
    const pending = run(a, cmd);
    // During the Done: A's ordinary save of its stale copy (still showing the
    // review pending and the tasks unmoved), and B's save of its own edit.
    const saveA = runTransaction(ref(a, path), cur => mergeLocalIntoServer(cur, aLocal, s), { applyLocally: false });
    const bEdit = { ...s, config: { ...s.config, theme: "dark" } };
    const saveB = runTransaction(ref(b, path), cur => mergeLocalIntoServer(cur, bEdit, s), { applyLocally: false });
    const [r] = await Promise.all([pending, saveA.catch(e => e), saveB.catch(e => e)]);
    // Then the failed save is sent again, still from the stale copy and base.
    await runTransaction(ref(a, path), cur => mergeLocalIntoServer(cur, aLocal, s), { applyLocally: false });
    offA(); offB();
    const f = await serverNow();
    console.log("S11 outcome:", r.outcome, r.reason || "");
    expect(agrees(r, f, "op-1")).toBe(true);
    expect(f.tasks.find(t => t.uuid === "c")?.title).toBe("Sample unsent edit");
    expect(f.config.theme).toBe("dark");
    if (r.outcome === "accepted") {
      expect(f.config.horizonReviews.week.pending ?? null).toBe(null);
      expect(f.tasks.find(t => t.uuid === "a").horizonLevel).toBe("today");
      expect(f.tasks.find(t => t.uuid === "b").isDeleted).toBe(true);
    } else {
      expect(f.config.horizonReviews.week.pending.end).toBe(SUN);
    }
  }, 60_000);
});

describe("#643 S7, S10: connection lost around a command", () => {
  it("S7: offline command + child update + another device saves: never a false success, no data lost", async () => {
    const s = await seedDetected();
    const a = client(); const b = client(); const offA = await listen(a); const offB = await listen(b);
    goOffline(a);
    let r = null;
    const pending = run(a, done(s, { b: "today" })).then(x => { r = x; console.log("S7 outcome:", JSON.stringify({ outcome: x.outcome, reason: x.reason })); });
    update(ref(a), { [`${path}/config/someSetting`]: "x" }).catch(() => {});
    const edited = { ...s, tasks: s.tasks.map(t => (t.uuid === "a" ? { ...t, title: "Edited elsewhere", lastUpdated: 20 } : t)) };
    await runTransaction(ref(b, path), cur => mergeLocalIntoServer(cur, edited, s));
    goOnline(a);
    await Promise.race([pending, wait(20000)]);
    // The app's next ordinary save (a transaction) is what settles a stuck one.
    if (!r) await runTransaction(ref(a, path), cur => (cur ? { ...cur, timestamp: (cur.timestamp || 0) + 1 } : undefined), { applyLocally: false });
    await Promise.race([pending, wait(10000)]);
    offA(); offB();
    const f = await serverNow();
    expect(r).not.toBeNull();
    expect(agrees(r, f, "op-1")).toBe(true);
    expect(f.config.someSetting).toBe("x");
    expect(f.tasks.find(t => t.uuid === "a").title).toBe("Edited elsewhere");
  }, 60_000);
  it("S10: started online, offline mid-command, another device acts, reconnect: outcome matches the server", async () => {
    const s = await seedDetected();
    const a = client(); const b = client(); const offA = await listen(a); const offB = await listen(b);
    let r = null;
    const pending = run(a, done(s, { a: "drop" }, "op-a")).then(x => { r = x; console.log("S10 outcome:", JSON.stringify({ outcome: x.outcome, reason: x.reason })); });
    goOffline(a);
    expect(r).toBeNull(); // not confirmed while offline
    const rb = await run(b, done(s, { b: "today" }, "op-b"));
    await wait(500);
    expect(r).toBeNull(); // still not confirmed
    goOnline(a);
    await Promise.race([pending, wait(20000)]);
    if (!r) await runTransaction(ref(a, path), cur => (cur ? { ...cur, timestamp: (cur.timestamp || 0) + 1 } : undefined), { applyLocally: false });
    await Promise.race([pending, wait(10000)]);
    offA(); offB();
    const f = await serverNow();
    expect(r).not.toBeNull();
    expect(agrees(r, f, "op-a")).toBe(true);
    expect(agrees(rb, f, "op-b")).toBe(true);
    // Exactly one Done applied: never both devices' choices.
    expect(r.outcome === "accepted" && rb.outcome === "accepted").toBe(false);
  }, 60_000);
  it("S10b: offline mid-Undo, then reconnect: the Undo's outcome matches the server", async () => {
    const s = await seedDetected();
    const a = client(); const offA = await listen(a);
    const cmd = done(s, { a: "today" });
    const d = await run(a, cmd);
    let r = null;
    const pending = run(a, { ...undoCommand(cmd, d.before, d.after), now: 600 }).then(x => { r = x; console.log("S10b outcome:", JSON.stringify({ outcome: x.outcome, reason: x.reason })); });
    goOffline(a);
    await wait(300);
    goOnline(a);
    await Promise.race([pending, wait(20000)]);
    offA();
    const f = await serverNow();
    expect(r).not.toBeNull();
    expect(r.outcome === "accepted").toBe(f.config.horizonReviews.week.undoneOp === "op-1");
    expect(r.outcome === "accepted").toBe(f.tasks.find(t => t.uuid === "a").horizonLevel === "week");
  }, 60_000);
});
