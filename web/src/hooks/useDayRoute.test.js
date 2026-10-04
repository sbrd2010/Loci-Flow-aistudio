import { describe, it, expect } from "vitest";
import { getEstimate, joinRoute, listFollowsRoute, oneThingToNow, restoreRoute, routeFollowsList, routeIsContiguous } from "./useDayRoute";

const DAY = "2026-09-29";
const stop = (uuid, order, minutes, extra = {}) => ({
  uuid, title: uuid, horizonLevel: "today", timeEstimateMinutes: minutes,
  dayMapDate: DAY, dayMapOrder: order, dayMapStartMinutes: 540 + order * 60, ...extra,
});
const byId = (tasks) => Object.fromEntries(tasks.map(t => [t.uuid, t]));

describe("oneThingToNow (53–56: the one thing sits at NOW)", () => {
  it("puts the one thing first from now; the rest flows on after it in its order", () => {
    const tasks = [stop("a", 0, 60), stop("b", 1, 30), stop("c", 2, 25)];
    const { tasks: next, ids } = oneThingToNow(tasks, "c", { todayStr: DAY, nowMinutes: 600 });
    const t = byId(next);
    expect(ids).toEqual(["c", "a", "b"]);
    expect([t.c.dayMapOrder, t.a.dayMapOrder, t.b.dayMapOrder]).toEqual([0, 1, 2]);
    expect(t.c.dayMapStartMinutes).toBe(600);
    expect(t.a.dayMapStartMinutes).toBeGreaterThanOrEqual(625);
    expect(t.b.dayMapStartMinutes).toBeGreaterThan(t.a.dayMapStartMinutes);
  });

  it("leaves a fixed stop at its time", () => {
    const tasks = [stop("a", 0, 60), stop("f", 1, 30, { dayMapFixedMinutes: 660 }), stop("c", 2, 25)];
    const t = byId(oneThingToNow(tasks, "c", { todayStr: DAY, nowMinutes: 600 }).tasks);
    expect(t.c.dayMapStartMinutes).toBe(600);
    expect(t.f.dayMapStartMinutes).toBe(660);
  });

  it("adds a one thing that wasn't on the route at its head", () => {
    const tasks = [stop("a", 0, 60), { uuid: "n", title: "n", horizonLevel: "today", timeEstimateMinutes: 25 }];
    const { tasks: next, ids } = oneThingToNow(tasks, "n", { todayStr: DAY, nowMinutes: 600 });
    expect(ids).toEqual(["n", "a"]);
    expect(byId(next).n).toMatchObject({ dayMapDate: DAY, dayMapOrder: 0, dayMapStartMinutes: 600 });
  });

  it("moves nothing with no route, and never a fixed one thing", () => {
    const loose = [{ uuid: "n", title: "n", horizonLevel: "today" }];
    expect(oneThingToNow(loose, "n", { todayStr: DAY, nowMinutes: 600 })).toBeNull();
    const tasks = [stop("a", 0, 60), stop("f", 1, 30, { dayMapFixedMinutes: 660 })];
    expect(oneThingToNow(tasks, "f", { todayStr: DAY, nowMinutes: 600 })).toBeNull();
  });
});

// Codex review of #427: a one thing longer than the gap before a fixed stop
// still starts at NOW; it stops for the fixed stop as for a break.
describe("the one thing before a fixed stop", () => {
  it("starts at NOW and continues after the fixed stop; nothing is pulled into its place", () => {
    const tasks = [
      stop("b", 0, 10),
      stop("f", 1, 30, { dayMapFixedMinutes: 630 }),
      stop("c", 2, 60, { isNowFocus: true }),
    ];
    const t = byId(oneThingToNow(tasks, "c", { todayStr: DAY, nowMinutes: 600 }).tasks);
    expect(t.c.dayMapStartMinutes).toBe(600);
    expect(t.f.dayMapStartMinutes).toBe(630);
    expect(t.b.dayMapStartMinutes).toBeGreaterThan(660);
  });
});

// Codex review of #427: Clear route, add a task, Undo: one route, timed again.
describe("restoreRoute", () => {
  it("puts the cleared stops back first and times the whole route again", () => {
    const cleared = [stop("a", 0, 30), stop("b", 1, 30)];
    const bare = ({ dayMapDate, dayMapOrder, dayMapStartMinutes, ...t }) => t;
    const now = [bare(cleared[0]), bare(cleared[1]), stop("n", 0, 20)];
    const t = byId(restoreRoute(now, cleared, { todayStr: DAY, anchorMinutes: 600 }));
    expect([t.a.dayMapOrder, t.b.dayMapOrder, t.n.dayMapOrder]).toEqual([0, 1, 2]);
    const starts = [t.a.dayMapStartMinutes, t.b.dayMapStartMinutes, t.n.dayMapStartMinutes];
    expect(new Set(starts).size).toBe(3);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });
});

// Codex review of #427: make a task the one thing, add another, then Undo:
// the one thing leaves the route and what stays is timed again, no gap.
describe("restoreRoute after a one-thing move", () => {
  it("retimes a stop added in between, straight after the stops that come back", () => {
    const route = [stop("a", 0, 30), stop("b", 1, 30)];
    const loose = { uuid: "n", title: "n", horizonLevel: "today", timeEstimateMinutes: 60 };
    const moved = oneThingToNow([...route, loose], "n", { todayStr: DAY, nowMinutes: 600 }).tasks;
    const added = [...moved, stop("x", 3, 20, { dayMapStartMinutes: 800 })];
    const before = [route[0], route[1], loose];
    const t = byId(restoreRoute(added, before, { todayStr: DAY, anchorMinutes: 600 }));
    expect(t.n.dayMapDate).toBeUndefined();
    expect([t.a.dayMapOrder, t.b.dayMapOrder, t.x.dayMapOrder]).toEqual([0, 1, 2]);
    expect(t.a.dayMapStartMinutes).toBe(600);
    expect(t.x.dayMapStartMinutes).toBe(t.b.dayMapStartMinutes + 30 + 5);
  });
});

// 10b (#430 loopcheck): during a break, now is inside it and the head can
// only start when it ends — that is no gap, or the route re-times forever.
import { hasHeadGap } from "./useDayRoute";
describe("hasHeadGap", () => {
  const lunch = [{ start: 815, end: 855, name: "Lunch" }]; // 13:35–14:15
  it("no gap when now is in a break and the head starts at the break's end", () => {
    const route = [stop("a", 0, 30, { dayMapStartMinutes: 855 }), stop("b", 1, 30, { dayMapStartMinutes: 885 })];
    expect(hasHeadGap(route, 820, DAY, lunch)).toBe(false);
  });
  it("a head later than timing from now would put it is a gap", () => {
    const route = [stop("a", 0, 30, { dayMapStartMinutes: 960 })];
    expect(hasHeadGap(route, 900, DAY, lunch)).toBe(true);
  });
  it("no flowing stops, no gap", () => {
    expect(hasHeadGap([], 900, DAY, lunch)).toBe(false);
  });
});

describe("getEstimate", () => {
  it("reads the task's estimate before the route's stored copy", () => {
    // Estimate changed on Today (45) after the route stored 25.
    expect(getEstimate({ timeEstimateMinutes: 45, dayMapDurationMinutes: 25 })).toBe(45);
    expect(getEstimate({ dayMapDurationMinutes: 30 })).toBe(30);
    expect(getEstimate({})).toBe(25);
  });
  it("a changed estimate makes the stored route out of date, so it is timed again", () => {
    const a = { uuid: "a", dayMapOrder: 0, dayMapStartMinutes: 540, dayMapDurationMinutes: 25, timeEstimateMinutes: 25 };
    const b = { uuid: "b", dayMapOrder: 1, dayMapStartMinutes: 570, dayMapDurationMinutes: 25, timeEstimateMinutes: 25 };
    expect(routeIsContiguous([a, b])).toBe(true);
    expect(routeIsContiguous([{ ...a, timeEstimateMinutes: 60 }, b])).toBe(false);
  });
});

describe("one order for the Today list and the Day map", () => {
  const ids = (tasks, field) => [...tasks].filter(t => t[field] != null).sort((a, b) => a[field] - b[field]).map(t => t.uuid);

  it("a drag on Today reorders the route the same way", () => {
    // List: b, a, c (b dragged to the top). Route still a, b, c.
    const tasks = [
      stop("a", 0, 30, { orderIndex: 1 }),
      stop("b", 1, 30, { orderIndex: 0 }),
      stop("c", 2, 30, { orderIndex: 2 }),
    ];
    expect(ids(routeFollowsList(tasks, DAY), "dayMapOrder")).toEqual(["b", "a", "c"]);
  });

  it("a drag on the Day map reorders the list, leaving tasks off the route where they were", () => {
    // Route: c, a, b. The list also holds u (unscheduled) at slot 1.
    const tasks = [
      stop("a", 1, 30, { orderIndex: 0 }),
      { uuid: "u", horizonLevel: "today", orderIndex: 1 },
      stop("b", 2, 30, { orderIndex: 2 }),
      stop("c", 0, 30, { orderIndex: 3 }),
    ];
    expect(ids(listFollowsRoute(tasks, DAY), "orderIndex")).toEqual(["c", "u", "a", "b"]);
  });

  it("keeps the one thing and fixed stops out of the swap", () => {
    const tasks = [
      stop("n", 0, 30, { orderIndex: 5, isNowFocus: true }),
      stop("f", 1, 30, { orderIndex: 0, dayMapFixedMinutes: 840 }),
      stop("a", 2, 30, { orderIndex: 2 }),
      stop("b", 3, 30, { orderIndex: 1 }),
    ];
    const t = byId(routeFollowsList(tasks, DAY));
    expect([t.n.dayMapOrder, t.f.dayMapOrder]).toEqual([0, 1]);
    expect([t.b.dayMapOrder, t.a.dayMapOrder]).toEqual([2, 3]);
  });

  it("Q7: a task moved from yesterday is an ordinary row; the list's order decides", () => {
    const tasks = [
      stop("y", 0, 30, { orderIndex: 5, deferredUntil: DAY }),
      stop("a", 1, 30, { orderIndex: 0 }),
    ];
    expect(ids(routeFollowsList(tasks, DAY), "dayMapOrder")).toEqual(["a", "y"]);
  });

  it("orders old-format stops (a period, no order) too", () => {
    const old = (uuid, start, orderIndex) => ({ uuid, horizonLevel: "today", timeEstimateMinutes: 30, dayMapDate: DAY, dayMapPeriod: "morning", dayMapStartMinutes: start, orderIndex });
    const tasks = [old("a", 540, 1), old("b", 570, 0), old("c", 600, 2)];
    expect(ids(routeFollowsList(tasks, DAY), "dayMapOrder")).toEqual(["b", "a", "c"]);
  });

  it("times the route again from its start, so no stored time is left on the old order", () => {
    const tasks = [
      stop("a", 0, 30, { orderIndex: 1, dayMapStartMinutes: 540 }),
      stop("b", 1, 30, { orderIndex: 0, dayMapStartMinutes: 570 }),
    ];
    const t = byId(routeFollowsList(tasks, DAY, { nowMinutes: 480 }));
    expect([t.b.dayMapStartMinutes, t.a.dayMapStartMinutes]).toEqual([540, 575]); // 5 min buffer between stops
  });

  it("changes nothing when the orders already agree", () => {
    const tasks = [stop("a", 0, 30, { orderIndex: 0 }), stop("b", 1, 30, { orderIndex: 1 })];
    const next = routeFollowsList(tasks, DAY);
    expect(next[0]).toBe(tasks[0]);
    expect(next[1]).toBe(tasks[1]);
  });
});

describe("joinRoute (Q59: every open Today task is on the route)", () => {
  const ids = (tasks) => tasks.filter(t => t.dayMapDate === DAY && t.dayMapOrder != null).sort((a, b) => a.dayMapOrder - b.dayMapOrder).map(t => t.uuid);
  const today = (uuid, orderIndex, extra = {}) => ({ uuid, title: uuid, horizonLevel: "today", timeEstimateMinutes: 30, orderIndex, ...extra });

  it("puts a task not on the route on it, in the list's order", () => {
    const tasks = [stop("a", 0, 30, { orderIndex: 0 }), today("n", 1), stop("b", 1, 30, { orderIndex: 2 })];
    expect(ids(joinRoute(tasks, DAY))).toEqual(["a", "n", "b"]);
  });

  it("takes yesterday's stops onto today's route, and the one thing at its head", () => {
    const tasks = [
      stop("a", 0, 30, { orderIndex: 0 }),
      today("old", 1, { dayMapDate: "2026-09-28", dayMapOrder: 0, dayMapStartMinutes: 600 }),
      today("one", 2, { isNowFocus: true }),
    ];
    const next = joinRoute(tasks, DAY);
    expect(ids(next)).toEqual(["one", "a", "old"]);
    expect(next.find(t => t.uuid === "old").dayMapStartMinutes).toBeUndefined();
  });

  it("keeps an old-format one thing (a period, no order) ahead of a task that joins", () => {
    const tasks = [
      today("one", 0, { isNowFocus: true, dayMapDate: DAY, dayMapPeriod: "morning", dayMapStartMinutes: 540 }),
      today("n", 1),
    ];
    expect(ids(joinRoute(tasks, DAY))).toEqual(["one", "n"]);
  });

  it("leaves out done, parked, deleted and moved-to-tomorrow tasks, and does nothing when all are on", () => {
    const tasks = [
      stop("a", 0, 30, { orderIndex: 0 }),
      today("d", 1, { isCompleted: true }),
      today("p", 2, { isParked: true }),
      today("x", 3, { isDeleted: true }),
      today("t", 4, { deferredUntil: "2026-09-30", dayMapDate: "2026-09-30", dayMapOrder: -1 }),
      today("w", 5, { horizonLevel: "week" }),
    ];
    expect(joinRoute(tasks, DAY)).toBeNull();
  });
});
