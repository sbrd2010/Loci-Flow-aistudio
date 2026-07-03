import { describe, it, expect } from "vitest";
import { getFocusWindows, getLociDayStr } from "./focusWindows";
import {
  shouldShowMorningCommitment,
  buildMorningCommitmentPrompt,
  canSaveMorningCommitment,
  buildMorningCommitmentSave,
  buildMorningCommitmentSkip,
  buildMorningCommitmentSnooze,
  getValidCommittedTaskIds,
  shouldShowMiddayCheck,
  buildMiddayProgressSummary,
  buildMiddayCheckDone,
  buildNarrowToOne,
  shouldShowReflection,
  buildEndOfDaySummary,
  buildReflectionSave,
  getLocalCheckinLine,
  pickCheckinLine,
} from "./dailyCoachCheckins";

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);
const TODAY = "2024-06-15";

describe("Morning Commitment eligibility", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });

  it("1. appears after the first focus window starts", () => {
    expect(shouldShowMorningCommitment(dt(9, 0), windows, {}, TODAY, false)).toBe(true);
    expect(shouldShowMorningCommitment(dt(12, 0), windows, {}, TODAY, false)).toBe(true);
  });

  it("2. does not appear before the first focus window starts", () => {
    expect(shouldShowMorningCommitment(dt(8, 59), windows, {}, TODAY, false)).toBe(false);
  });

  it("3. does not appear if already completed today", () => {
    const config = { dailyCommitmentDate: TODAY };
    expect(shouldShowMorningCommitment(dt(10), windows, config, TODAY, false)).toBe(false);
  });

  it("4. does not appear if skipped today", () => {
    const config = { dailyCommitmentSkippedDate: TODAY };
    expect(shouldShowMorningCommitment(dt(10), windows, config, TODAY, false)).toBe(false);
  });

  it("5. respects snooze", () => {
    const config = { dailyCommitmentSnoozeUntil: dt(11, 0).getTime() };
    expect(shouldShowMorningCommitment(dt(10, 30), windows, config, TODAY, false)).toBe(false);
    expect(shouldShowMorningCommitment(dt(11, 0), windows, config, TODAY, false)).toBe(true);
  });

  it("6. waits if Morning Ritual is showing (or still pending)", () => {
    expect(shouldShowMorningCommitment(dt(9, 30), windows, {}, TODAY, true)).toBe(false);
    expect(shouldShowMorningCommitment(dt(9, 30), windows, {}, TODAY, false)).toBe(true);
  });

  it("7. never appears when dailyCheckinsEnabled is false, regardless of other conditions", () => {
    expect(shouldShowMorningCommitment(dt(9, 30), windows, { dailyCheckinsEnabled: false }, TODAY, false)).toBe(false);
  });

  it("8. still appears when dailyCheckinsEnabled is undefined or true (default-on)", () => {
    expect(shouldShowMorningCommitment(dt(9, 30), windows, { dailyCheckinsEnabled: true }, TODAY, false)).toBe(true);
    expect(shouldShowMorningCommitment(dt(9, 30), windows, {}, TODAY, false)).toBe(true);
  });
});

describe("buildMorningCommitmentPrompt", () => {
  it("0 tasks: empty-state copy, no picks possible", () => {
    const prompt = buildMorningCommitmentPrompt([]);
    expect(prompt.mode).toBe("empty");
    expect(prompt.maxPicks).toBe(0);
    expect(prompt.line).toMatch(/add one tiny task/i);
  });

  it("1-3 tasks: asks user to choose what matters most", () => {
    const prompt = buildMorningCommitmentPrompt([{ uuid: "a" }, { uuid: "b" }]);
    expect(prompt.mode).toBe("choose");
    expect(prompt.maxPicks).toBe(2);
  });

  it(">3 tasks: caps picks at 3 and mentions the total count", () => {
    const tasks = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }, { uuid: "d" }, { uuid: "e" }];
    const prompt = buildMorningCommitmentPrompt(tasks);
    expect(prompt.maxPicks).toBe(3);
    expect(prompt.line).toContain("5 tasks");
    expect(prompt.line).toMatch(/non-negotiables/i);
  });
});

describe("canSaveMorningCommitment", () => {
  it("disallows empty selection when there are Today tasks", () => {
    expect(canSaveMorningCommitment([], 3)).toBe(false);
  });

  it("allows empty selection when there are zero Today tasks", () => {
    expect(canSaveMorningCommitment([], 0)).toBe(true);
  });

  it("allows 1-3 selections, rejects more than 3", () => {
    expect(canSaveMorningCommitment(["a"], 5)).toBe(true);
    expect(canSaveMorningCommitment(["a", "b", "c"], 5)).toBe(true);
    expect(canSaveMorningCommitment(["a", "b", "c", "d"], 5)).toBe(false);
  });
});

describe("Morning Commitment config builders", () => {
  it("save records date, taskIds (capped at 3), source, and clears skip/snooze", () => {
    const config = { dailyCommitmentSkippedDate: "2024-06-14", dailyCommitmentSnoozeUntil: 123, somethingElse: true };
    const next = buildMorningCommitmentSave(config, ["a", "b", "c", "d"], TODAY, 1000);
    expect(next.dailyCommitmentDate).toBe(TODAY);
    expect(next.dailyCommitmentTaskIds).toEqual(["a", "b", "c"]);
    expect(next.dailyCommitmentSource).toBe("morning");
    expect(next.dailyCommitmentSkippedDate).toBe(null);
    expect(next.dailyCommitmentSnoozeUntil).toBe(null);
    expect(next.dailyCommitmentCreatedAt).toBe(1000);
    expect(next.somethingElse).toBe(true); // unrelated config fields preserved
  });

  it("skip records skipped date and clears snooze", () => {
    const next = buildMorningCommitmentSkip({ foo: "bar" }, TODAY, 1000);
    expect(next.dailyCommitmentSkippedDate).toBe(TODAY);
    expect(next.dailyCommitmentSnoozeUntil).toBe(null);
    expect(next.foo).toBe("bar");
  });

  it("snooze sets a future timestamp", () => {
    const next = buildMorningCommitmentSnooze({}, 1000);
    expect(next.dailyCommitmentSnoozeUntil).toBeGreaterThan(1000);
  });
});

describe("Midday Progress Check eligibility", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] }); // 8h total, midpoint = 13:00
  const baseConfig = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };

  it("7. appears only once a same-day commitment exists and the scheduled midpoint has passed", () => {
    expect(shouldShowMiddayCheck(dt(12, 59), windows, baseConfig, TODAY)).toBe(false);
    expect(shouldShowMiddayCheck(dt(13, 0), windows, baseConfig, TODAY)).toBe(true);
  });

  it("does not appear before a commitment was made today", () => {
    expect(shouldShowMiddayCheck(dt(14), windows, {}, TODAY)).toBe(false);
    expect(shouldShowMiddayCheck(dt(14), windows, { dailyCommitmentDate: "2024-06-14", dailyCommitmentTaskIds: ["t1"] }, TODAY)).toBe(false);
  });

  it("8. does not appear if no commitment was selected (skipped, or saved empty)", () => {
    expect(shouldShowMiddayCheck(dt(14), windows, { dailyCommitmentSkippedDate: TODAY }, TODAY)).toBe(false);
    expect(shouldShowMiddayCheck(dt(14), windows, { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: [] }, TODAY)).toBe(false);
  });

  it("9. midpoint uses scheduled focus time across split windows, not wall-clock", () => {
    // 06:00-08:00 (2h) + 12:00-18:00 (6h) = 8h total; midpoint = 4h elapsed = 14:00.
    const splitWindows = getFocusWindows({ focusWindows: [{ start: "06:00", end: "08:00" }, { start: "12:00", end: "18:00" }] });
    expect(shouldShowMiddayCheck(dt(13, 59), splitWindows, baseConfig, TODAY)).toBe(false);
    expect(shouldShowMiddayCheck(dt(14, 0), splitWindows, baseConfig, TODAY)).toBe(true);
  });

  it("respects the midday snooze and the once-per-day done flag", () => {
    expect(shouldShowMiddayCheck(dt(14), windows, { ...baseConfig, dailyMiddayCheckDate: TODAY }, TODAY)).toBe(false);
    expect(shouldShowMiddayCheck(dt(14), windows, { ...baseConfig, dailyMiddayCheckSnoozeUntil: dt(15).getTime() }, TODAY)).toBe(false);
  });

  it("10. never appears when dailyCheckinsEnabled is false, regardless of other conditions", () => {
    expect(shouldShowMiddayCheck(dt(14), windows, { ...baseConfig, dailyCheckinsEnabled: false }, TODAY)).toBe(false);
  });

  it("11. still appears when dailyCheckinsEnabled is undefined or true (default-on)", () => {
    expect(shouldShowMiddayCheck(dt(14), windows, { ...baseConfig, dailyCheckinsEnabled: true }, TODAY)).toBe(true);
    expect(shouldShowMiddayCheck(dt(14), windows, baseConfig, TODAY)).toBe(true);
  });
});

describe("buildMiddayProgressSummary", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
  const tasks = [
    { uuid: "t1", title: "A", isCompleted: false, isDeleted: false, horizonLevel: "today" },
    { uuid: "t2", title: "B", isCompleted: true, isDeleted: false, horizonLevel: "today" },
    { uuid: "t3", title: "C", isCompleted: false, isDeleted: true, horizonLevel: "today" }, // deleted since morning
    { uuid: "t4", title: "D", isCompleted: false, isDeleted: false, horizonLevel: "week" }, // moved off Today since morning
  ];

  it("13. ignores missing/deleted/moved committed task IDs safely", () => {
    expect(getValidCommittedTaskIds(tasks, ["t1", "t2", "t3", "t4", "missing-id"])).toEqual(["t1", "t2"]);
    expect(getValidCommittedTaskIds(tasks, undefined)).toEqual([]);
    expect(() => getValidCommittedTaskIds(tasks, ["missing-id"])).not.toThrow();
  });

  it("counts done/remaining among valid committed tasks only", () => {
    const config = { dailyCommitmentTaskIds: ["t1", "t2", "t3", "missing-id"] };
    const summary = buildMiddayProgressSummary(tasks, config, dt(14), windows);
    expect(summary.total).toBe(2);
    expect(summary.doneCount).toBe(1);
    expect(summary.remainingCount).toBe(1);
    expect(summary.countLine).toBe("You picked 2. 1 is done. 1 remains.");
    expect(summary.showNarrowSuggestion).toBe(false);
  });

  it("suggests narrowing when nothing committed is done yet", () => {
    const config = { dailyCommitmentTaskIds: ["t1"] };
    const summary = buildMiddayProgressSummary(tasks, config, dt(14), windows);
    expect(summary.doneCount).toBe(0);
    expect(summary.showNarrowSuggestion).toBe(true);
    expect(summary.line).toMatch(/one target/i);
  });

  it("handles all-committed-tasks-gone gracefully", () => {
    const config = { dailyCommitmentTaskIds: ["missing-id"] };
    const summary = buildMiddayProgressSummary(tasks, config, dt(14), windows);
    expect(summary.total).toBe(0);
    expect(summary.countLine).toBe(null);
    expect(() => summary.line).not.toThrow();
  });
});

describe("Midday config builders", () => {
  it("done marks today and clears snooze; narrow records taskId without touching tasks", () => {
    const done = buildMiddayCheckDone({ dailyMiddayCheckSnoozeUntil: 5 }, TODAY, 1000);
    expect(done.dailyMiddayCheckDate).toBe(TODAY);
    expect(done.dailyMiddayCheckSnoozeUntil).toBe(null);

    const narrowed = buildNarrowToOne({}, "t1", 1000);
    expect(narrowed.dailyCommitmentNarrowedTaskId).toBe("t1");
    expect(narrowed.dailyCommitmentNarrowedAt).toBe(1000);
  });
});

describe("End-of-Day Reflection eligibility", () => {
  it("10. appears within the last 30 minutes of the final focus window", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
    expect(shouldShowReflection(dt(16, 29), windows, {}, TODAY)).toBe(false);
    expect(shouldShowReflection(dt(16, 30), windows, {}, TODAY)).toBe(true);
  });

  it("11. appears on first open after the final focus window has closed", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
    expect(shouldShowReflection(dt(20, 0), windows, {}, TODAY)).toBe(true);
  });

  it("does not reappear once today's reflection is already done", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
    expect(shouldShowReflection(dt(20, 0), windows, { dailyReflectionDate: TODAY }, TODAY)).toBe(false);
  });

  it("12. an overnight focus window's tail uses the correct (previous) Loci day", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "20:00", end: "02:00" }] });
    const earlyMorning = new Date(2024, 5, 16, 1, 45); // 1:45am the next calendar day
    const lociDay = getLociDayStr(earlyMorning, windows);
    expect(lociDay).toBe(TODAY);
    expect(shouldShowReflection(earlyMorning, windows, {}, lociDay)).toBe(true);
    // Earlier in the same overnight tail, still before the last-30-min mark:
    expect(shouldShowReflection(new Date(2024, 5, 16, 1, 0), windows, {}, lociDay)).toBe(false);
  });

  it("13. never appears when dailyCheckinsEnabled is false, regardless of other conditions", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
    expect(shouldShowReflection(dt(20, 0), windows, { dailyCheckinsEnabled: false }, TODAY)).toBe(false);
  });

  it("14. still appears when dailyCheckinsEnabled is undefined or true (default-on)", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
    expect(shouldShowReflection(dt(20, 0), windows, { dailyCheckinsEnabled: true }, TODAY)).toBe(true);
    expect(shouldShowReflection(dt(20, 0), windows, {}, TODAY)).toBe(true);
  });
});

describe("buildEndOfDaySummary", () => {
  const tasks = [
    { uuid: "t1", title: "A", isCompleted: true, isDeleted: false, dateCompletedString: TODAY, horizonLevel: "today" },
    { uuid: "t2", title: "B", isCompleted: true, isDeleted: false, dateCompletedString: TODAY, horizonLevel: "today" },
    { uuid: "t3", title: "C", isCompleted: false, isDeleted: false, horizonLevel: "today" },
  ];

  it("all committed tasks done: kept-promise verdict", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1", "t2"] };
    const summary = buildEndOfDaySummary(tasks, config, TODAY);
    expect(summary.committedTotal).toBe(2);
    expect(summary.committedDone).toBe(2);
    expect(summary.verdict).toBe("You kept your promise today.");
  });

  it("some committed tasks done: partial-progress verdict", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1", "t3"] };
    const summary = buildEndOfDaySummary(tasks, config, TODAY);
    expect(summary.committedDone).toBe(1);
    expect(summary.verdict).toBe("Partial progress still counts. The day moved.");
  });

  it("none committed/done and nothing else completed: no-verdict reset message", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t3"] };
    const summary = buildEndOfDaySummary([{ uuid: "t3", title: "C", isCompleted: false, isDeleted: false, horizonLevel: "today" }], config, TODAY);
    expect(summary.committedDone).toBe(0);
    expect(summary.totalCompletedToday).toBe(0);
    expect(summary.verdict).toBe("No verdict. Reset the next move.");
  });

  it("includes total Today tasks completed regardless of commitment", () => {
    const summary = buildEndOfDaySummary(tasks, {}, TODAY);
    expect(summary.totalCompletedToday).toBe(2);
    expect(summary.committedTotal).toBe(0);
  });

  it("reports key-deadline move status only when a deadline is configured", () => {
    const noDeadline = buildEndOfDaySummary(tasks, {}, TODAY);
    expect(noDeadline.hasKeyDeadline).toBe(false);
    expect(noDeadline.deadlineMoveDone).toBe(null);

    const withDeadline = buildEndOfDaySummary(tasks, { deadlineAction: "Send the report", deadlineDailyDoneDate: TODAY }, TODAY);
    expect(withDeadline.hasKeyDeadline).toBe(true);
    expect(withDeadline.deadlineMoveDone).toBe(true);
  });
});

describe("buildReflectionSave", () => {
  it("records mood, trims/caps the optional note, and stamps the date", () => {
    const next = buildReflectionSave({}, { mood: "rough", note: "  one sentence for tomorrow  " }, TODAY, 1000);
    expect(next.dailyReflectionDate).toBe(TODAY);
    expect(next.dailyReflectionMood).toBe("rough");
    expect(next.dailyReflectionNote).toBe("one sentence for tomorrow");
    expect(next.dailyReflectionCompletedAt).toBe(1000);
  });

  it("defaults note to an empty string when omitted", () => {
    const next = buildReflectionSave({}, { mood: "better" }, TODAY, 1000);
    expect(next.dailyReflectionNote).toBe("");
  });
});

describe("AI wording fallback (no AI calls made by this module)", () => {
  it("14. with no AI line provided (e.g. no AI key configured), local copy is used", () => {
    expect(getLocalCheckinLine("middayGood").length).toBeGreaterThan(0);
    expect(pickCheckinLine("middayGood", undefined)).toBe(getLocalCheckinLine("middayGood"));
  });

  it("15. an AI failure (null/empty/markdown/too-long output) falls back without throwing", () => {
    expect(() => pickCheckinLine("reflectionPartial", null)).not.toThrow();
    expect(pickCheckinLine("reflectionPartial", null)).toBe(getLocalCheckinLine("reflectionPartial"));
    expect(pickCheckinLine("reflectionPartial", "")).toBe(getLocalCheckinLine("reflectionPartial"));
    expect(pickCheckinLine("reflectionPartial", "x".repeat(200))).toBe(getLocalCheckinLine("reflectionPartial"));
    expect(pickCheckinLine("reflectionPartial", "**bold** markdown")).toBe(getLocalCheckinLine("reflectionPartial"));
  });

  it("a short, clean AI line passes through unchanged", () => {
    expect(pickCheckinLine("middayGood", "One small step keeps the streak alive.")).toBe("One small step keeps the streak alive.");
  });
});
