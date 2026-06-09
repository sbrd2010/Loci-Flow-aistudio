import { describe, it, expect } from "vitest";
import { buildToggleCompletedTasks, applyAiRewriteToTask } from "./taskOps";

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

// ── applyAiRewriteToTask ───────────────────────────────────────────────────────

const FULL_TASK = {
  uuid: "uuid-123",
  id: 1000,
  userId: "user@example.com",
  title: "Original title",
  concreteStep: "Original step",
  horizonLevel: "month",
  priority: "P1",
  category: "Work",
  timeEstimateMinutes: 60,
  orderIndex: 3,
  isCompleted: false,
  isDeleted: false,
  isParked: false,
  isNowFocus: true,
  isMVD: true,
  dayMapDate: "2026-06-09",
  dayMapPeriod: "morning",
  dayMapStartMinutes: 480,
  dayMapDurationMinutes: 60,
  dayMapOrder: 2,
  reminderAt: 9999999,
  dateCompletedString: null,
  subSteps: [{ id: "old-ss", text: "Existing step", done: false }],
  lastUpdated: 1000,
};

const AI = (overrides = {}) => ({
  title: "AI-rewritten title",
  microStep: "AI first action",
  priority: "P4",
  estimateMinutes: 15,
  horizonLevel: "week",
  subSteps: [{ text: "AI sub 1" }, { text: "AI sub 2" }],
  ...overrides,
});

describe("applyAiRewriteToTask", () => {
  it("preserves horizonLevel: month when AI suggests week", () => {
    const result = applyAiRewriteToTask(FULL_TASK, AI({ horizonLevel: "week" }));
    expect(result.horizonLevel).toBe("month");
  });

  it("preserves horizonLevel: office (Work tab) unchanged", () => {
    const task = { ...FULL_TASK, horizonLevel: "office" };
    const result = applyAiRewriteToTask(task, AI({ horizonLevel: "week" }));
    expect(result.horizonLevel).toBe("office");
  });

  it("preserves all DayMap fields", () => {
    const result = applyAiRewriteToTask(FULL_TASK, AI());
    expect(result.dayMapDate).toBe("2026-06-09");
    expect(result.dayMapPeriod).toBe("morning");
    expect(result.dayMapStartMinutes).toBe(480);
    expect(result.dayMapDurationMinutes).toBe(60);
    expect(result.dayMapOrder).toBe(2);
  });

  it("preserves isNowFocus", () => {
    const result = applyAiRewriteToTask(FULL_TASK, AI());
    expect(result.isNowFocus).toBe(true);
  });

  it("does not uncomplete a completed task", () => {
    const task = { ...FULL_TASK, isCompleted: true, dateCompletedString: "2026-06-01" };
    const result = applyAiRewriteToTask(task, AI());
    expect(result.isCompleted).toBe(true);
    expect(result.dateCompletedString).toBe("2026-06-01");
  });

  it("preserves isParked", () => {
    const task = { ...FULL_TASK, isParked: true };
    const result = applyAiRewriteToTask(task, AI());
    expect(result.isParked).toBe(true);
  });

  it("does not resurrect a soft-deleted task", () => {
    const task = { ...FULL_TASK, isDeleted: true };
    const result = applyAiRewriteToTask(task, AI());
    expect(result.isDeleted).toBe(true);
  });

  it("preserves uuid and id", () => {
    const result = applyAiRewriteToTask(FULL_TASK, AI());
    expect(result.uuid).toBe("uuid-123");
    expect(result.id).toBe(1000);
  });

  it("updates only title, concreteStep, subSteps, and lastUpdated", () => {
    const before = Date.now();
    const result = applyAiRewriteToTask(FULL_TASK, AI());
    expect(result.title).toBe("AI-rewritten title");
    expect(result.concreteStep).toBe("AI first action");
    expect(result.subSteps[0].text).toBe("AI sub 1");
    expect(result.subSteps[1].text).toBe("AI sub 2");
    expect(result.lastUpdated).toBeGreaterThanOrEqual(before);
    // planning metadata unchanged
    expect(result.priority).toBe("P1");
    expect(result.timeEstimateMinutes).toBe(60);
    expect(result.orderIndex).toBe(3);
  });

  it("malformed AI output (null title, no subSteps) falls back to original", () => {
    const result = applyAiRewriteToTask(FULL_TASK, { title: null, microStep: null, subSteps: null });
    expect(result.title).toBe("Original title");
    expect(result.concreteStep).toBe("Original step");
    expect(result.subSteps).toEqual(FULL_TASK.subSteps);
  });

  it("long task: AI subSteps preserve key details with text intact", () => {
    const result = applyAiRewriteToTask(FULL_TASK, AI({
      subSteps: [{ text: "  Key point 1  " }, { text: "Key point 2" }, { text: "" }],
    }));
    // empty text entry filtered out, whitespace trimmed
    expect(result.subSteps).toHaveLength(2);
    expect(result.subSteps[0].text).toBe("Key point 1");
    expect(result.subSteps[1].text).toBe("Key point 2");
  });

  it("preserves unknown future fields via spread", () => {
    const task = { ...FULL_TASK, futureField: "keep-me", anotherField: 42 };
    const result = applyAiRewriteToTask(task, AI());
    expect(result.futureField).toBe("keep-me");
    expect(result.anotherField).toBe(42);
  });
});
