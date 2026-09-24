import { getFocusWindows } from "./focusWindows";
import { describe, it, expect } from "vitest";
import {
  numberWord,
  openTasks,
  minutesLeftToday,
  formatMinutesLeft,
  narrowDown,
  pickThree,
} from "./narrowDown";

const NOW = new Date(2026, 10, 4, 9, 41); // 4 Nov 2026, 09:41 local
const DAYS = (n) => n * 86400000;

// A task that survives every cut by default: due today, touched just now,
// small enough to fit. Each test spoils exactly the field it is about.
const task = (over = {}) => ({
  uuid: "t",
  title: "A task",
  horizonLevel: "today",
  priority: "P3",
  timeEstimateMinutes: 25,
  deadlineTimestamp: null,
  lastUpdated: NOW.getTime(),
  isCompleted: false,
  isParked: false,
  isDeleted: false,
  orderIndex: 0,
  ...over,
});

describe("numberWord", () => {
  it("spells the counts the headline uses", () => {
    expect(numberWord(0)).toBe("No");
    expect(numberWord(1)).toBe("One");
    expect(numberWord(14)).toBe("Fourteen");
  });
  it("falls back to digits past its range", () => {
    expect(numberWord(37)).toBe("37");
  });
});

describe("openTasks", () => {
  it("counts only what is genuinely still open", () => {
    const tasks = [
      task({ uuid: "a" }),
      task({ uuid: "b", isCompleted: true }),
      task({ uuid: "c", isParked: true }),
      task({ uuid: "d", isDeleted: true }),
      null,
    ];
    expect(openTasks(tasks).map(t => t.uuid)).toEqual(["a"]);
  });
  it("leaves out a task moved to tomorrow until tomorrow comes", () => {
    const tasks = [task({ uuid: "a" }), task({ uuid: "b", deferredUntil: "2024-06-16" })];
    expect(openTasks(tasks, new Date(2024, 5, 15, 10)).map(t => t.uuid)).toEqual(["a"]);
    expect(openTasks(tasks, new Date(2024, 5, 16, 10)).map(t => t.uuid)).toEqual(["a", "b"]);
  });
  it("judges 'tomorrow' by the Loci day: with a window to 02:00, 00:30 is still yesterday", () => {
    const late = getFocusWindows({ dayEndHour: 26 });
    const tasks = [task({ uuid: "a" }), task({ uuid: "b", deferredUntil: "2024-06-16" })];
    expect(openTasks(tasks, new Date(2024, 5, 16, 0, 30), late).map(t => t.uuid)).toEqual(["a"]);
    expect(openTasks(tasks, new Date(2024, 5, 16, 2, 30), late).map(t => t.uuid)).toEqual(["a", "b"]);
  });
  it("survives a non-array", () => {
    expect(openTasks(null)).toEqual([]);
    expect(openTasks(undefined)).toEqual([]);
  });
});

describe("minutesLeftToday", () => {
  it("measures to the configured end of day", () => {
    // 09:41 -> 18:00 is 8h19m, the figure the design itself uses.
    expect(minutesLeftToday({ dayEndHour: 18 }, NOW)).toBe(499);
    expect(formatMinutesLeft(499)).toBe("8h19m");
  });

  it("handles a day that ends after midnight", () => {
    // dayEndHour 26 means 2am tomorrow — the app's own demo default.
    expect(minutesLeftToday({ dayEndHour: 26 }, NOW)).toBe(979);
    expect(formatMinutesLeft(979)).toBe("16h19m");
  });

  it("returns a whole number of minutes even mid-minute", () => {
    const midMinute = new Date(2026, 10, 4, 9, 41, 31);
    const mins = minutesLeftToday({ dayEndHour: 18 }, midMinute);
    expect(Number.isInteger(mins)).toBe(true);
    expect(formatMinutesLeft(mins)).toMatch(/^\d+h\d{2}m$/);
  });

  it("never goes negative once the day is over", () => {
    expect(minutesLeftToday({ dayEndHour: 18 }, new Date(2026, 10, 4, 23, 0))).toBe(0);
  });

  // It used to read config.dayEndHour directly, so a user with configured
  // windows was told they had the whole day left and kept work that cannot fit.
  it("measures the user's configured focus windows, not the legacy end hour", () => {
    const config = { focusWindows: [{ start: "09:00", end: "12:00" }] };
    // 09:41 inside a 09:00-12:00 window: 2h19m left, not 8h19m.
    expect(minutesLeftToday(config, NOW)).toBe(139);
    expect(formatMinutesLeft(139)).toBe("2h19m");
  });

  it("excludes the gap between two windows rather than counting straight through", () => {
    const config = { focusWindows: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "16:00" }] };
    // 2h19m left of the morning window + the full 2h afternoon one.
    expect(minutesLeftToday(config, NOW)).toBe(139 + 120);
  });

  it("falls back to a sane end hour when config is missing or junk", () => {
    expect(minutesLeftToday({}, NOW)).toBeGreaterThan(0);
    expect(minutesLeftToday({ dayEndHour: "nonsense" }, NOW)).toBeGreaterThan(0);
  });
});

describe("formatMinutesLeft", () => {
  // getRemainingFocusMinutes carries the current seconds as a fraction of a
  // minute, which `% 60` rendered as "8h18.48333333333335m".
  it("never renders a fractional minute", () => {
    expect(formatMinutesLeft(498.48333333333335)).toBe("8h18m");
    expect(formatMinutesLeft(59.6)).toBe("1h00m");
    expect(formatMinutesLeft(-3)).toBe("0m");
    expect(formatMinutesLeft(undefined)).toBe("0m");
  });

  it("pads the minutes so the figure is stable width", () => {
    expect(formatMinutesLeft(499)).toBe("8h19m");
    expect(formatMinutesLeft(605)).toBe("10h05m");
    expect(formatMinutesLeft(45)).toBe("45m");
    expect(formatMinutesLeft(0)).toBe("0m");
  });
});

describe("narrowDown — the reduction ledger", () => {
  const config = { dayEndHour: 18 };

  it("shows every cut it makes, and lands on exactly one", () => {
    const tasks = [
      // survives everything
      task({ uuid: "keep1", title: "Write the crossover paragraph" }),
      task({ uuid: "keep2" }),
      // cut 1 — not due this horizon
      task({ uuid: "far1", horizonLevel: "month" }),
      task({ uuid: "far2", horizonLevel: "quarter" }),
      task({ uuid: "far3", horizonLevel: "halfyear" }),
      // cut 2 — untouched for over a week
      task({ uuid: "old1", lastUpdated: NOW.getTime() - DAYS(9) }),
      task({ uuid: "old2", lastUpdated: NOW.getTime() - DAYS(30) }),
      // cut 3 — won't fit in the time left
      task({ uuid: "big1", timeEstimateMinutes: 600 }),
    ];
    const out = narrowDown(tasks, config, NOW);

    expect(out.total).toBe(8);
    expect(out.rows.map(r => [r.figure, r.reason])).toEqual([
      ["8", "open across your lists"],
      ["−3", "aren't due this horizon"],
      ["−2", "you haven't touched in 7 days"],
      ["−1", "won't fit in the 8h19m you have left"],
      ["1", "is actually yours, today"],
    ]);
    expect(out.chosen.uuid).toBe("keep1");
    expect(out.parked).toHaveLength(7);
  });

  it("omits a cut that removes nothing, rather than showing -0", () => {
    const out = narrowDown([task({ uuid: "a" }), task({ uuid: "b" })], config, NOW);
    expect(out.rows.map(r => r.key)).toEqual(["open", "one"]);
    expect(out.rows.every(r => r.figure !== "−0")).toBe(true);
  });

  it("SKIPS a cut that would empty the pool — the screen must land on one", () => {
    // Every task is beyond this horizon. Applying the cut would leave nothing,
    // so it is not applied and not shown.
    const tasks = [
      task({ uuid: "a", horizonLevel: "month" }),
      task({ uuid: "b", horizonLevel: "quarter" }),
    ];
    const out = narrowDown(tasks, config, NOW);
    expect(out.rows.map(r => r.key)).toEqual(["open", "one"]);
    expect(out.chosen).not.toBeNull();
  });

  it("still lands on one when every task is too big for the time left", () => {
    const tasks = [
      task({ uuid: "a", timeEstimateMinutes: 900 }),
      task({ uuid: "b", timeEstimateMinutes: 900 }),
    ];
    const out = narrowDown(tasks, config, NOW);
    expect(out.chosen).not.toBeNull();
    expect(out.rows.some(r => r.key === "toobig")).toBe(false);
  });

  // The fronts have to EXIST in config for a task to be on one — a frontId
  // naming nothing is loose work, exactly as Plan renders it.
  const withFronts = { ...config, fronts: [{ id: "f1", name: "One" }, { id: "f2", name: "Two" }] };

  it("counts fronts when tasks are on them", () => {
    const tasks = [
      task({ uuid: "a", frontId: "f1" }),
      task({ uuid: "b", frontId: "f2" }),
      task({ uuid: "c", frontId: "f1" }),
    ];
    expect(narrowDown(tasks, withFronts, NOW).rows[0].reason).toBe("open across two fronts");
  });

  it("says 'one front' rather than 'one fronts'", () => {
    const tasks = [task({ uuid: "a", frontId: "f1" }), task({ uuid: "b", frontId: "f1" })];
    expect(narrowDown(tasks, withFronts, NOW).rows[0].reason).toBe("open across one front");
  });

  it("does not fold loose work into the front count", () => {
    const tasks = [
      task({ uuid: "a", frontId: "f1" }),
      task({ uuid: "b" }),
      task({ uuid: "c" }),
    ];
    expect(narrowDown(tasks, withFronts, NOW).rows[0].reason).toBe("open across one front, and 2 on none");
  });

  it("treats a frontId naming a closed front as loose, not as a front", () => {
    const tasks = [
      task({ uuid: "a", frontId: "f1" }),
      task({ uuid: "b", frontId: "gone" }),
    ];
    expect(narrowDown(tasks, withFronts, NOW).rows[0].reason).toBe("open across one front, and 1 on none");
  });

  it("says 'your lists' when nothing is on a real front", () => {
    const tasks = [task({ uuid: "a", frontId: "gone" }), task({ uuid: "b" })];
    expect(narrowDown(tasks, withFronts, NOW).rows[0].reason).toBe("open across your lists");
  });

  it("returns an empty result, not a crash, when nothing is open", () => {
    const out = narrowDown([task({ isCompleted: true })], config, NOW);
    expect(out).toMatchObject({ total: 0, rows: [], chosen: null, why: null, parked: [] });
    expect(narrowDown(null, config, NOW).chosen).toBeNull();
  });

  it("treats a task with no lastUpdated as fresh, never as stale", () => {
    const tasks = [task({ uuid: "a", lastUpdated: undefined }), task({ uuid: "b" })];
    expect(narrowDown(tasks, config, NOW).rows.some(r => r.key === "stale")).toBe(false);
  });

  it("does not treat a missing estimate as too big", () => {
    const tasks = [task({ uuid: "a", timeEstimateMinutes: null }), task({ uuid: "b" })];
    expect(narrowDown(tasks, config, NOW).rows.some(r => r.key === "toobig")).toBe(false);
  });
});

describe("narrowDown — which one, and why", () => {
  const config = { dayEndHour: 18 };

  it("prefers the nearest real deadline", () => {
    const tasks = [
      task({ uuid: "later", deadlineTimestamp: NOW.getTime() + DAYS(20) }),
      task({ uuid: "soon", deadlineTimestamp: NOW.getTime() + DAYS(2) }),
      task({ uuid: "undated" }),
    ];
    const out = narrowDown(tasks, config, NOW);
    expect(out.chosen.uuid).toBe("soon");
    expect(out.why).toBe("It has the nearest date of everything still standing.");
  });

  it("only claims 'the only thing with a date' when that is literally true", () => {
    const tasks = [
      task({ uuid: "dated", deadlineTimestamp: NOW.getTime() + DAYS(3) }),
      task({ uuid: "undated" }),
    ];
    expect(narrowDown(tasks, config, NOW).why).toBe("It's the only thing left with a date on it.");
  });

  it("falls back to priority when nothing is dated", () => {
    const tasks = [
      task({ uuid: "low", priority: "P4", orderIndex: 0 }),
      task({ uuid: "high", priority: "P1", orderIndex: 1 }),
    ];
    const out = narrowDown(tasks, config, NOW);
    expect(out.chosen.uuid).toBe("high");
    expect(out.why).toBe("It's the highest priority of what's left.");
  });

  it("falls back to the user's own order when nothing distinguishes them", () => {
    const tasks = [
      task({ uuid: "second", orderIndex: 2 }),
      task({ uuid: "first", orderIndex: 1 }),
    ];
    const out = narrowDown(tasks, config, NOW);
    expect(out.chosen.uuid).toBe("first");
    expect(out.why).toBe("It's first in the order you already put these in.");
  });

  it("never claims a priority edge it does not have", () => {
    const tasks = [task({ uuid: "a", priority: "P1" }), task({ uuid: "b", priority: "P1" })];
    expect(narrowDown(tasks, config, NOW).why).not.toMatch(/highest priority/);
  });

  it("parks everything except the chosen task, and deletes nothing", () => {
    const tasks = [task({ uuid: "a" }), task({ uuid: "b" }), task({ uuid: "c" })];
    const out = narrowDown(tasks, config, NOW);
    expect(out.parked).toHaveLength(2);
    expect(out.parked.map(t => t.uuid)).not.toContain(out.chosen.uuid);
    // The input array is untouched — "nothing was deleted" is literal.
    expect(tasks).toHaveLength(3);
    expect(tasks.every(t => !t.isDeleted && !t.isParked)).toBe(true);
  });
});


// Fronts carry deadlines now, and a task on a dated front is due with it. Before
// assignment existed this could not fire; it can now.
describe("narrowDown — a task inherits its front's deadline", () => {
  const CONFIG = {
    dayEndHour: 26,
    fronts: [{ id: "f1", name: "Membrane paper", dueAt: "2026-11-05" }],
  };
  const base = { horizonLevel: "week", lastUpdated: NOW.getTime(), timeEstimateMinutes: 25 };

  it("prefers a task on a dated front over an undated higher-priority task", () => {
    const tasks = [
      { ...base, uuid: "loose", title: "Undated but urgent-looking", priority: "P1", orderIndex: 1 },
      { ...base, uuid: "onfront", title: "Finish section 3", priority: "P3", frontId: "f1", orderIndex: 2 },
    ];
    const out = narrowDown(tasks, CONFIG, NOW);
    expect(out.chosen.uuid).toBe("onfront");
  });

  it("says where the date actually came from, rather than claiming the task has one", () => {
    const tasks = [
      { ...base, uuid: "loose", title: "Undated", priority: "P1", orderIndex: 1 },
      { ...base, uuid: "onfront", title: "Finish section 3", priority: "P3", frontId: "f1", orderIndex: 2 },
    ];
    const out = narrowDown(tasks, CONFIG, NOW);
    expect(out.why).toBe("It's the only thing left on a dated front — Membrane paper.");
    expect(out.why).not.toMatch(/date on it/);
  });

  it("still prefers a task's OWN nearer deadline over its front's", () => {
    const tasks = [
      { ...base, uuid: "onfront", title: "On the front", frontId: "f1", orderIndex: 1 },
      { ...base, uuid: "own", title: "Due tomorrow", deadlineTimestamp: new Date(2026, 10, 5).getTime() - 86400000, orderIndex: 2 },
    ];
    const out = narrowDown(tasks, CONFIG, NOW);
    expect(out.chosen.uuid).toBe("own");
  });

  it("ignores a front with no date, and a frontId naming no front", () => {
    const config = { dayEndHour: 26, fronts: [{ id: "f2", name: "Undated front" }] };
    const tasks = [
      { ...base, uuid: "a", title: "On an undated front", frontId: "f2", priority: "P4", orderIndex: 1 },
      { ...base, uuid: "b", title: "Higher priority", priority: "P1", orderIndex: 2 },
      { ...base, uuid: "c", title: "Front does not exist", frontId: "ghost", priority: "P4", orderIndex: 3 },
    ];
    const out = narrowDown(tasks, config, NOW);
    expect(out.chosen.uuid).toBe("b"); // priority decides, as before
    expect(out.why).toBe("It's the highest priority of what's left.");
  });
});

describe("pickThree (Feeling scattered, 45c)", () => {
  const now = new Date("2026-09-24T10:00:00");
  const t = (uuid, fields = {}) => ({ uuid, title: uuid, horizonLevel: "today", priority: "P3", orderIndex: 0, ...fields });

  it("offers at most three, narrowDown's choice first, then the most urgent of the rest", () => {
    const tasks = [t("a", { priority: "P3" }), t("b", { priority: "P1" }), t("c", { priority: "P2" }), t("d", { priority: "P3", orderIndex: 5 })];
    const picks = pickThree(tasks, {}, now);
    expect(picks).toHaveLength(3);
    expect(picks[0].uuid).toBe(narrowDown(tasks, {}, now).chosen.uuid);
    expect(picks.map(p => p.uuid)).toEqual(["b", "c", "a"]);
  });

  it("offers fewer when fewer are open, and none when nothing is", () => {
    expect(pickThree([t("a")], {}, now)).toHaveLength(1);
    expect(pickThree([], {}, now)).toEqual([]);
  });

  it("never offers a task moved to tomorrow", () => {
    const tasks = [t("a", { priority: "P1", deferredUntil: "2026-09-25" }), t("b")];
    expect(pickThree(tasks, {}, now).map(p => p.uuid)).toEqual(["b"]);
  });
});
