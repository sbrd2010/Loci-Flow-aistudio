import { describe, expect, it } from "vitest";
import { buildSplit, evenMinutes, stepsFromSubSteps, undoSplit } from "./splitTask";

describe("evenMinutes", () => {
  it("shares the total, 45 minutes at most per step", () => {
    expect(evenMinutes(120, 3)).toEqual([45, 45, 30]);
    expect(evenMinutes(60, 2)).toEqual([30, 30]);
    expect(evenMinutes(25, 2)).toEqual([15, 10]);
    expect(evenMinutes(300, 2)).toEqual([45, 45]);
  });
});

describe("stepsFromSubSteps", () => {
  it("uses two or more open sub-steps, and ignores done ones", () => {
    const task = { timeEstimateMinutes: 60, subSteps: [{ text: "Collect figures", done: false }, { text: "Old", done: true }, { text: "Draft slides", done: false }] };
    expect(stepsFromSubSteps(task)).toEqual([{ text: "Collect figures", minutes: 30 }, { text: "Draft slides", minutes: 30 }]);
  });
  it("offers nothing for one or no sub-step", () => {
    expect(stepsFromSubSteps({ subSteps: [{ text: "Only", done: false }] })).toEqual([]);
    expect(stepsFromSubSteps({})).toEqual([]);
  });
});

describe("buildSplit / undoSplit", () => {
  let n = 0;
  const makeId = () => `new-${++n}`;
  const original = { uuid: "o", title: "Brightlab PPT: final draft", horizonLevel: "today", priority: "P2", frontId: "f1", orderIndex: 3, isNowFocus: true, timeEstimateMinutes: 120 };
  const other = { uuid: "x", title: "Other", horizonLevel: "today", orderIndex: 4 };

  it("replaces the original with the steps, in its place, the pin on the first", () => {
    const steps = [{ text: "Collect figures", minutes: 30 }, { text: "  ", minutes: 10 }, { text: "Draft slides 1–8", minutes: 45 }];
    const { tasks, created } = buildSplit([original, other], original, steps, { now: 1, makeId });
    expect(created.map(t => t.title)).toEqual(["Collect figures", "Draft slides 1–8"]);
    expect(created[0]).toMatchObject({ horizonLevel: "today", priority: "P2", frontId: "f1", timeEstimateMinutes: 30, isNowFocus: true, splitFrom: "o" });
    expect(created[1].isNowFocus).toBe(false);
    expect(created.every(t => t.orderIndex >= 3 && t.orderIndex < 4)).toBe(true);
    expect(tasks.find(t => t.uuid === "o")).toMatchObject({ isDeleted: true, isNowFocus: false });
  });

  it("Undo brings the original back, pinned, and removes what the split made", () => {
    const { tasks, created } = buildSplit([original, other], original, [{ text: "A", minutes: 30 }, { text: "B", minutes: 30 }], { now: 1, makeId });
    const back = undoSplit(tasks, original, created.map(t => t.uuid), 2);
    expect(back.find(t => t.uuid === "o")).toMatchObject({ isDeleted: false, isNowFocus: true });
    expect(back.filter(t => created.some(c => c.uuid === t.uuid)).every(t => t.isDeleted && !t.isNowFocus)).toBe(true);
  });

  it("Undo leaves the pin alone if something else was pinned since", () => {
    const { tasks, created } = buildSplit([original, other], original, [{ text: "A", minutes: 30 }], { now: 1, makeId });
    const repinned = tasks.map(t => t.uuid === "x" ? { ...t, isNowFocus: true } : t.uuid === created[0].uuid ? { ...t, isNowFocus: false } : t);
    expect(undoSplit(repinned, original, created.map(t => t.uuid), 2).find(t => t.uuid === "o").isNowFocus).toBe(false);
  });
});
