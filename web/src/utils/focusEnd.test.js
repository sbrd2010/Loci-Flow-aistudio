import { describe, expect, it } from "vitest";
import { endSessionTasks } from "./focusEnd";

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
