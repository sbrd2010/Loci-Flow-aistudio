import { describe, it, expect } from "vitest";
import {
  FRONT_NAME_MAX,
  FRONT_NEXT_MOVE_MAX,
  FRONT_LIMIT,
  LEGACY_DEADLINE_FRONT_ID,
  parseDueDate,
  normalizeFront,
  normalizeFronts,
  legacyDeadlineAsFront,
  frontsFromConfig,
  makeFront,
  frontDaysLeft,
  tasksForFront,
  unassignedTasks,
  frontProgress,
  frontNextMove,
  sortFronts,
  frontIsWaiting,
  frontDueLabel,
  planFooterSentence,
} from "./fronts";

const task = (over = {}) => ({ uuid: "t", title: "A task", frontId: null, isCompleted: false, isParked: false, isDeleted: false, orderIndex: 0, ...over });

describe("parseDueDate", () => {
  it("parses at local midnight, not UTC", () => {
    const d = parseDueDate("2026-11-04");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(4);
    // The bug this guards: new Date("2026-11-04") is UTC midnight, which is
    // Nov 3 for anyone west of Greenwich.
    expect(d.getHours()).toBe(0);
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    for (const bad of ["", "  ", "04-11-2026", "2026-11", "not a date", null, undefined, 20261104, {}]) {
      expect(parseDueDate(bad)).toBeNull();
    }
  });
});

describe("normalizeFront", () => {
  it("keeps a well-formed front", () => {
    expect(normalizeFront({ id: "f1", name: "Membrane paper", nextMove: "Finish §3.1", dueAt: "2026-11-04", parked: false }))
      .toEqual({ id: "f1", name: "Membrane paper", nextMove: "Finish §3.1", dueAt: "2026-11-04", parked: false });
  });

  it("drops a front with no usable name", () => {
    expect(normalizeFront({ id: "f1", name: "   " })).toBeNull();
    expect(normalizeFront({ id: "f1" })).toBeNull();
    expect(normalizeFront(null)).toBeNull();
    expect(normalizeFront([])).toBeNull();
    expect(normalizeFront("Membrane paper")).toBeNull();
  });

  it("clamps long strings so one value cannot block a payload save", () => {
    const f = normalizeFront({ id: "f1", name: "n".repeat(500), nextMove: "m".repeat(900) });
    expect(f.name).toHaveLength(FRONT_NAME_MAX);
    expect(f.nextMove).toHaveLength(FRONT_NEXT_MOVE_MAX);
  });

  it("nulls an unparseable dueAt rather than storing junk", () => {
    expect(normalizeFront({ name: "F", dueAt: "sometime next year" }).dueAt).toBeNull();
  });

  it("treats parked as strictly boolean true", () => {
    expect(normalizeFront({ name: "F", parked: "yes" }).parked).toBe(false);
    expect(normalizeFront({ name: "F", parked: 1 }).parked).toBe(false);
    expect(normalizeFront({ name: "F", parked: true }).parked).toBe(true);
  });

  it("falls back to a positional id when none is given", () => {
    expect(normalizeFront({ name: "F" }, 3).id).toBe("front-3");
  });
});

describe("normalizeFronts", () => {
  it("returns [] for non-arrays", () => {
    for (const bad of [null, undefined, {}, "fronts", 7]) expect(normalizeFronts(bad)).toEqual([]);
  });

  it("drops invalid entries but keeps the valid ones", () => {
    expect(normalizeFronts([{ name: "A" }, null, { name: "" }, { name: "B" }]).map(f => f.name)).toEqual(["A", "B"]);
  });

  it("drops duplicate ids, keeping the first", () => {
    const out = normalizeFronts([{ id: "x", name: "First" }, { id: "x", name: "Second" }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("First");
  });

  it("caps the list", () => {
    const many = Array.from({ length: FRONT_LIMIT + 10 }, (_, i) => ({ id: `f${i}`, name: `Front ${i}` }));
    expect(normalizeFronts(many)).toHaveLength(FRONT_LIMIT);
  });
});

describe("legacy deadline projection", () => {
  const legacyConfig = { deadlineLabel: "Membrane paper", deadlineDate: "2026-11-04", deadlineAction: "Finish the results section" };

  it("projects the single deadline into a front", () => {
    expect(legacyDeadlineAsFront(legacyConfig)).toEqual({
      id: LEGACY_DEADLINE_FRONT_ID,
      name: "Membrane paper",
      nextMove: "Finish the results section",
      dueAt: "2026-11-04",
      parked: false,
    });
  });

  it("projects nothing when no deadline was ever set", () => {
    expect(legacyDeadlineAsFront({})).toBeNull();
    expect(legacyDeadlineAsFront({ deadlineLabel: "  ", deadlineDate: "2026-11-04" })).toBeNull();
  });

  it("a deadline with no date still becomes a front", () => {
    expect(legacyDeadlineAsFront({ deadlineLabel: "Someday thing" }).dueAt).toBeNull();
  });

  it("frontsFromConfig shows the legacy front first, ahead of stored ones", () => {
    const out = frontsFromConfig({ ...legacyConfig, fronts: [{ id: "f2", name: "Pressure rig" }] });
    expect(out.map(f => f.id)).toEqual([LEGACY_DEADLINE_FRONT_ID, "f2"]);
  });

  it("stops projecting once the user has a real front with that id", () => {
    const out = frontsFromConfig({ ...legacyConfig, fronts: [{ id: LEGACY_DEADLINE_FRONT_ID, name: "Renamed by user" }] });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Renamed by user");
  });

  it("is purely a read — it never mutates the config it is given", () => {
    const config = { ...legacyConfig, fronts: [{ id: "f2", name: "Pressure rig" }] };
    const snapshot = JSON.parse(JSON.stringify(config));
    frontsFromConfig(config);
    expect(config).toEqual(snapshot);
  });

  it("a user with neither fronts nor a deadline gets an empty list, not a crash", () => {
    expect(frontsFromConfig({})).toEqual([]);
    expect(frontsFromConfig(undefined)).toEqual([]);
  });
});

describe("makeFront", () => {
  it("builds a valid front with a unique id", () => {
    const a = makeFront({ name: "Grant resubmission", dueAt: "2027-01-15" }, 1000);
    expect(a.name).toBe("Grant resubmission");
    expect(a.dueAt).toBe("2027-01-15");
    expect(a.parked).toBe(false);
    expect(makeFront({ name: "X" }).id).not.toBe(makeFront({ name: "X" }).id);
  });

  it("refuses to build a nameless front", () => {
    expect(makeFront({ name: "" })).toBeNull();
    expect(makeFront()).toBeNull();
  });
});

describe("frontDaysLeft", () => {
  const now = new Date(2026, 10, 4, 14, 30); // 4 Nov 2026, mid-afternoon local

  it("counts whole days regardless of time of day", () => {
    expect(frontDaysLeft({ dueAt: "2026-11-15" }, now)).toBe(11);
    expect(frontDaysLeft({ dueAt: "2026-11-05" }, now)).toBe(1);
  });

  it("is 0 on the due date itself, even late in the day", () => {
    expect(frontDaysLeft({ dueAt: "2026-11-04" }, new Date(2026, 10, 4, 23, 59))).toBe(0);
  });

  it("goes negative when overdue", () => {
    expect(frontDaysLeft({ dueAt: "2026-11-01" }, now)).toBe(-3);
  });

  it("is null without a usable date", () => {
    expect(frontDaysLeft({ dueAt: null }, now)).toBeNull();
    expect(frontDaysLeft({}, now)).toBeNull();
    expect(frontDaysLeft(null, now)).toBeNull();
  });

  it("does not drift across a DST boundary", () => {
    // Europe/Amsterdam falls back on 25 Oct 2026. Counting with a fixed
    // 86400000ms day across that boundary is what would produce an off-by-one.
    const before = new Date(2026, 9, 20, 12, 0);
    expect(frontDaysLeft({ dueAt: "2026-10-30" }, before)).toBe(10);
  });
});

describe("task <-> front joins", () => {
  const tasks = [
    task({ uuid: "a", frontId: "f1", isCompleted: true }),
    task({ uuid: "b", frontId: "f1" }),
    task({ uuid: "c", frontId: "f2" }),
    task({ uuid: "d" }),
    task({ uuid: "e", frontId: "f1", isDeleted: true }),
  ];

  it("collects only live tasks on a front", () => {
    expect(tasksForFront(tasks, "f1").map(t => t.uuid)).toEqual(["a", "b"]);
  });

  it("returns nothing for a missing or empty front id", () => {
    expect(tasksForFront(tasks, "nope")).toEqual([]);
    expect(tasksForFront(tasks, null)).toEqual([]);
    expect(tasksForFront(null, "f1")).toEqual([]);
  });

  it("treats every existing task with no frontId as unassigned", () => {
    expect(unassignedTasks(tasks).map(t => t.uuid)).toEqual(["d"]);
  });

  it("counts progress as done/total, excluding deleted", () => {
    expect(frontProgress(tasks, "f1")).toEqual({ done: 1, total: 2 });
    expect(frontProgress(tasks, "empty")).toEqual({ done: 0, total: 0 });
  });
});

describe("frontNextMove", () => {
  it("prefers the front's own stated next move", () => {
    expect(frontNextMove({ id: "f1", nextMove: "Write §3.1" }, [task({ frontId: "f1", title: "Something else" })]))
      .toBe("Write §3.1");
  });

  it("otherwise takes the first open task by order", () => {
    const tasks = [
      task({ uuid: "b", frontId: "f1", title: "Second", orderIndex: 2 }),
      task({ uuid: "a", frontId: "f1", title: "First", orderIndex: 1 }),
    ];
    expect(frontNextMove({ id: "f1" }, tasks)).toBe("First");
  });

  it("skips completed and parked tasks", () => {
    const tasks = [
      task({ frontId: "f1", title: "Done", isCompleted: true, orderIndex: 0 }),
      task({ frontId: "f1", title: "Parked", isParked: true, orderIndex: 1 }),
      task({ frontId: "f1", title: "Actually next", orderIndex: 2 }),
    ];
    expect(frontNextMove({ id: "f1" }, tasks)).toBe("Actually next");
  });

  it("is null when a front has nothing open", () => {
    expect(frontNextMove({ id: "f1" }, [])).toBeNull();
    expect(frontNextMove(null, [])).toBeNull();
  });
});

describe("sortFronts", () => {
  const now = new Date(2026, 10, 4);

  it("puts the nearest deadline first", () => {
    const out = sortFronts([
      { id: "c", name: "C", dueAt: "2027-01-10" },
      { id: "a", name: "A", dueAt: "2026-11-15" },
      { id: "b", name: "B", dueAt: "2026-12-01" },
    ], now);
    expect(out.map(f => f.id)).toEqual(["a", "b", "c"]);
  });

  it("puts undated fronts after dated ones, and parked fronts last", () => {
    const out = sortFronts([
      { id: "parked", name: "P", dueAt: "2026-11-05", parked: true },
      { id: "undated", name: "U" },
      { id: "dated", name: "D", dueAt: "2026-12-01" },
    ], now);
    expect(out.map(f => f.id)).toEqual(["dated", "undated", "parked"]);
  });

  it("surfaces an overdue front above everything", () => {
    const out = sortFronts([
      { id: "soon", name: "S", dueAt: "2026-11-05" },
      { id: "late", name: "L", dueAt: "2026-10-01" },
    ], now);
    expect(out[0].id).toBe("late");
  });

  it("does not mutate the array it is given", () => {
    const input = [{ id: "b", name: "B", dueAt: "2026-12-01" }, { id: "a", name: "A", dueAt: "2026-11-05" }];
    sortFronts(input, now);
    expect(input.map(f => f.id)).toEqual(["b", "a"]);
  });

  it("handles empty and missing input", () => {
    expect(sortFronts([], now)).toEqual([]);
    expect(sortFronts(null, now)).toEqual([]);
  });
});

describe("frontIsWaiting", () => {
  it("is true only when every open task names someone", () => {
    expect(frontIsWaiting([
      task({ frontId: "f1", waitingOn: "Chris" }),
      task({ frontId: "f1", waitingOn: "Priya" }),
    ], "f1")).toBe(true);
  });

  it("is false when any open task is the user's own", () => {
    expect(frontIsWaiting([
      task({ frontId: "f1", waitingOn: "Chris" }),
      task({ frontId: "f1" }),
    ], "f1")).toBe(false);
  });

  it("ignores blank waitingOn strings", () => {
    expect(frontIsWaiting([task({ frontId: "f1", waitingOn: "   " })], "f1")).toBe(false);
  });

  it("is false for a front with nothing open, rather than vacuously true", () => {
    expect(frontIsWaiting([task({ frontId: "f1", isCompleted: true, waitingOn: "Chris" })], "f1")).toBe(false);
    expect(frontIsWaiting([], "f1")).toBe(false);
  });
});

describe("frontDueLabel", () => {
  const now = new Date(2026, 10, 4); // 4 Nov 2026

  it("shows days when the deadline is close enough to feel", () => {
    expect(frontDueLabel({ dueAt: "2026-11-15" }, now)).toBe("11d");
    expect(frontDueLabel({ dueAt: "2026-11-04" }, now)).toBe("0d");
  });

  it("shows a date once it is further out, and a bare month further still", () => {
    expect(frontDueLabel({ dueAt: "2026-12-20" }, now)).toBe("20 Dec");
    expect(frontDueLabel({ dueAt: "2027-06-01" }, now)).toBe("Jun");
  });

  it("says OVERDUE rather than a negative number", () => {
    expect(frontDueLabel({ dueAt: "2026-10-01" }, now)).toBe("OVERDUE");
  });

  it("replaces the date with PARKED for a parked front", () => {
    expect(frontDueLabel({ dueAt: "2026-11-15", parked: true }, now)).toBe("PARKED");
    expect(frontDueLabel({ parked: true }, now)).toBe("PARKED");
  });

  it("shows nothing for an undated, unparked front", () => {
    expect(frontDueLabel({ name: "Someday" }, now)).toBeNull();
  });
});

describe("planFooterSentence", () => {
  const now = new Date(2026, 10, 4);
  const front = (over) => ({ id: "f", name: "F", parked: false, ...over });

  it("is null when there is nothing live to describe", () => {
    expect(planFooterSentence([], [], now)).toBeNull();
    expect(planFooterSentence([front({ parked: true })], [], now)).toBeNull();
  });

  it("states how many fronts are actually moving", () => {
    const fronts = [front({ id: "a", nextMove: "Do it" }), front({ id: "b" })];
    expect(planFooterSentence(fronts, [], now)).toContain("1 of 2 fronts have a next move");
  });

  it("does not shame when nothing is moving", () => {
    const s = planFooterSentence([front({ id: "a" })], [], now);
    expect(s).toBe("No front has a next move yet.");
    expect(s).not.toMatch(/should|behind|fail/i);
  });

  it("names deadline pressure only when it is real", () => {
    expect(planFooterSentence([front({ id: "a", dueAt: "2026-11-10", nextMove: "x" })], [], now))
      .toContain("One has a deadline inside a fortnight.");
    expect(planFooterSentence([front({ id: "a", dueAt: "2027-06-01", nextMove: "x" })], [], now))
      .not.toContain("fortnight");
  });

  // frontDaysLeft is negative for an overdue front, and `d <= 14` alone was
  // true for a deadline three months gone.
  it("does not call an overdue deadline upcoming", () => {
    const overdue = planFooterSentence([front({ id: "a", dueAt: "2026-08-01", nextMove: "x" })], [], now);
    expect(overdue).not.toContain("fortnight");
    // Due today still counts as inside the fortnight.
    expect(planFooterSentence([front({ id: "a", dueAt: "2026-11-04", nextMove: "x" })], [], now))
      .toContain("One has a deadline inside a fortnight.");
  });

  it("frames parked fronts as a choice, not a failure", () => {
    const s = planFooterSentence([front({ id: "a", nextMove: "x" }), front({ id: "b", parked: true })], [], now);
    expect(s).toContain("1 is parked, and stays that way until you say otherwise.");
  });
});
