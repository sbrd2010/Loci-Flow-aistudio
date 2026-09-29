import { describe, expect, it } from "vitest";
import { endSessionTasks, switchToNextTasks, withNextStep } from "./focusEnd";

const task = { uuid: "a", title: "Prepare CV", horizonLevel: "today", orderIndex: 0, subSteps: [
  { id: "s1", text: "Put the vacancies in one doc", done: true },
  { id: "s2", text: "Tailor the summary", done: false },
] };

describe("End session (59h)", () => {
  it("does nothing without a note or a move", () => {
    expect(endSessionTasks([task], task, { note: "  " })).toBeNull();
  });

  it("puts where you stopped ahead of the steps still open, as the next step", () => {
    const { tasks } = endSessionTasks([task], task, { note: "Draft the Verant paragraph", makeId: () => "n1", now: 1 });
    expect(tasks[0].subSteps.map(s => s.text)).toEqual(["Put the vacancies in one doc", "Draft the Verant paragraph", "Tailor the summary"]);
    expect(tasks[0].concreteStep).toBe("Draft the Verant paragraph");
  });

  it("keeps the note to 300 characters, the database's limit", () => {
    const { tasks } = endSessionTasks([task], task, { note: "x".repeat(400), makeId: () => "n1" });
    expect(tasks[0].concreteStep).toHaveLength(300);
  });

  it("moves the task to tomorrow, with what Undo puts back", () => {
    const { tasks, before } = endSessionTasks([task], task, { tomorrow: true, tomorrowStr: "2026-09-30" });
    expect(tasks[0].deferredUntil).toBe("2026-09-30");
    expect(before).toEqual([task]);
  });
});

describe("I'm stuck (59d)", () => {
  it("puts a smaller step ahead of the steps still open", () => {
    const tasks = withNextStep([task], task, "Open the doc", { makeId: () => "n1", now: 1 });
    expect(tasks[0].subSteps.map(s => s.text)).toEqual(["Put the vacancies in one doc", "Open the doc", "Tailor the summary"]);
  });

  it("leaves the tasks alone with no text", () => {
    const tasks = [task];
    expect(withNextStep(tasks, task, "  ")).toBe(tasks);
  });

  it("switches: the next task is the one thing, this one heads Today's list", () => {
    const a = { ...task, isNowFocus: true, orderIndex: 2 };
    const b = { uuid: "b", title: "Book the dentist", horizonLevel: "today", orderIndex: 0 };
    const c = { uuid: "c", title: "Water the plants", horizonLevel: "today", orderIndex: -3 };
    const out = switchToNextTasks([a, b, c], a, b, 5);
    expect(out.find(t => t.uuid === "b").isNowFocus).toBe(true);
    const moved = out.find(t => t.uuid === "a");
    expect(moved.isNowFocus).toBe(false);
    expect(moved.orderIndex).toBe(-4);
    expect(out.find(t => t.uuid === "c")).toBe(c);
  });
});
