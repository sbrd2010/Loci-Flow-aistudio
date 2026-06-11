import { describe, expect, it } from "vitest";
import { buildLociCoreInstruction, buildLociCheckinContext, buildLociTaskContext, getLocalDateString, isActiveLociTask } from "./lociAIContext";

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

describe("buildLociCheckinContext", () => {
  const TODAY = "2024-06-15";
  const YESTERDAY = "2024-06-14";

  const TASKS = [
    { uuid: "t1", title: "Send proposal", isCompleted: false, isDeleted: false, horizonLevel: "today" },
    { uuid: "t2", title: "Review budget", isCompleted: false, isDeleted: false, horizonLevel: "today" },
    { uuid: "t3", title: "Email client", isCompleted: true, isDeleted: false, horizonLevel: "today" },
    { uuid: "t4", title: "Old removed task", isCompleted: false, isDeleted: true, horizonLevel: "today" },
    { uuid: "t5", title: "Old roadmap idea", isCompleted: false, isDeleted: false, horizonLevel: "week", isParked: true },
  ];

  it("1. returns an empty string when there is no check-in data for today", () => {
    expect(buildLociCheckinContext({}, TASKS, TODAY)).toBe("");
  });

  it("2. includes today's committed task titles only", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1", "t2", "t3"] };
    const context = buildLociCheckinContext(config, TASKS, TODAY);

    expect(context).toContain("Send proposal");
    expect(context).toContain("Review budget");
    expect(context).toContain("Email client");
    expect(context).not.toContain("Old roadmap idea");
  });

  it("3. ignores deleted/missing selected task IDs", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1", "t4", "does-not-exist"] };
    const context = buildLociCheckinContext(config, TASKS, TODAY);

    expect(context).toContain("Send proposal");
    expect(context).not.toContain("Old removed task");
    expect(context).toContain("1 task selected; 0 complete, 1 remaining");
  });

  it("4. counts completed vs remaining committed tasks correctly", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1", "t2", "t3"] };
    const context = buildLociCheckinContext(config, TASKS, TODAY);

    expect(context).toContain("3 tasks selected; 1 complete, 2 remaining");
    expect(context).toContain("Remaining committed tasks: 'Send proposal', 'Review budget'");
    expect(context).toContain("Completed committed tasks: 'Email client'");
  });

  it("5. includes the narrowed task only if it still exists and belongs to the commitment", () => {
    const base = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1", "t2"] };

    const narrowed = buildLociCheckinContext({ ...base, dailyCommitmentNarrowedTaskId: "t1" }, TASKS, TODAY);
    expect(narrowed).toContain("Narrowed focus: 'Send proposal'");

    const stale = buildLociCheckinContext({ ...base, dailyCommitmentNarrowedTaskId: "t3" }, TASKS, TODAY);
    expect(stale).not.toContain("Narrowed focus");
  });

  it("6. includes reflection mood/note only for today", () => {
    const today = buildLociCheckinContext(
      { dailyReflectionDate: TODAY, dailyReflectionMood: "rough", dailyReflectionNote: "Start with the proposal before messages." },
      TASKS,
      TODAY
    );
    expect(today).toContain("Reflection: Rough but moving.");
    expect(today).toContain("Tomorrow note: 'Start with the proposal before messages.'");

    const stale = buildLociCheckinContext(
      { dailyReflectionDate: YESTERDAY, dailyReflectionMood: "rough", dailyReflectionNote: "Old note" },
      TASKS,
      TODAY
    );
    expect(stale).toBe("");
  });

  it("7. truncates and sanitizes a long reflection note", () => {
    const longNote = "a".repeat(200);
    const context = buildLociCheckinContext({ dailyReflectionDate: TODAY, dailyReflectionNote: longNote }, TASKS, TODAY);
    const noteLine = context.split("\n").find(line => line.startsWith("- Tomorrow note:"));

    expect(noteLine.length).toBeLessThan(170);
    expect(noteLine).toContain("...");

    const messyNote = "Line one\nLine two **bold**";
    const messyContext = buildLociCheckinContext({ dailyReflectionDate: TODAY, dailyReflectionNote: messyNote }, TASKS, TODAY);
    expect(messyContext).toContain("Tomorrow note: 'Line one Line two bold'");
  });

  it("8. does not include old-day check-in data", () => {
    const config = {
      dailyCommitmentDate: YESTERDAY,
      dailyCommitmentTaskIds: ["t1"],
      dailyMiddayCheckDate: YESTERDAY,
      dailyReflectionDate: YESTERDAY,
      dailyReflectionMood: "rough",
      dailyReflectionNote: "Old note",
    };
    expect(buildLociCheckinContext(config, TASKS, TODAY)).toBe("");
  });

  it("9. does not include parked/roadmap/brain-dump data", () => {
    const config = { dailyReflectionDate: TODAY, dailyReflectionMood: "better" };
    const context = buildLociCheckinContext(config, TASKS, TODAY);

    expect(context).toContain("Better than yesterday");
    expect(context).not.toContain("Old roadmap idea");
  });

  it("10. does not include diagnostic or medical language", () => {
    const config = {
      dailyCommitmentDate: TODAY,
      dailyCommitmentTaskIds: ["t1", "t2", "t3"],
      dailyMiddayCheckDate: TODAY,
      dailyCommitmentNarrowedTaskId: "t1",
      dailyReflectionDate: TODAY,
      dailyReflectionMood: "reset",
      dailyReflectionNote: "Take it slow tomorrow.",
      deadlineLabel: "Visa deadline",
      deadlineAction: "Send one email",
    };
    const context = buildLociCheckinContext(config, TASKS, TODAY);

    expect(context).not.toMatch(/ADHD|diagnos|disorder|medical|failed/i);
  });

  it("11. CoachTab can append the empty-string context without crashing", () => {
    const context = buildLociCheckinContext({}, [], TODAY);
    expect(context).toBe("");
    expect(`${context ? `\n${context}\n` : ""}`).toBe("");
  });

  it("12. works without any AI key present and never leaks key-like config", () => {
    const config = { groqKey: "secret-groq", geminiKey: "secret-gemini", dailyReflectionDate: TODAY, dailyReflectionMood: "better" };
    const context = buildLociCheckinContext(config, [], TODAY);

    expect(context).toContain("Better than yesterday");
    expect(context).not.toContain("secret-groq");
    expect(context).not.toContain("secret-gemini");
  });
});
