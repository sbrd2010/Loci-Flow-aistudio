import { describe, expect, it } from "vitest";
import { buildLociCoreInstruction, buildLociTaskContext, getLocalDateString, isActiveLociTask } from "./lociAIContext";

describe("lociAIContext", () => {
  it("treats parked tasks as inactive for AI mirrors", () => {
    expect(isActiveLociTask({ title: "active" })).toBe(true);
    expect(isActiveLociTask({ title: "done", isCompleted: true })).toBe(false);
    expect(isActiveLociTask({ title: "deleted", isDeleted: true })).toBe(false);
    expect(isActiveLociTask({ title: "parked", isParked: true })).toBe(false);
  });

  it("formats local dates without UTC rollover", () => {
    expect(getLocalDateString(new Date(2026, 5, 7, 23, 30))).toBe("2026-06-07");
  });

  it("builds task context from active tasks only", () => {
    const context = buildLociTaskContext([
      { title: "Send CV", horizonLevel: "today", priority: "P1", timeEstimateMinutes: 25, isNowFocus: true },
      { title: "Parked old task", horizonLevel: "today", priority: "P1", isParked: true },
      { title: "Done task", horizonLevel: "week", priority: "P2", isCompleted: true },
      { title: "Plan interview prep", horizonLevel: "week", priority: "P2", timeEstimateMinutes: 45 }
    ]);

    expect(context).toContain("TODAY (1)");
    expect(context).toContain("[NOW FOCUS] Send CV");
    expect(context).toContain("THIS WEEK (1)");
    expect(context).toContain("Plan interview prep");
    expect(context).not.toContain("Parked old task");
    expect(context).not.toContain("Done task");
  });

  it("keeps the central coach instruction execution-focused and data-safe", () => {
    const instruction = buildLociCoreInstruction({ firstName: "Rohan" });

    expect(instruction).toContain("execution coach");
    expect(instruction).toContain("move from planning to action");
    expect(instruction).toContain("Do not delete, overwrite, or replace user data without clear confirmation");
    expect(instruction).toContain("Today, Week, Month, Quarter, 6 Months, Work");
    expect(instruction).toContain("Never use the word \"ADHD\" in user-facing responses");
  });
});
