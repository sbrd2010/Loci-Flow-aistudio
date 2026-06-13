import { describe, it, expect } from "vitest";
import { parseCoachActionTags, findTaskByTitle, buildSetNowFocusTasks, buildParkTaskTasks, applyCoachActions, matchesUserIntent } from "./coachActions";
import { parseCheckinTag } from "./coachCheckin";
import { getFocusWindows, getLociDayStr } from "./focusWindows";
import { getLocalDateString } from "./lociAIContext";

describe("parseCoachActionTags", () => {
  it("returns no actions and the original text when no tag is present", () => {
    expect(parseCoachActionTags("Start with the report.")).toEqual({ cleanText: "Start with the report.", actions: [] });
  });

  it("extracts a SET_NOW_FOCUS tag and strips it from the end", () => {
    expect(parseCoachActionTags("Switching your focus now.\n[[SET_NOW_FOCUS:Write report]]")).toEqual({
      cleanText: "Switching your focus now.",
      actions: [{ type: "SET_NOW_FOCUS", title: "Write report" }],
    });
  });

  it("extracts a COMPLETE_TASK tag and strips it from the end", () => {
    expect(parseCoachActionTags("Nice work!\n[[COMPLETE_TASK:Email client]]")).toEqual({
      cleanText: "Nice work!",
      actions: [{ type: "COMPLETE_TASK", title: "Email client" }],
    });
  });

  it("is case-insensitive on the tag name", () => {
    expect(parseCoachActionTags("Done.\n[[complete_task:Email client]]")).toEqual({
      cleanText: "Done.",
      actions: [{ type: "COMPLETE_TASK", title: "Email client" }],
    });
  });

  it("strips a tag in the middle of the text", () => {
    expect(parseCoachActionTags("Before. [[SET_NOW_FOCUS:Write report]] After.")).toEqual({
      cleanText: "Before. After.",
      actions: [{ type: "SET_NOW_FOCUS", title: "Write report" }],
    });
  });

  it("extracts multiple tags in order", () => {
    expect(parseCoachActionTags("Marking it done and switching focus.\n[[COMPLETE_TASK:Email client]]\n[[SET_NOW_FOCUS:Write report]]")).toEqual({
      cleanText: "Marking it done and switching focus.",
      actions: [
        { type: "COMPLETE_TASK", title: "Email client" },
        { type: "SET_NOW_FOCUS", title: "Write report" },
      ],
    });
  });

  it("extracts an ADD_TASK tag", () => {
    expect(parseCoachActionTags("Added it!\n[[ADD_TASK:Call the dentist]]")).toEqual({
      cleanText: "Added it!",
      actions: [{ type: "ADD_TASK", title: "Call the dentist" }],
    });
  });

  it("extracts a PARK_TASK tag", () => {
    expect(parseCoachActionTags("Parked it.\n[[PARK_TASK:Write report]]")).toEqual({
      cleanText: "Parked it.",
      actions: [{ type: "PARK_TASK", title: "Write report" }],
    });
  });

  it("extracts a START_FOCUS tag", () => {
    expect(parseCoachActionTags("Starting now!\n[[START_FOCUS:Write report]]")).toEqual({
      cleanText: "Starting now!",
      actions: [{ type: "START_FOCUS", title: "Write report" }],
    });
  });

  it("allows a single bracket character within a tag title", () => {
    expect(parseCoachActionTags("Added it!\n[[ADD_TASK:Review [Q2] metrics]]")).toEqual({
      cleanText: "Added it!",
      actions: [{ type: "ADD_TASK", title: "Review [Q2] metrics" }],
    });
  });
});

describe("tag-stripping integration", () => {
  it("strips both a CHECKIN_IN tag and a coach action tag from the reply", () => {
    const reply = "Nice work! I'll check on you soon.\n[[CHECKIN_IN:15]]\n[[COMPLETE_TASK:Write report]]";
    const { cleanText: afterCheckin, minutes } = parseCheckinTag(reply);
    const { cleanText, actions } = parseCoachActionTags(afterCheckin);
    expect(minutes).toBe(15);
    expect(cleanText).toBe("Nice work! I'll check on you soon.");
    expect(actions).toEqual([{ type: "COMPLETE_TASK", title: "Write report" }]);
  });
});

describe("findTaskByTitle", () => {
  const tasks = [
    { uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false },
    { uuid: "2", title: "Email the client about invoice", isCompleted: false, isDeleted: false, isParked: false },
    { uuid: "3", title: "Done already", isCompleted: true, isDeleted: false, isParked: false },
  ];

  it("matches exactly, case- and punctuation-insensitive", () => {
    expect(findTaskByTitle(tasks, "write report")).toBe(tasks[0]);
    expect(findTaskByTitle(tasks, "Write Report!")).toBe(tasks[0]);
  });

  it("matches when the tag title is a substring of the task title", () => {
    expect(findTaskByTitle(tasks, "Email the client")).toBe(tasks[1]);
  });

  it("matches when the task title is a substring of the tag title", () => {
    expect(findTaskByTitle(tasks, "Email the client about invoice ASAP")).toBe(tasks[1]);
  });

  it("returns null when nothing matches", () => {
    expect(findTaskByTitle(tasks, "Walk the dog")).toBeNull();
  });

  it("does not substring-match a tiny pronoun-like title (e.g. 'it')", () => {
    expect(findTaskByTitle(tasks, "it")).toBeNull();
  });

  it("still matches an exact short title even though it's below the fuzzy-match length", () => {
    const short = [{ uuid: "1", title: "Gym", isCompleted: false, isDeleted: false, isParked: false }];
    expect(findTaskByTitle(short, "gym")).toBe(short[0]);
  });

  it("returns null for an empty title", () => {
    expect(findTaskByTitle(tasks, "")).toBeNull();
  });

  it("ignores completed tasks", () => {
    expect(findTaskByTitle(tasks, "Done already")).toBeNull();
  });

  it("returns null when multiple active tasks match equally well", () => {
    const ambiguous = [
      { uuid: "1", title: "Email the client about invoice", isCompleted: false, isDeleted: false, isParked: false },
      { uuid: "2", title: "Email the team about invoice", isCompleted: false, isDeleted: false, isParked: false },
    ];
    expect(findTaskByTitle(ambiguous, "Email")).toBeNull();
  });

  it("returns null when multiple active tasks have the same exact title", () => {
    const duplicates = [
      { uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false },
      { uuid: "2", title: "Write report", isCompleted: false, isDeleted: false, isParked: false },
    ];
    expect(findTaskByTitle(duplicates, "Write report")).toBeNull();
  });

  it("matches non-Latin task titles exactly", () => {
    const tasksCJK = [
      { uuid: "1", title: "書類を提出する", isCompleted: false, isDeleted: false, isParked: false },
    ];
    expect(findTaskByTitle(tasksCJK, "書類を提出する")).toBe(tasksCJK[0]);
  });
});

describe("buildSetNowFocusTasks", () => {
  it("pins the target task and unpins any other", () => {
    const tasks = [
      { uuid: "1", title: "A", isNowFocus: true },
      { uuid: "2", title: "B", isNowFocus: false },
    ];
    const result = buildSetNowFocusTasks(tasks, "2", 1000);
    expect(result[0]).toEqual({ uuid: "1", title: "A", isNowFocus: false, lastUpdated: 1000 });
    expect(result[1]).toEqual({ uuid: "2", title: "B", isNowFocus: true, lastUpdated: 1000 });
  });

  it("leaves tasks whose isNowFocus is already correct untouched", () => {
    const other = { uuid: "1", title: "A", isNowFocus: false };
    const target = { uuid: "2", title: "B", isNowFocus: true };
    const result = buildSetNowFocusTasks([other, target], "2", 1000);
    expect(result[0]).toBe(other);
    expect(result[1]).toBe(target);
  });
});

describe("buildParkTaskTasks", () => {
  it("parks the target task and unpins it, leaving others untouched", () => {
    const target = { uuid: "1", title: "A", isParked: false, isNowFocus: true };
    const other = { uuid: "2", title: "B", isParked: false, isNowFocus: false };
    const result = buildParkTaskTasks([target, other], "1", 1000);
    expect(result[0]).toEqual({ uuid: "1", title: "A", isParked: true, isNowFocus: false, lastUpdated: 1000 });
    expect(result[1]).toBe(other);
  });
});

describe("matchesUserIntent", () => {
  it("matches COMPLETE_TASK on completion language", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "I just finished the report")).toBe(true);
    expect(matchesUserIntent("COMPLETE_TASK", "Tell me about the report")).toBe(false);
  });

  it("matches SET_NOW_FOCUS on focus/prioritize language", () => {
    expect(matchesUserIntent("SET_NOW_FOCUS", "Focus on the report now")).toBe(true);
    expect(matchesUserIntent("SET_NOW_FOCUS", "What should I do next?")).toBe(false);
  });

  it("matches START_FOCUS on start+session language", () => {
    expect(matchesUserIntent("START_FOCUS", "Let's start a focus session")).toBe(true);
    expect(matchesUserIntent("START_FOCUS", "Focus on the report")).toBe(false);
  });

  it("matches ADD_TASK on add/remind/need language", () => {
    expect(matchesUserIntent("ADD_TASK", "Add a task to call the dentist")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "What's on my list?")).toBe(false);
  });

  it("matches ADD_TASK on 'add X to my list' / 'put X on my list' phrasing", () => {
    expect(matchesUserIntent("ADD_TASK", "add Call dentist to my Today list")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "put Call dentist on my list")).toBe(true);
  });

  it("matches PARK_TASK on park/defer language", () => {
    expect(matchesUserIntent("PARK_TASK", "Park the report for now")).toBe(true);
    expect(matchesUserIntent("PARK_TASK", "Tell me about the report")).toBe(false);
  });

  it("returns false for an unknown action type", () => {
    expect(matchesUserIntent("NOT_A_REAL_ACTION", "I just finished the report")).toBe(false);
  });

  it("returns false for an empty or missing message", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK")).toBe(false);
  });

  it("does not match COMPLETE_TASK on negated completion language", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "I'm not done with the report")).toBe(false);
  });

  it("does not match COMPLETE_TASK when negation is several words before the completion word", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "Don't mark Write report complete", "Write report")).toBe(false);
  });

  it("does not match PARK_TASK on negated park language", () => {
    expect(matchesUserIntent("PARK_TASK", "Don't park the report")).toBe(false);
  });

  it("still matches ADD_TASK on 'don't forget' phrasing", () => {
    expect(matchesUserIntent("ADD_TASK", "Don't forget to call mom")).toBe(true);
  });

  it("does not match ADD_TASK on a plain 'I need to' statement with no add/remind request", () => {
    expect(matchesUserIntent("ADD_TASK", "I need to call the dentist at some point")).toBe(false);
  });

  it("does not match COMPLETE_TASK on a generic 'done for today' statement", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "I'm done for today")).toBe(false);
  });

  it("does not match COMPLETE_TASK on a question about past completions", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "What have I done today?")).toBe(false);
  });

  it("requires the tag's title to be mentioned in the message for task-targeted actions", () => {
    expect(matchesUserIntent("SET_NOW_FOCUS", "Focus on the report now", "Write report")).toBe(true);
    expect(matchesUserIntent("SET_NOW_FOCUS", "Focus on the report now", "Email client")).toBe(false);
  });

  it("requires the tag's title to be corroborated for ADD_TASK too", () => {
    expect(matchesUserIntent("ADD_TASK", "Add a task to call the dentist", "Call the dentist")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "Add a task to call the dentist", "Buy groceries")).toBe(false);
  });
});

describe("applyCoachActions", () => {
  const dateOpts = { lociDateStr: "2026-06-13", localDateStr: "2026-06-13" };

  it("SET_NOW_FOCUS pins the matched task", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "SET_NOW_FOCUS", title: "Email client" }], { ...dateOpts, lastUserMessage: "Let's focus on Email client now." });
    expect(next.tasks.find(t => t.uuid === "2").isNowFocus).toBe(true);
    expect(next.tasks.find(t => t.uuid === "1").isNowFocus).toBe(false);
    expect(results).toEqual([{ type: "SET_NOW_FOCUS", title: "Email client", matched: true, task: payload.tasks[1] }]);
  });

  it("COMPLETE_TASK marks the task done, awards XP, and increments today's contribution", () => {
    const payload = {
      userId: "user-1",
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: true, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: { totalXp: 100 },
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], { ...dateOpts, lastUserMessage: "I just finished writing the report." });
    expect(next.tasks[0].isCompleted).toBe(true);
    expect(next.tasks[0].isNowFocus).toBe(false);
    expect(next.tasks[0].dateCompletedString).toBe("2026-06-13");
    expect(next.config.totalXp).toBe(200);
    expect(next.contributions).toEqual([
      expect.objectContaining({ dateString: "2026-06-13", count: 1, userId: "user-1" }),
    ]);
    expect(results[0].matched).toBe(true);
  });

  it("COMPLETE_TASK increments an existing contribution entry for today", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [{ dateString: "2026-06-13", count: 2 }],
    };
    const { payload: next } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], { ...dateOpts, lastUserMessage: "Done with the report!" });
    expect(next.contributions).toEqual([expect.objectContaining({ dateString: "2026-06-13", count: 3 })]);
  });

  it("COMPLETE_TASK with a pronoun-like title ('it') does not complete an unrelated task", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: { totalXp: 100 },
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "it" }], { ...dateOpts, lastUserMessage: "I finished it." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "COMPLETE_TASK", title: "it", matched: false }]);
  });

  it("returns matched: false and leaves the payload untouched when no task matches", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Walk the dog" }], { ...dateOpts, lastUserMessage: "Just finished walking the dog." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "COMPLETE_TASK", title: "Walk the dog", matched: false }]);
  });

  it("ADD_TASK appends a new Today task with sensible defaults", () => {
    const payload = {
      userId: "user-1",
      tasks: [
        { uuid: "1", title: "Existing", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Call the dentist" }], { ...dateOpts, lastUserMessage: "Add a task to call the dentist." });
    expect(next.tasks).toHaveLength(2);
    const added = next.tasks[1];
    expect(added).toMatchObject({
      title: "Call the dentist",
      horizonLevel: "today",
      priority: "P3",
      timeEstimateMinutes: 25,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      orderIndex: 1,
      userId: "user-1",
    });
    expect(added.uuid).toBeTruthy();
    expect(results).toEqual([{ type: "ADD_TASK", title: "Call the dentist", matched: true }]);
  });

  it("PARK_TASK parks the matched task and unpins it", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: true, isParked: false, isCompleted: false, isDeleted: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "PARK_TASK", title: "Write report" }], { ...dateOpts, lastUserMessage: "Let's park the report for now." });
    expect(next.tasks[0].isParked).toBe(true);
    expect(next.tasks[0].isNowFocus).toBe(false);
    expect(results[0].matched).toBe(true);
  });

  it("START_FOCUS pins the matched task as Now Focus", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: true, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "START_FOCUS", title: "Write report" }], { ...dateOpts, lastUserMessage: "Let's start a focus session on the report." });
    expect(next.tasks.find(t => t.uuid === "1").isNowFocus).toBe(true);
    expect(next.tasks.find(t => t.uuid === "2").isNowFocus).toBe(false);
    expect(results[0].matched).toBe(true);
    expect(results[0].task.uuid).toBe("1");
  });

  it("applies multiple actions in order: completing the Now Focus task, then pinning the next one", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: true, isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next } = applyCoachActions(payload, [
      { type: "COMPLETE_TASK", title: "Write report" },
      { type: "SET_NOW_FOCUS", title: "Email client" },
    ], { ...dateOpts, lastUserMessage: "I finished the report, now focus on Email client." });
    expect(next.tasks.find(t => t.uuid === "1").isCompleted).toBe(true);
    expect(next.tasks.find(t => t.uuid === "2").isNowFocus).toBe(true);
  });

  it("blocks an action and leaves the payload untouched when the user's message doesn't request it", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "SET_NOW_FOCUS", title: "Write report" }], { ...dateOpts, lastUserMessage: "How's it going?" });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "SET_NOW_FOCUS", title: "Write report", matched: false, blocked: true }]);
  });

  it("blocks an action whose tag title doesn't match the task the user named", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "SET_NOW_FOCUS", title: "Email client" }], { ...dateOpts, lastUserMessage: "Let's focus on Write report now." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "SET_NOW_FOCUS", title: "Email client", matched: false, blocked: true }]);
  });

  it("blocks ADD_TASK when the tag's title doesn't match the task the user described", () => {
    const payload = { tasks: [], config: {}, contributions: [] };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Buy groceries" }], { ...dateOpts, lastUserMessage: "Add Call dentist to my list." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "Buy groceries", matched: false, blocked: true }]);
  });

  it("COMPLETE_TASK on an already-completed task is a no-op (idempotent)", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isCompleted: true, isDeleted: false, isParked: false, dateCompletedString: "2026-06-12" },
      ],
      config: { totalXp: 100 },
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], { ...dateOpts, lastUserMessage: "I'm done with the report" });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "COMPLETE_TASK", title: "Write report", matched: false }]);
  });

  it("START_FOCUS does not match a completed, deleted, or parked task", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: true, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: false, isCompleted: false, isDeleted: true, isParked: false },
        { uuid: "3", title: "Plan trip", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: true },
      ],
      config: {},
      contributions: [],
    };
    for (const title of ["Write report", "Email client", "Plan trip"]) {
      const { payload: next, results } = applyCoachActions(payload, [{ type: "START_FOCUS", title }], { ...dateOpts, lastUserMessage: `Let's start a focus session on ${title}.` });
      expect(next).toBe(payload);
      expect(results).toEqual([{ type: "START_FOCUS", title, matched: false }]);
    }
  });

  it("uses the Loci day for dateCompletedString and the local calendar day for contributions across midnight", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "22:00", end: "04:00" }] });
    const now = new Date(2026, 5, 14, 1, 0); // June 14, 1:00 AM — still the June 13 Loci day
    const lociDateStr = getLociDayStr(now, windows);
    const localDateStr = getLocalDateString(now);
    expect(lociDateStr).toBe("2026-06-13");
    expect(localDateStr).toBe("2026-06-14");

    const payload = {
      userId: "user-1",
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [],
    };
    const { payload: next } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], { lociDateStr, localDateStr, lastUserMessage: "I'm done with the report" });
    expect(next.tasks[0].dateCompletedString).toBe("2026-06-13");
    expect(next.contributions).toEqual([expect.objectContaining({ dateString: "2026-06-14" })]);
  });

  it("ADD_TASK rejects an empty or whitespace-only title", () => {
    const payload = { tasks: [], config: {}, contributions: [] };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "   " }], { ...dateOpts, lastUserMessage: "Add a task for this." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "   ", matched: false }]);
  });

  it("ADD_TASK truncates an overlong title to 300 characters", () => {
    const longTitle = "x".repeat(400);
    const payload = { tasks: [], config: {}, contributions: [] };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: longTitle }], { ...dateOpts, lastUserMessage: `Add a task for ${longTitle}.` });
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].title).toBe("x".repeat(300));
    expect(results[0].matched).toBe(true);
  });

  it("ADD_TASK is blocked by Evening Guard at or after 8 PM", () => {
    const payload = { tasks: [], config: { eveningGuardWindowActive: true }, contributions: [] };
    const now = new Date(2026, 5, 13, 20, 30).getTime(); // 8:30 PM
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Call the dentist" }], { ...dateOpts, lastUserMessage: "Add a task to call the dentist.", now });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "Call the dentist", matched: false, eveningGuardBlocked: true }]);
  });

  it("ADD_TASK proceeds when Evening Guard is active but it's before 8 PM", () => {
    const payload = { tasks: [], config: { eveningGuardWindowActive: true }, contributions: [] };
    const now = new Date(2026, 5, 13, 19, 30).getTime(); // 7:30 PM
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Call the dentist" }], { ...dateOpts, lastUserMessage: "Add a task to call the dentist.", now });
    expect(next.tasks).toHaveLength(1);
    expect(results[0].matched).toBe(true);
  });

  it("ADD_TASK skips an obvious duplicate of an existing active task", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Call the dentist", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "call the dentist" }], { ...dateOpts, lastUserMessage: "Add a task to call the dentist." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "call the dentist", matched: false }]);
  });
});
