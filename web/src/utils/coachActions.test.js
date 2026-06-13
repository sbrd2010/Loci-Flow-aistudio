import { describe, it, expect } from "vitest";
import { parseCoachActionTags, findTaskByTitle, buildSetNowFocusTasks, applyCoachActions } from "./coachActions";

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
