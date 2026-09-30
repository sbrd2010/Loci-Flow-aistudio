import { describe, it, expect } from "vitest";
import { makeOneThing, undoOneThing } from "./oneThing";

const T = (uuid, extra = {}) => ({ uuid, title: uuid, horizonLevel: "today", orderIndex: 0, ...extra });

describe("makeOneThing (50c–d)", () => {
  const tasks = [
    T("acme", { isNowFocus: true, orderIndex: 5, subSteps: [{ id: "s1", text: "Open", done: false }] }),
    T("hale", { orderIndex: 1 }),
    T("verant", { orderIndex: 3 }),
    T("week", { horizonLevel: "week", orderIndex: -9 }),
  ];

  it("pins the task and sends the old one thing to the top of the list with its steps", () => {
    const { tasks: next, previous } = makeOneThing(tasks, "verant", 100);
    expect(previous.uuid).toBe("acme");
    const byId = Object.fromEntries(next.map(t => [t.uuid, t]));
    expect(byId.verant.isNowFocus).toBe(true);
    expect(byId.acme.isNowFocus).toBe(false);
    expect(byId.acme.subSteps).toHaveLength(1);
    // Above every other open Today task; other horizons don't count.
    expect(byId.acme.orderIndex).toBeLessThan(byId.hale.orderIndex);
    expect(byId.acme.orderIndex).toBe(0);
    expect(next.filter(t => t.isNowFocus)).toHaveLength(1);
  });

  it("with nothing pinned just pins, and has nothing to send back", () => {
    const { tasks: next, previous } = makeOneThing(tasks.map(t => ({ ...t, isNowFocus: false })), "hale");
    expect(previous).toBe(null);
    expect(next.find(t => t.uuid === "hale").isNowFocus).toBe(true);
  });

  it("brings a task moved to tomorrow back to today", () => {
    const { tasks: next } = makeOneThing([...tasks, T("later", { deferredUntil: "2026-09-28" })], "later");
    expect(next.find(t => t.uuid === "later")).toMatchObject({ isNowFocus: true, deferredUntil: null });
  });

  it("ignores a done or deleted task", () => {
    const withGone = [...tasks, T("gone", { isDeleted: true })];
    expect(makeOneThing(withGone, "gone").tasks).toBe(withGone);
    expect(makeOneThing([T("done", { isCompleted: true })], "done").previous).toBe(null);
  });
});

describe("undoOneThing", () => {
  const tasks = [T("acme", { isNowFocus: true, orderIndex: 5 }), T("verant", { orderIndex: 3 })];

  it("puts the old one thing back where it was, pinned", () => {
    const { tasks: swapped, previous } = makeOneThing(tasks, "verant");
    const back = undoOneThing(swapped, "verant", previous);
    expect(back.find(t => t.uuid === "acme")).toMatchObject({ isNowFocus: true, orderIndex: 5 });
    expect(back.find(t => t.uuid === "verant").isNowFocus).toBe(false);
  });

  it("with nothing pinned before, just unpins", () => {
    const { tasks: pinned, previous } = makeOneThing(tasks.map(t => ({ ...t, isNowFocus: false })), "verant");
    const back = undoOneThing(pinned, "verant", previous);
    expect(back.filter(t => t.isNowFocus)).toHaveLength(0);
  });

  it("does nothing once the pin has moved on", () => {
    const { tasks: swapped, previous } = makeOneThing(tasks, "verant");
    const moved = swapped.map(t => ({ ...t, isNowFocus: false }));
    expect(undoOneThing(moved, "verant", previous)).toBe(moved);
  });
});

// 10b: a call at a set time is never the one thing, whoever asks (Q36.3).
import { makeOneThing as pin } from "./oneThing";
it("makeOneThing refuses a set-time call", () => {
  const tasks = [{ uuid: "call", horizonLevel: "today", fixedKind: "event", dayMapFixedMinutes: 600, dayMapStartMinutes: 600, dayMapDate: "2026-09-30" }];
  const { tasks: next, previous } = pin(tasks, "call");
  expect(next).toBe(tasks);
  expect(previous).toBe(null);
});
