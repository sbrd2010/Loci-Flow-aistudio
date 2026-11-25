import { describe, it, expect } from "vitest";
import { addTaskToPayload } from "./addTaskToPayload";

// #680: Add task builds its save from the live payload after any wait.
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const thought = { id: "th1", text: "Sample thought", createdAt: 1 };
const live = (over = {}) => deepFreeze({
  userId: "sample@example.test",
  timestamp: 100,
  tasks: [
    { uuid: "t1", title: "Sample one", horizonLevel: "today", isDeleted: false },
    { uuid: "t2", title: "Sample two, renamed elsewhere", horizonLevel: "today", isDeleted: false },
    { uuid: "t3", title: "Sample gone", horizonLevel: "today", isDeleted: true },
    { uuid: "w1", title: "Sample week", horizonLevel: "week", isDeleted: false },
  ],
  config: { userName: "Changed elsewhere", eveningGuardWindowActive: false },
  contributions: [{ dateString: "2026-11-24", count: 2 }],
  brainDump: [thought, { id: "th2", text: "Another sample thought", createdAt: 2 }],
  chatHistory: [{ role: "user", text: "Sample chat" }],
  ...over,
});
const task = { uuid: "new", id: 7, title: "Sample new task", concreteStep: "Open the sample folder", horizonLevel: "today", priority: "P2", reminderAt: 123, subSteps: [] };
const noon = new Date(2026, 10, 25, 12, 0);

describe("addTaskToPayload (#680)", () => {
  it("appends the task to the live tasks, with orderIndex from the live list", () => {
    const next = addTaskToPayload(live(), task, { at: noon });
    expect(next.tasks.map(t => t.uuid)).toEqual(["t1", "t2", "t3", "w1", "new"]);
    expect(next.tasks.at(-1)).toEqual({ ...task, orderIndex: 2 }); // t1, t2 open on Today; t3 deleted; w1 another horizon
  });
  it("keeps every other live field exactly as it is", () => {
    const current = live();
    const next = addTaskToPayload(current, task, { at: noon });
    for (const key of ["userId", "timestamp", "config", "contributions", "brainDump", "chatHistory"]) expect(next[key]).toBe(current[key]);
    expect(next.tasks.slice(0, 4)).toEqual(current.tasks);
  });
  it("adds exactly one task, with the given uuid", () => {
    const next = addTaskToPayload(live(), task, { at: noon });
    expect(next.tasks.filter(t => t.uuid === "new")).toHaveLength(1);
  });
  it("consumes the source thought when it is unchanged", () => {
    const next = addTaskToPayload(live(), task, { at: noon, fromThoughtId: "th1", sourceThought: thought });
    expect(next.brainDump.map(d => d.id)).toEqual(["th2"]);
  });
  it("keeps the thought if it was edited elsewhere meanwhile", () => {
    const edited = live({ brainDump: [{ ...thought, text: "Sample thought, edited on the phone" }] });
    const next = addTaskToPayload(edited, task, { at: noon, fromThoughtId: "th1", sourceThought: thought });
    expect(next.brainDump.map(d => d.text)).toEqual(["Sample thought, edited on the phone"]);
  });
  it("does not bring back a thought deleted elsewhere meanwhile", () => {
    const gone = live({ brainDump: [{ id: "th2", text: "Another sample thought", createdAt: 2 }] });
    const next = addTaskToPayload(gone, task, { at: noon, fromThoughtId: "th1", sourceThought: thought });
    expect(next.brainDump.map(d => d.id)).toEqual(["th2"]);
  });
  it("leaves the Mind Box alone when the task isn't made from a thought", () => {
    const current = live();
    expect(addTaskToPayload(current, task, { at: noon }).brainDump).toBe(current.brainDump);
  });
  it("returns null (nothing to save) when the live Evening Guard blocks a new task", () => {
    const guarded = live({ config: { eveningGuardWindowActive: true } });
    expect(addTaskToPayload(guarded, task, { at: new Date(2026, 10, 25, 21, 0) })).toBeNull();
    expect(addTaskToPayload(guarded, task, { at: noon })).not.toBeNull();
  });
});
