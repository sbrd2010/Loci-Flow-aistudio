import { describe, it, expect } from "vitest";
import { oneThingToNow, restoreRoute } from "./useDayRoute";

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
    const bare = ({ dayMapDate, dayMapOrder, dayMapStartMinutes, ...t }) => t; // eslint-disable-line no-unused-vars
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
