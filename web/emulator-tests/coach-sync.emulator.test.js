// #646: Coach's task changes through the app's merging full save
// (writeWithRetry → mergeLocalIntoServer), with two signed-in clients on the
// RTDB emulator and the real rules. Before #646, Coach wrote the whole tasks
// array with a child update(), and R1 lost the phone's completion.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { get, goOffline, goOnline, onValue, ref, update } from "firebase/database";

vi.mock("../src/firebase", () => ({ db: {}, auth: { currentUser: null } }));
const { writeWithRetry } = await import("../src/useSync");
const { isTaskCountDropSuspicious } = await import("../src/utils/normalizePayload");
const { moveTaskToHorizon } = await import("../src/utils/coachBrief");
const { buildSplit, undoSplit } = await import("../src/utils/splitTask");

let env;
const uid = "coach-sync-sample";
const path = `sync/${uid}`;
const task = (u, extra = {}) => ({ id: u, uuid: u, title: `Sample ${u}`, userId: "s@example.test", horizonLevel: "today",
  isCompleted: false, isDeleted: false, isParked: false, orderIndex: 0, lastUpdated: 10, ...extra });
const reply = (state) => ({ text: "Shall I move it?", isUser: false, at: 5, actions: [{ id: "act-1", type: "MOVE", state }] });
const seed = () => ({ userId: "s@example.test", timestamp: 1, config: { userId: "s@example.test", lastUpdated: 1 },
  tasks: [task("a"), task("b"), task("c")], contributions: [], brainDump: [], brainDumpUpdatedAt: 1,
  chatHistory: [{ text: "Help me plan", isUser: true, at: 4 }, reply("proposed")] });
const client = () => env.authenticatedContext(uid).database();
const server = async () => (await get(ref(client(), path))).val();
const listen = db => new Promise(res => { const off = onValue(ref(db, path), s => { if (s.exists()) res(off); }); });
// What savePayloadAsync sends: the device's latest payload, merged against the server.
const save = (db, local, base) => writeWithRetry(ref(db, path), local, base);
const byId = (s, u) => s.tasks.find(t => t.uuid === u);

async function twoDevices() {
  const a = client(); const b = client();
  await update(ref(a), { [path]: seed() });
  const offs = [await listen(a), await listen(b)];
  return { a, b, base: await server(), off: () => offs.forEach(o => o()) };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-loci-coach-sync",
    database: { host: "127.0.0.1", port: 9000, rules: readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8") } });
});
beforeEach(async () => { await env.clearDatabase(); });
afterAll(async () => { await env?.cleanup(); });

describe("#646 Coach changes through the merging save", () => {
  it("R1: the phone completes a task; the sleeping laptop's Coach move keeps it", async () => {
    const { a, b, base, off } = await twoDevices();
    goOffline(b);
    await save(a, { ...base, tasks: base.tasks.map(t => (t.uuid === "a" ? { ...t, isCompleted: true, lastUpdated: 50 } : t)), timestamp: 50 }, base);
    const moved = moveTaskToHorizon(base.tasks, "c", "week", 60);
    const pending = save(b, { ...base, tasks: moved.tasks, timestamp: 60 }, base);
    goOnline(b); await pending; off();
    const f = await server();
    expect(byId(f, "a").isCompleted).toBe(true);
    expect(byId(f, "c").horizonLevel).toBe("week");
  });

  it("Move + quick Undo in one save, while another device completes a task", async () => {
    const { a, b, base, off } = await twoDevices();
    await save(b, { ...base, tasks: base.tasks.map(t => (t.uuid === "a" ? { ...t, isCompleted: true, lastUpdated: 50 } : t)), timestamp: 50 }, base);
    const moved = moveTaskToHorizon(base.tasks, "c", "week", 60);
    const back = moved.tasks.map(t => (t.uuid === "c" ? { ...t, horizonLevel: "today", orderIndex: 0, lastUpdated: 61 } : t));
    await save(a, { ...base, tasks: back, timestamp: 61 }, base); off();
    const f = await server();
    expect(byId(f, "a").isCompleted).toBe(true);
    expect(byId(f, "c").horizonLevel).toBe("today");
  });

  it("Split into 4, then Undo with the pieces named: original back, pieces deleted, another device's rename kept", async () => {
    const { a, b, base, off } = await twoDevices();
    let n = 0;
    const steps = ["one", "two", "three", "four"].map(t => ({ text: `Sample step ${t}` }));
    const original = byId(base, "c");
    const { tasks: split, created } = buildSplit(base.tasks, original, steps, { now: 70, makeId: () => `piece-${n++}` });
    await save(a, { ...base, tasks: split, timestamp: 70 }, base);
    const afterSplit = await server();
    await save(b, { ...afterSplit, tasks: afterSplit.tasks.map(t => (t.uuid === "a" ? { ...t, title: "Renamed elsewhere", lastUpdated: 80 } : t)), timestamp: 80 }, afterSplit);
    const pieces = created.map(t => t.uuid);
    const undone = undoSplit(afterSplit.tasks, original, pieces, 90);
    // savePayloadAsync's drop guard: blocks without the names, passes with them.
    expect(isTaskCountDropSuspicious(undone, afterSplit.tasks, 3)).toBe(true);
    expect(isTaskCountDropSuspicious(undone, afterSplit.tasks, 3, pieces)).toBe(false);
    await save(a, { ...afterSplit, tasks: undone, timestamp: 90 }, afterSplit); off();
    const f = await server();
    expect(f.tasks.filter(t => !t.isDeleted).map(t => t.uuid).sort()).toEqual(["a", "b", "c"]);
    expect(byId(f, "a").title).toBe("Renamed elsewhere");
  });

  it("an action alongside another device's chat message: the task change and the message are both kept", async () => {
    const { a, b, base, off } = await twoDevices();
    await update(ref(b), { [`${path}/chatHistory`]: [...base.chatHistory, { text: "Another sample question", isUser: true, at: 9 }] });
    const moved = moveTaskToHorizon(base.tasks, "c", "week", 60);
    await save(a, { ...base, tasks: moved.tasks, chatHistory: [base.chatHistory[0], reply("applied")], timestamp: 60 }, base); off();
    const f = await server();
    expect(byId(f, "c").horizonLevel).toBe("week");
    expect(f.chatHistory.some(m => m.text === "Another sample question")).toBe(true);
    // Known, accepted (#646): both chat lists changed, so the server's list
    // wins and the button reads "proposed" again; a second tap is safe
    // (coachActions.test.js, "a reverted 'proposed' button").
    expect(f.chatHistory.find(m => m.actions).actions[0].state).toBe("proposed");
  });
});
