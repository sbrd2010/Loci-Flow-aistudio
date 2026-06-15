import { describe, it, expect } from "vitest";
import { buildToggleCompletedTasks, applyAiRewriteToTask, normalizeAiOrganizeSuggestions, buildClearedBrainDump, sanitizeTaskField, byPriorityThenOrder, CATEGORY_ICONS } from "./taskOps";

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

// ── normalizeAiOrganizeSuggestions ────────────────────────────────────────────

const DUMP_ITEMS = [
  { id: "d1", text: "Buy groceries" },
  { id: "d2", text: "Review PR" },
  { id: "d3", text: "Call dentist" },
];

describe("normalizeAiOrganizeSuggestions", () => {
  it("accepts all valid horizons including office", () => {
    const raw = [
      { sourceId: "d1", title: "Buy groceries", horizonLevel: "today", priority: "P3" },
      { sourceId: "d2", title: "Review PR", horizonLevel: "office", priority: "P2" },
      { sourceId: "d3", title: "Call dentist", horizonLevel: "week", priority: "P3" },
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(3);
    expect(result[1].horizonLevel).toBe("office");
  });

  it("discards suggestions with invalid horizonLevel", () => {
    const raw = [
      { sourceId: "d1", title: "Valid task", horizonLevel: "week", priority: "P2" },
      { sourceId: "d2", title: "Bad horizon", horizonLevel: "someday", priority: "P2" },
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid task");
  });

  it("discards suggestions with invalid priority", () => {
    const raw = [
      { sourceId: "d1", title: "Valid task", horizonLevel: "week", priority: "P2" },
      { sourceId: "d2", title: "Bad priority", horizonLevel: "week", priority: "P5" },
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(1);
  });

  it("sets sourceId to null when AI returns an unrecognised id", () => {
    const raw = [
      { sourceId: "unknown-999", title: "Garbled source", horizonLevel: "week", priority: "P3" },
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBeNull();
  });

  it("trims whitespace from title", () => {
    const raw = [{ sourceId: "d1", title: "  Trimmed  ", horizonLevel: "week", priority: "P2" }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].title).toBe("Trimmed");
  });

  it("missing concreteStep normalizes to an empty string", () => {
    const raw = [{ sourceId: "d1", title: "Buy groceries", horizonLevel: "week", priority: "P3" }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].concreteStep).toBe("");
  });

  it("trims a valid string concreteStep", () => {
    const raw = [{ sourceId: "d1", title: "Buy groceries", horizonLevel: "week", priority: "P3", concreteStep: "  Go to store  " }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].concreteStep).toBe("Go to store");
  });

  it("sanitizes a non-string concreteStep (e.g. AI returns an array of steps) to an empty string", () => {
    const raw = [{ sourceId: "d1", title: "Buy groceries", horizonLevel: "week", priority: "P3", concreteStep: ["Go to store", "Buy milk"] }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(1);
    expect(result[0].concreteStep).toBe("");
  });

  it("caps an oversized title at 1000 chars and concreteStep at 300 chars", () => {
    const raw = [{ sourceId: "d1", title: "T".repeat(1100), horizonLevel: "week", priority: "P3", concreteStep: "S".repeat(400) }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].title).toHaveLength(1000);
    expect(result[0].concreteStep).toHaveLength(300);
  });

  it("sanitizes a malformed concreteStep regardless of which horizon the item is assigned to", () => {
    const raw = [
      { sourceId: "d1", title: "Today task", horizonLevel: "today", priority: "P1", concreteStep: ["bad", "array"] },
      { sourceId: "d2", title: "Month task", horizonLevel: "month", priority: "P3", concreteStep: "Valid step" },
      { sourceId: "d3", title: "Half-year task", horizonLevel: "halfyear", priority: "P2", concreteStep: 123 },
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(3);
    expect(result.find((t) => t.horizonLevel === "today").concreteStep).toBe("");
    expect(result.find((t) => t.horizonLevel === "month").concreteStep).toBe("Valid step");
    expect(result.find((t) => t.horizonLevel === "halfyear").concreteStep).toBe("");
  });

  it("missing subSteps normalizes to an empty array", () => {
    const raw = [{ sourceId: "d1", title: "Buy groceries", horizonLevel: "week", priority: "P3" }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].subSteps).toEqual([]);
  });

  it("normalizes valid subSteps into {id, text, done} with trimmed text", () => {
    const raw = [{
      sourceId: "d1", title: "Plan trip", horizonLevel: "week", priority: "P2",
      subSteps: [{ text: "  Book flights  " }, { text: "Reserve hotel" }],
    }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].subSteps).toHaveLength(2);
    expect(result[0].subSteps[0]).toMatchObject({ text: "Book flights", done: false });
    expect(result[0].subSteps[0].id).toBeTruthy();
    expect(result[0].subSteps[1].text).toBe("Reserve hotel");
  });

  it("drops blank or non-string subStep entries and caps at 7", () => {
    const raw = [{
      sourceId: "d1", title: "Big project", horizonLevel: "week", priority: "P2",
      subSteps: [
        { text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }, { text: "5" }, { text: "6" }, { text: "7" }, { text: "8" },
        { text: "  " }, { text: 123 }, null,
      ],
    }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].subSteps).toHaveLength(7);
    expect(result[0].subSteps.map((s) => s.text)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("caps subStep text at 240 chars", () => {
    const raw = [{
      sourceId: "d1", title: "Big project", horizonLevel: "week", priority: "P2",
      subSteps: [{ text: "S".repeat(300) }],
    }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].subSteps[0].text).toHaveLength(240);
  });

  it("non-array subSteps normalizes to an empty array", () => {
    const raw = [{ sourceId: "d1", title: "Buy groceries", horizonLevel: "week", priority: "P3", subSteps: "not an array" }];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].subSteps).toEqual([]);
  });

  it("allows multiple suggestions to share the same valid sourceId (splitting a long entry)", () => {
    const raw = [
      { sourceId: "d1", title: "Update CV for Netherlands applications", horizonLevel: "week", priority: "P1" },
      { sourceId: "d1", title: "Apply to 3 Netherlands vacancies", horizonLevel: "week", priority: "P1" },
      { sourceId: "d1", title: "Message the recruiter from last month", horizonLevel: "week", priority: "P2" },
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(3);
    expect(result.every((t) => t.sourceId === "d1")).toBe(true);
  });

  it("caps suggestions sharing one sourceId at 8 and records it in droppedSourceIds", () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({
      sourceId: "d1", title: `Task ${i}`, horizonLevel: "week", priority: "P3",
    }));
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(8);
    expect(result.droppedSourceIds.has("d1")).toBe(true);
  });

  it("caps total suggestions at 25 across sources", () => {
    const raw = [];
    for (let i = 0; i < 30; i++) {
      const sourceId = i % 2 === 0 ? "d1" : "d2";
      raw.push({ sourceId, title: `Task ${i}`, horizonLevel: "week", priority: "P3" });
    }
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result.length).toBeLessThanOrEqual(25);
  });

  it("droppedSourceIds includes a source where a sibling suggestion was rejected for invalid horizon/priority", () => {
    const raw = [
      { sourceId: "d1", title: "Update CV", horizonLevel: "week", priority: "P1" },
      { sourceId: "d1", title: "Bad split", horizonLevel: "someday", priority: "P1" }, // rejected: invalid horizon
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(1);
    expect(result.droppedSourceIds.has("d1")).toBe(true);
  });

  it("droppedSourceIds covers every brain-dump item when a valid suggestion's sourceId can't be attributed (AI omitted/garbled a split's sourceId)", () => {
    const raw = [
      { sourceId: "d1", title: "Plan team offsite", horizonLevel: "week", priority: "P2" },
      { sourceId: null, title: "Order catering", horizonLevel: "week", priority: "P2" }, // split lost its sourceId
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(2);
    expect(result.droppedSourceIds).toEqual(new Set(["d1", "d2", "d3"]));
  });

  it("droppedSourceIds is empty when no caps drop any suggestion", () => {
    const raw = [
      { sourceId: "d1", title: "Buy groceries", horizonLevel: "today", priority: "P3" },
      { sourceId: "d2", title: "Review PR", horizonLevel: "office", priority: "P2" },
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result.droppedSourceIds.size).toBe(0);
  });

  it("droppedSourceIds includes a source cut off by the overall 25-suggestion cap, even under its own per-source cap", () => {
    const raw = [];
    // 20 suggestions with an unrecognized sourceId — count toward the overall
    // cap (result.length) but not toward any per-source cap.
    for (let i = 0; i < 20; i++) {
      raw.push({ sourceId: "unknown", title: `Filler ${i}`, horizonLevel: "week", priority: "P3" });
    }
    // 6 suggestions for d1 — under MAX_SUGGESTIONS_PER_SOURCE (8), but only 5
    // fit before the overall cap (25) is hit.
    for (let i = 0; i < 6; i++) {
      raw.push({ sourceId: "d1", title: `D1 task ${i}`, horizonLevel: "week", priority: "P3" });
    }
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result).toHaveLength(25);
    expect(result.filter(t => t.sourceId === "d1")).toHaveLength(5);
    expect(result.droppedSourceIds.has("d1")).toBe(true);
  });

  it("sanitizes splitReason to a trimmed string, defaulting to empty", () => {
    const raw = [
      { sourceId: "d1", title: "With reason", horizonLevel: "week", priority: "P3", splitReason: "  Recruiter follow-up  " },
      { sourceId: "d2", title: "No reason", horizonLevel: "week", priority: "P3" },
      { sourceId: "d3", title: "Bad reason", horizonLevel: "week", priority: "P3", splitReason: ["not", "a", "string"] },
    ];
    const result = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    expect(result[0].splitReason).toBe("Recruiter follow-up");
    expect(result[1].splitReason).toBe("");
    expect(result[2].splitReason).toBe("");
  });
});

// -- sanitizeTaskField -----------------------------------------------------------

describe("sanitizeTaskField", () => {
  it("trims a valid string within the limit", () => {
    expect(sanitizeTaskField("  Open laptop  ", 300)).toBe("Open laptop");
  });

  it("truncates strings longer than maxLength", () => {
    expect(sanitizeTaskField("a".repeat(400), 300)).toHaveLength(300);
  });

  it("returns an empty string for non-string values", () => {
    expect(sanitizeTaskField(["step 1", "step 2"], 300)).toBe("");
    expect(sanitizeTaskField({ text: "step" }, 300)).toBe("");
    expect(sanitizeTaskField(42, 300)).toBe("");
    expect(sanitizeTaskField(null, 300)).toBe("");
    expect(sanitizeTaskField(undefined, 300)).toBe("");
  });
});

// ── buildClearedBrainDump ─────────────────────────────────────────────────────

describe("buildClearedBrainDump", () => {
  it("removes brain dump items whose id matches a sourceId in accepted suggestions", () => {
    const accepted = [
      { sourceId: "d1", title: "Buy groceries", horizonLevel: "today", priority: "P3" },
    ];
    const result = buildClearedBrainDump(DUMP_ITEMS, accepted);
    expect(result).toHaveLength(2);
    expect(result.find(d => d.id === "d1")).toBeUndefined();
  });

  it("never removes items whose id is not referenced by any accepted suggestion", () => {
    const accepted = [
      { sourceId: null, title: "Title match would be wrong", horizonLevel: "week", priority: "P3" },
    ];
    const result = buildClearedBrainDump(DUMP_ITEMS, accepted);
    expect(result).toHaveLength(3);
  });

  it("handles empty accepted suggestions gracefully", () => {
    const result = buildClearedBrainDump(DUMP_ITEMS, []);
    expect(result).toHaveLength(3);
  });

  it("keeps the source brain dump item when only some split suggestions are accepted", () => {
    const allSuggestions = [
      { sourceId: "d1", title: "Update CV", horizonLevel: "week", priority: "P1" },
      { sourceId: "d1", title: "Apply to vacancies", horizonLevel: "week", priority: "P1" },
      { sourceId: "d1", title: "Message recruiter", horizonLevel: "week", priority: "P2" },
    ];
    const accepted = [allSuggestions[0]];
    const result = buildClearedBrainDump(DUMP_ITEMS, accepted, allSuggestions);
    expect(result).toHaveLength(3);
    expect(result.find((d) => d.id === "d1")).toBeDefined();
  });

  it("clears the source brain dump item when all split suggestions are accepted", () => {
    const allSuggestions = [
      { sourceId: "d1", title: "Update CV", horizonLevel: "week", priority: "P1" },
      { sourceId: "d1", title: "Apply to vacancies", horizonLevel: "week", priority: "P1" },
      { sourceId: "d1", title: "Message recruiter", horizonLevel: "week", priority: "P2" },
    ];
    const result = buildClearedBrainDump(DUMP_ITEMS, allSuggestions, allSuggestions);
    expect(result).toHaveLength(2);
    expect(result.find((d) => d.id === "d1")).toBeUndefined();
  });

  it("keeps the source brain dump item when a sibling split suggestion lost its sourceId, even though the linked suggestion was accepted", () => {
    const raw = [
      { sourceId: "d1", title: "Plan team offsite", horizonLevel: "week", priority: "P2" },
      { sourceId: null, title: "Order catering", horizonLevel: "week", priority: "P2" },
    ];
    const all = normalizeAiOrganizeSuggestions(raw, DUMP_ITEMS);
    const accepted = [all[0]]; // user accepts the linked suggestion, rejects the unlinked one
    const result = buildClearedBrainDump(DUMP_ITEMS, accepted, all, all.droppedSourceIds);
    expect(result.find((d) => d.id === "d1")).toBeDefined();
  });

  it("keeps the source brain dump item when droppedSourceIds marks it as truncated, even if every visible suggestion was accepted", () => {
    const allSuggestions = [
      { sourceId: "d1", title: "Update CV", horizonLevel: "week", priority: "P1" },
      { sourceId: "d1", title: "Apply to vacancies", horizonLevel: "week", priority: "P1" },
    ];
    const droppedSourceIds = new Set(["d1"]);
    const result = buildClearedBrainDump(DUMP_ITEMS, allSuggestions, allSuggestions, droppedSourceIds);
    expect(result).toHaveLength(3);
    expect(result.find((d) => d.id === "d1")).toBeDefined();
  });
});

describe("byPriorityThenOrder", () => {
  it("sorts P1 before P2 before P3 before P4", () => {
    const tasks = [
      T({ uuid: "p4", priority: "P4", orderIndex: 0 }),
      T({ uuid: "p1", priority: "P1", orderIndex: 0 }),
      T({ uuid: "p3", priority: "P3", orderIndex: 0 }),
      T({ uuid: "p2", priority: "P2", orderIndex: 0 }),
    ];
    expect(tasks.sort(byPriorityThenOrder).map(t => t.uuid)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("preserves orderIndex within the same priority", () => {
    const tasks = [
      T({ uuid: "b", priority: "P2", orderIndex: 1 }),
      T({ uuid: "a", priority: "P2", orderIndex: 0 }),
    ];
    expect(tasks.sort(byPriorityThenOrder).map(t => t.uuid)).toEqual(["a", "b"]);
  });

  it("treats a missing priority as P4", () => {
    const tasks = [
      T({ uuid: "p3", priority: "P3", orderIndex: 0 }),
      T({ uuid: "none", orderIndex: 0 }),
    ];
    expect(tasks.sort(byPriorityThenOrder).map(t => t.uuid)).toEqual(["p3", "none"]);
  });
});

describe("CATEGORY_ICONS", () => {
  it("has an icon for each category offered in AddTaskDialog", () => {
    expect(CATEGORY_ICONS.Career).toBeTruthy();
    expect(CATEGORY_ICONS.Work).toBeTruthy();
    expect(CATEGORY_ICONS.Health).toBeTruthy();
    expect(CATEGORY_ICONS.Personal).toBeTruthy();
  });

  it("has no icon for a missing or unknown category", () => {
    expect(CATEGORY_ICONS[undefined]).toBeUndefined();
    expect(CATEGORY_ICONS["NotACategory"]).toBeUndefined();
  });
});
