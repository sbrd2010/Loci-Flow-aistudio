import { describe, expect, it } from "vitest";
import { buildLociCoreInstruction, buildLociCheckinContext, buildLociTaskContext, buildLociFocusSessionContext, buildLociNowFocusContext, buildLociDeadlineContext, buildLociDayMapContext, buildLociBrainDumpContext, buildLociVelocityContext, buildLociRemindersContext, buildLociLowEnergyContext, buildLociRecentlyParkedContext, buildLociCategoryFilterContext, getLocalDateString, isActiveLociTask } from "./lociAIContext";
import { getFocusWindows } from "./focusWindows";

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

  it("tags each task line with its category when present, so the coach can filter by category", () => {
    const context = buildLociTaskContext([
      { title: "Update CV", horizonLevel: "today", priority: "P1", category: "Career" },
      { title: "No category task", horizonLevel: "today", priority: "P3" },
    ]);

    expect(context).toContain("Update CV {Career}");
    // Missing category defaults to Personal — matches the rest of the app's
    // default — so "personal priorities" questions still find this task.
    expect(context).toContain("No category task {Personal}");
  });

  it("counts completedToday using the Loci day (not calendar day) during an overnight focus window", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "22:00", end: "04:00" }] });
    // 2026-06-12 at 1:00 AM is still inside the 22:00-04:00 window that started
    // the previous calendar day, so the Loci day is 2026-06-11.
    const date = new Date(2026, 5, 12, 1, 0);
    const context = buildLociTaskContext([
      { title: "Plan trip", horizonLevel: "week", priority: "P2", isCompleted: true, dateCompletedString: "2026-06-11" },
      { title: "Other task", horizonLevel: "today", priority: "P3" },
    ], date, windows);

    expect(context).toContain("COMPLETED TODAY: 1 task");
  });

  it("keeps the central coach instruction execution-focused and data-safe", () => {
    const instruction = buildLociCoreInstruction({ firstName: "Rohan" });

    expect(instruction).toContain("execution coach");
    expect(instruction).toContain("move from planning to action");
    expect(instruction).toContain("Do not delete, overwrite, or replace user data without clear confirmation");
    expect(instruction).toContain("Today, Week, Month, Quarter, 6 Months, Work");
    expect(instruction).toContain("Never use the word \"ADHD\" in user-facing responses");
    expect(instruction).toContain("Trust the \"Current Time\"");
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

    // Built from fragments so this assertion doesn't itself read as a hit
    // when scanning the codebase for diagnostic/medical terms.
    const forbiddenTerms = ["AD" + "HD", "diag" + "nosis", "dis" + "order", "medi" + "cal"];
    forbiddenTerms.forEach(term => {
      expect(context.toLowerCase()).not.toContain(term.toLowerCase());
    });
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

describe("buildLociFocusSessionContext", () => {
  it("returns an empty string when no focus session is active", () => {
    expect(buildLociFocusSessionContext({})).toBe("");
    expect(buildLociFocusSessionContext({ focusSessionActive: true, activeTask: null })).toBe("");
    expect(buildLociFocusSessionContext({ focusSessionActive: false, activeTask: { title: "Write report" } })).toBe("");
  });

  it("describes a running focus session with elapsed and remaining minutes", () => {
    const context = buildLociFocusSessionContext({
      activeTask: { title: "Write report" },
      focusSessionActive: true,
      isTimerRunning: true,
      timerMaxSeconds: 1500, // 25 min
      timerSecondsLeft: 900, // 15 min left -> 10 min elapsed
    });

    expect(context).toContain("LIVE FOCUS SESSION (running)");
    expect(context).toContain('Working on "Write report"');
    expect(context).toContain("10 min elapsed, 15 min remaining");
    expect(context).toContain("already started this task");
  });

  it("describes a paused focus session", () => {
    const context = buildLociFocusSessionContext({
      activeTask: { title: "Write report" },
      focusSessionActive: true,
      isTimerRunning: false,
      timerMaxSeconds: 1500,
      timerSecondsLeft: 1500,
    });

    expect(context).toContain("LIVE FOCUS SESSION (paused)");
    expect(context).toContain("0 min elapsed, 25 min remaining");
  });
});

describe("buildLociNowFocusContext", () => {
  it("returns an empty string when there is no Now Focus task", () => {
    expect(buildLociNowFocusContext([])).toBe("");
    expect(buildLociNowFocusContext([{ title: "Other task", isNowFocus: false }])).toBe("");
  });

  it("returns an empty string when the Now Focus task has no subtasks", () => {
    expect(buildLociNowFocusContext([{ title: "Write report", isNowFocus: true }])).toBe("");
    expect(buildLociNowFocusContext([{ title: "Write report", isNowFocus: true, subSteps: [] }])).toBe("");
  });

  it("ignores a Now Focus flag on an inactive (completed/parked) task", () => {
    const context = buildLociNowFocusContext([
      { title: "Done task", isNowFocus: true, isCompleted: true, subSteps: [{ id: "1", text: "Step", done: false }] },
      { title: "Parked task", isNowFocus: true, isParked: true, subSteps: [{ id: "1", text: "Step", done: false }] },
    ]);
    expect(context).toBe("");
  });

  it("lists subtask completion state with a done/total count", () => {
    const context = buildLociNowFocusContext([
      {
        title: "Write report", isNowFocus: true,
        subSteps: [
          { id: "1", text: "Open the doc", done: true },
          { id: "2", text: "Write the intro", done: false },
        ]
      }
    ]);

    expect(context).toContain('NOW FOCUS SUBTASKS for "Write report" (1/2 done):');
    expect(context).toContain("[x] Open the doc");
    expect(context).toContain("[ ] Write the intro");
  });
});

describe("buildLociRemindersContext", () => {
  const TODAY = new Date(2026, 5, 12, 10, 0); // 2026-06-12 10:00am

  it("returns an empty string when nothing is due today", () => {
    expect(buildLociRemindersContext([], TODAY)).toBe("");
    expect(buildLociRemindersContext([
      { title: "Tomorrow's reminder", reminderAt: new Date(2026, 5, 13, 9, 0).getTime() }
    ], TODAY)).toBe("");
  });

  it("excludes reminders on inactive tasks", () => {
    const reminderAt = new Date(2026, 5, 12, 14, 0).getTime();
    expect(buildLociRemindersContext([
      { title: "Done task", isCompleted: true, reminderAt },
      { title: "Deleted task", isDeleted: true, reminderAt },
      { title: "Parked task", isParked: true, reminderAt },
    ], TODAY)).toBe("");
  });

  it("lists today's reminders sorted by time, flagging overdue ones", () => {
    const context = buildLociRemindersContext([
      { title: "Afternoon call", reminderAt: new Date(2026, 5, 12, 14, 0).getTime() },
      { title: "Morning meds", reminderAt: new Date(2026, 5, 12, 9, 0).getTime() },
    ], TODAY);

    expect(context).toContain("REMINDERS DUE TODAY:");
    const lines = context.split("\n");
    expect(lines[1]).toContain("09:00");
    expect(lines[1]).toContain("Morning meds");
    expect(lines[1]).toContain("(overdue)");
    expect(lines[2]).toContain("14:00");
    expect(lines[2]).toContain("Afternoon call");
    expect(lines[2]).not.toContain("(overdue)");
  });

  it("includes still-incomplete overdue reminders from prior days, flagged as overdue", () => {
    const context = buildLociRemindersContext([
      { title: "Missed yesterday", reminderAt: new Date(2026, 5, 11, 9, 0).getTime() },
    ], TODAY);

    expect(context).toContain("REMINDERS DUE TODAY:");
    expect(context).toContain("Missed yesterday");
    expect(context).toContain("(overdue)");
  });

  it("excludes a completed task's overdue reminder from a prior day", () => {
    expect(buildLociRemindersContext([
      { title: "Done yesterday", isCompleted: true, reminderAt: new Date(2026, 5, 11, 9, 0).getTime() },
    ], TODAY)).toBe("");
  });
});

describe("buildLociLowEnergyContext", () => {
  it("returns an empty string when Low Energy Mode is off", () => {
    expect(buildLociLowEnergyContext({})).toBe("");
    expect(buildLociLowEnergyContext({ isLowEnergyMode: false })).toBe("");
  });

  it("flags Low Energy Mode when on", () => {
    expect(buildLociLowEnergyContext({ isLowEnergyMode: true })).toContain("LOW ENERGY MODE: ON");
  });
});

describe("buildLociCategoryFilterContext", () => {
  it("returns an empty string when no category was requested", () => {
    expect(buildLociCategoryFilterContext([{ title: "Task", category: "Personal" }], null)).toBe("");
  });

  it("returns an empty string when a visible active task matches the requested category", () => {
    const tasks = [
      { title: "Fix resume", category: "Career" },
      { title: "Buy groceries", category: "Personal" },
    ];
    expect(buildLociCategoryFilterContext(tasks, "Career")).toBe("");
  });

  it("flags a category mismatch when no visible active task carries that category", () => {
    const tasks = [{ title: "Buy groceries", category: "Personal" }];
    const context = buildLociCategoryFilterContext(tasks, "Work");
    expect(context).toContain("CATEGORY NOTE");
    expect(context).toContain("{Work}");
  });

  it("treats an untagged task as Personal, matching buildLociTaskContext's own default", () => {
    const tasks = [{ title: "Untagged task" }];
    expect(buildLociCategoryFilterContext(tasks, "Personal")).toBe("");
    expect(buildLociCategoryFilterContext(tasks, "Work")).toContain("CATEGORY NOTE");
  });

  it("ignores deleted, completed, and parked tasks when checking for a category match", () => {
    const tasks = [
      { title: "Old work task", category: "Work", isDeleted: true },
      { title: "Done work task", category: "Work", isCompleted: true },
      { title: "Parked work task", category: "Work", isParked: true },
    ];
    expect(buildLociCategoryFilterContext(tasks, "Work")).toContain("CATEGORY NOTE");
  });
});

describe("buildLociRecentlyParkedContext", () => {
  const NOW = new Date(2026, 5, 12, 12, 0); // 2026-06-12 noon

  it("returns an empty string when nothing was parked recently", () => {
    expect(buildLociRecentlyParkedContext([], NOW)).toBe("");
    expect(buildLociRecentlyParkedContext([
      { title: "Old park", isParked: true, lastUpdated: NOW.getTime() - 25 * 60 * 60 * 1000 }
    ], NOW)).toBe("");
  });

  it("excludes deleted/completed tasks even if recently updated and parked", () => {
    expect(buildLociRecentlyParkedContext([
      { title: "Deleted", isParked: true, isDeleted: true, lastUpdated: NOW.getTime() },
      { title: "Completed", isParked: true, isCompleted: true, lastUpdated: NOW.getTime() },
    ], NOW)).toBe("");
  });

  it("lists tasks parked within the last 24 hours", () => {
    const context = buildLociRecentlyParkedContext([
      { title: "Bad day task", isParked: true, lastUpdated: NOW.getTime() - 60 * 60 * 1000 },
      { title: "Active task", isParked: false, lastUpdated: NOW.getTime() },
    ], NOW);

    expect(context).toContain("RECENTLY PARKED (last 24h):");
    expect(context).toContain("'Bad day task'");
    expect(context).not.toContain("Active task");
  });
});

describe("buildLociDeadlineContext", () => {
  it("returns an empty string when no deadline is configured", () => {
    expect(buildLociDeadlineContext({})).toBe("");
  });

  it("reports days remaining, today's move status, and a missed-move streak", () => {
    const config = {
      deadlineLabel: "Visa deadline",
      deadlineAction: "Send one email",
      deadlineDate: "2026-06-20",
      deadlineMoveHistory: {
        "2026-06-09": "missed",
        "2026-06-10": "done",
        "2026-06-11": "done",
      },
    };
    const context = buildLociDeadlineContext(config, new Date(2026, 5, 12, 9));

    expect(context).toContain('KEY DEADLINE: "Visa deadline"');
    expect(context).toContain("8 days remaining");
    expect(context).toContain('Today\'s move ("Send one email"): not done yet');
    expect(context).toContain("1 missed move in the last 7 days");
    expect(context).toContain("Current streak: 2 days done in a row");
  });

  it("reports 'due today' and a done move", () => {
    const config = {
      deadlineLabel: "Visa deadline",
      deadlineDate: "2026-06-12",
      deadlineDailyDoneDate: "2026-06-12",
    };
    const context = buildLociDeadlineContext(config, new Date(2026, 5, 12, 9));

    expect(context).toContain("Due today");
    expect(context).toContain('Today\'s move ("one real move"): done');
  });

  it("reports a passed deadline date", () => {
    const config = { deadlineLabel: "Visa deadline", deadlineDate: "2026-06-01" };
    const context = buildLociDeadlineContext(config, new Date(2026, 5, 12, 9));

    expect(context).toContain("Deadline date has passed");
  });

  it("never leaks key-like config", () => {
    const config = { groqKey: "secret-groq", deadlineLabel: "Visa deadline", deadlineAction: "Send one email" };
    const context = buildLociDeadlineContext(config, new Date(2026, 5, 12, 9));

    expect(context).not.toContain("secret-groq");
  });
});

describe("buildLociDayMapContext", () => {
  const TODAY = "2026-06-12";

  it("returns an empty string when nothing is scheduled today", () => {
    expect(buildLociDayMapContext([], TODAY)).toBe("");
    expect(buildLociDayMapContext([
      { title: "Unscheduled", horizonLevel: "today" },
      { title: "Scheduled yesterday", dayMapDate: "2026-06-11", dayMapOrder: 0, dayMapStartMinutes: 480 },
    ], TODAY)).toBe("");
  });

  it("lists scheduled tasks in route order with start times", () => {
    const context = buildLociDayMapContext([
      { title: "Write report", horizonLevel: "today", dayMapDate: TODAY, dayMapOrder: 1, dayMapStartMinutes: 540 },
      { title: "Reply to messages", horizonLevel: "today", dayMapDate: TODAY, dayMapOrder: 0, dayMapStartMinutes: 480 },
    ], TODAY);

    expect(context).toContain("TODAY'S DAY MAP (planned route, in order):");
    const lines = context.split("\n");
    expect(lines[1]).toContain("08:00");
    expect(lines[1]).toContain("Reply to messages");
    expect(lines[2]).toContain("09:00");
    expect(lines[2]).toContain("Write report");
  });

  it("marks completed tasks and excludes deleted/parked tasks", () => {
    const context = buildLociDayMapContext([
      { title: "Done already", horizonLevel: "today", dayMapDate: TODAY, dayMapOrder: 0, dayMapStartMinutes: 480, isCompleted: true },
      { title: "Removed task", horizonLevel: "today", dayMapDate: TODAY, dayMapOrder: 1, dayMapStartMinutes: 540, isDeleted: true },
      { title: "Parked task", horizonLevel: "today", dayMapDate: TODAY, dayMapOrder: 2, dayMapStartMinutes: 600, isParked: true },
    ], TODAY);

    expect(context).toContain("[DONE] Done already");
    expect(context).not.toContain("Removed task");
    expect(context).not.toContain("Parked task");
  });

  it("excludes tasks moved off the Today horizon even if Day Map fields are stale", () => {
    const context = buildLociDayMapContext([
      { title: "Moved to Week", horizonLevel: "week", dayMapDate: TODAY, dayMapOrder: 0, dayMapStartMinutes: 480 },
    ], TODAY);

    expect(context).toBe("");
  });
});

describe("buildLociBrainDumpContext", () => {
  it("returns an empty string when the brain dump is empty", () => {
    expect(buildLociBrainDumpContext([])).toBe("");
    expect(buildLociBrainDumpContext()).toBe("");
  });

  it("reports the unprocessed item count with correct pluralization", () => {
    expect(buildLociBrainDumpContext([{ id: "1", text: "idea" }])).toContain("1 unprocessed thought waiting");
    expect(buildLociBrainDumpContext([{ id: "1" }, { id: "2" }])).toContain("2 unprocessed thoughts waiting");
  });

  it("includes the text of the first items", () => {
    const context = buildLociBrainDumpContext([
      { id: "1", text: "Buy groceries" },
      { id: "2", text: "Finish slides" },
    ]);
    expect(context).toContain("Buy groceries");
    expect(context).toContain("Finish slides");
  });

  it("caps the number of item texts shown and indicates overflow", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: String(i), text: `Item ${i + 1}` }));
    const context = buildLociBrainDumpContext(items);
    expect(context).toContain("Item 1");
    expect(context).toContain("Item 3");
    expect(context).not.toContain("Item 4");
    expect(context).not.toContain("Item 5");
    expect(context).not.toContain("Item 6");
    expect(context).not.toContain("Item 7");
    expect(context).toContain("+4 more");
  });

  it("truncates long item text", () => {
    const longText = "a".repeat(150);
    const context = buildLociBrainDumpContext([{ id: "1", text: longText }]);
    expect(context).toContain(`${"a".repeat(100)}...`);
    expect(context).not.toContain("a".repeat(101));
  });

  it("collapses newlines and extra whitespace in item text", () => {
    const context = buildLociBrainDumpContext([{ id: "1", text: "line1\nline2   line3" }]);
    expect(context).toContain("line1 line2 line3");
    expect(context).not.toMatch(/line1\nline2/);
  });
});

describe("buildLociVelocityContext", () => {
  const TODAY = new Date(2026, 5, 12, 9); // 2026-06-12

  it("returns an empty string when there is no contribution history", () => {
    expect(buildLociVelocityContext([], TODAY)).toBe("");
  });

  it("sums completions over the last 3 and 7 days, including today", () => {
    const contributions = [
      { dateString: "2026-06-12", count: 2 }, // today
      { dateString: "2026-06-11", count: 1 },
      { dateString: "2026-06-10", count: 3 },
      { dateString: "2026-06-09", count: 1 }, // outside last-3 window
      { dateString: "2026-06-05", count: 4 }, // outside last-7 window
    ];
    const context = buildLociVelocityContext(contributions, TODAY);

    expect(context).toContain("COMPLETION VELOCITY:");
    expect(context).toContain("Last 3 days: 6 tasks completed");
    expect(context).toContain("Last 7 days: 7 tasks completed");
  });

  it("reports a stall as zero completions rather than hiding it", () => {
    const contributions = [{ dateString: "2026-05-01", count: 5 }];
    const context = buildLociVelocityContext(contributions, TODAY);

    expect(context).toContain("Last 3 days: 0 tasks completed");
    expect(context).toContain("Last 7 days: 0 tasks completed");
  });
});
