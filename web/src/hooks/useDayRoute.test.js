import { describe, it, expect } from "vitest";
import { oneThingToNow } from "./useDayRoute";

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
