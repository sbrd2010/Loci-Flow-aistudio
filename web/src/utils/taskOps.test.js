import { describe, it, expect } from "vitest";
import { buildToggleCompletedTasks } from "./taskOps";

const T = (overrides = {}) => ({
  uuid: "task-1",
  title: "Test task",
  isCompleted: false,
  isNowFocus: false,
  dateCompletedString: null,
  ...overrides,
});

describe("buildToggleCompletedTasks", () => {
  it("completing the Now Focus task clears isNowFocus", () => {
    const task = T({ isNowFocus: true });
    const result = buildToggleCompletedTasks([task], task.uuid, true, "2026-06-09");
    expect(result[0].isNowFocus).toBe(false);
    expect(result[0].isCompleted).toBe(true);
  });

  it("completing a non-focused task does not clear isNowFocus on another task", () => {
    const focused = T({ uuid: "task-focus", isNowFocus: true });
    const other = T({ uuid: "task-other", isNowFocus: false });
    const result = buildToggleCompletedTasks([focused, other], other.uuid, true, "2026-06-09");
    // focused task is untouched
    expect(result[0].isNowFocus).toBe(true);
    expect(result[0].isCompleted).toBe(false);
    // completed task has isNowFocus cleared
    expect(result[1].isNowFocus).toBe(false);
    expect(result[1].isCompleted).toBe(true);
  });

  it("un-completing a task does not restore isNowFocus", () => {
    const task = T({ isCompleted: true, isNowFocus: false });
    const result = buildToggleCompletedTasks([task], task.uuid, false, "2026-06-09");
    expect(result[0].isCompleted).toBe(false);
    expect(result[0].isNowFocus).toBe(false);
  });

  it("sets dateCompletedString on complete and clears it on un-complete", () => {
    const date = "2026-06-09";
    const completing = buildToggleCompletedTasks([T()], "task-1", true, date);
    expect(completing[0].dateCompletedString).toBe(date);

    const uncompleting = buildToggleCompletedTasks([T({ isCompleted: true, dateCompletedString: date })], "task-1", false, date);
    expect(uncompleting[0].dateCompletedString).toBeNull();
  });

  it("does not mutate tasks that are not the target", () => {
    const task = T({ uuid: "task-1" });
    const bystander = T({ uuid: "task-2", title: "Bystander" });
    const result = buildToggleCompletedTasks([task, bystander], task.uuid, true, "2026-06-09");
    expect(result[1]).toBe(bystander); // same reference — not touched
  });

  it("stamps lastUpdated on the completed task", () => {
    const before = Date.now();
    const task = T();
    const result = buildToggleCompletedTasks([task], task.uuid, true, "2026-06-09");
    expect(result[0].lastUpdated).toBeGreaterThanOrEqual(before);
  });
});
