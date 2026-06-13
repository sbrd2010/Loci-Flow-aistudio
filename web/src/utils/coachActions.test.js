import { describe, it, expect } from "vitest";
import { parseCoachActionTags, findTaskByTitle, buildSetNowFocusTasks, buildParkTaskTasks, applyCoachActions } from "./coachActions";

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
    const { payload: next, results } = applyCoachActions(payload, [{ type: "SET_NOW_FOCUS", title: "Email client" }], dateOpts);
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
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], dateOpts);
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
    const { payload: next } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], dateOpts);
    expect(next.contributions).toEqual([expect.objectContaining({ dateString: "2026-06-13", count: 3 })]);
  });

  it("returns matched: false and leaves the payload untouched when no task matches", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Walk the dog" }], dateOpts);
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
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Call the dentist" }], dateOpts);
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
    const { payload: next, results } = applyCoachActions(payload, [{ type: "PARK_TASK", title: "Write report" }], dateOpts);
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
    const { payload: next, results } = applyCoachActions(payload, [{ type: "START_FOCUS", title: "Write report" }], dateOpts);
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
    ], dateOpts);
    expect(next.tasks.find(t => t.uuid === "1").isCompleted).toBe(true);
    expect(next.tasks.find(t => t.uuid === "2").isNowFocus).toBe(true);
  });
});
