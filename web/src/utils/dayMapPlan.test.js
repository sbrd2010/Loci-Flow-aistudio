import { describe, expect, it } from "vitest";
import { bringBack, dayLeftFrom, dayProgress, formatClock24, formatSpan, moveToTomorrow, nextDateStr, planDay, restoreSchedule } from "./dayMapPlan";

const stop = (id, start, dur) => ({ uuid: id, dayMapStartMinutes: start, dayMapDurationMinutes: dur });

describe("formatClock24 / formatSpan", () => {
  it("draws the timeline's 24-hour times", () => {
    expect(formatClock24(660)).toBe("11:00");
    expect(formatClock24(970)).toBe("16:10");
    expect(formatClock24(1440 + 105)).toBe("01:45");
  });
  it("draws durations the way the header clock does", () => {
    expect(formatSpan(25)).toBe("25m");
    expect(formatSpan(180)).toBe("3h");
    expect(formatSpan(85)).toBe("1h25m");
    expect(formatSpan(890)).toBe("14h50m");
    expect(formatSpan(245)).toBe("4h05m");
  });
});

describe("dayLeftFrom", () => {
  const windows = [{ startMin: 420, endMin: 970, overnight: false }]; // 07:00–16:10
  it("is the focus time from the route's start to the end of the last window", () => {
    expect(dayLeftFrom(630, new Date("2026-09-23T10:00:00"), windows)).toBe(340); // 10:30 → 16:10 = 5h40m
  });
  it("runs on the clock through the gaps, to the end of the last window", () => {
    // 09:00–12:00 and 14:00–17:00, from 10:00: the day ends at 17:00.
    const split = [{ startMin: 540, endMin: 720, overnight: false }, { startMin: 840, endMin: 1020, overnight: false }];
    expect(dayLeftFrom(600, new Date("2026-09-23T10:00:00"), split)).toBe(420);
  });
  it("follows a window that runs past midnight", () => {
    const late = [{ startMin: 420, endMin: 120, overnight: true }]; // 07:00–02:00
    expect(dayLeftFrom(1260, new Date("2026-09-23T21:00:00"), late)).toBe(300);
    expect(dayLeftFrom(30, new Date("2026-09-24T00:30:00"), late)).toBe(90);
  });
  it("is zero once the windows are over", () => {
    expect(dayLeftFrom(1000, new Date("2026-09-23T16:40:00"), windows)).toBe(0);
  });
});

describe("planDay", () => {
  it("fits when every stop starts before the day ends", () => {
    const plan = planDay([stop("a", 630, 25), stop("b", 660, 25)], 630, 340);
    expect(plan.dayEnd).toBe(970);
    expect(plan.overIndex).toBe(-1);
    expect(plan.wontFit).toEqual([]);
    expect(plan.overBy).toBe(0);
    expect(plan.planned).toBe(55);
    expect(plan.runsPast).toBeNull();
  });

  it("splits the route at the day end, and names the stop that runs past it", () => {
    const route = [stop("a", 630, 25), stop("b", 875, 180), stop("c", 1060, 90), stop("d", 1155, 60)];
    const plan = planDay(route, 630, 340);
    expect(plan.overIndex).toBe(2);
    expect(plan.wontFit.map(t => t.uuid)).toEqual(["c", "d"]);
    expect(plan.runsPast).toEqual({ task: route[1], by: 875 + 180 - 970 });
    expect(plan.planned).toBe(1215 - 630);
    expect(plan.overBy).toBe(1215 - 970);
  });

  it("counts a stop that starts exactly on the line as not fitting", () => {
    expect(planDay([stop("a", 630, 25), stop("b", 970, 25)], 630, 340).overIndex).toBe(1);
  });

  it("ends a stop split by a break where its last part ends", () => {
    // 11:35 for 3h with a 40-minute lunch: it ends at 15:15, not 14:35.
    const plan = planDay([{ ...stop("a", 695, 180), routeEndMinutes: 915 }], 695, 200);
    expect(plan.planned).toBe(220);
    expect(plan.runsPast).toMatchObject({ by: 20 });
  });

  it("puts everything past the line when no focus time is left", () => {
    const plan = planDay([stop("a", 1000, 25)], 1000, 0);
    expect(plan.overIndex).toBe(0);
    expect(plan.wontFit).toHaveLength(1);
  });
});

describe("nextDateStr", () => {
  it("crosses months and years", () => {
    expect(nextDateStr("2026-09-23")).toBe("2026-09-24");
    expect(nextDateStr("2026-09-30")).toBe("2026-10-01");
    expect(nextDateStr("2026-12-31")).toBe("2027-01-01");
  });
});

describe("moveToTomorrow / restoreSchedule", () => {
  const tasks = [
    { uuid: "a", title: "A", dayMapDate: "2026-09-23", dayMapOrder: 0, dayMapStartMinutes: 630, dayMapDurationMinutes: 25, dayMapPeriod: "morning" },
    { uuid: "b", title: "B", dayMapDate: "2026-09-23", dayMapOrder: 1, dayMapStartMinutes: 1060, dayMapDurationMinutes: 90, dayMapPeriod: "evening" },
    { uuid: "c", title: "C", dayMapDate: "2026-09-23", dayMapOrder: 2, dayMapStartMinutes: 1155, dayMapDurationMinutes: 60, dayMapPeriod: "evening" },
  ];

  it("puts them at the top of tomorrow's route, in order, with no start time yet", () => {
    const { tasks: next, before } = moveToTomorrow(tasks, ["b", "c"], "2026-09-24", 1);
    expect(next[0]).toBe(tasks[0]);
    expect(next[1]).toMatchObject({ dayMapDate: "2026-09-24", dayMapOrder: -2, dayMapDurationMinutes: 90 });
    expect(next[2]).toMatchObject({ dayMapDate: "2026-09-24", dayMapOrder: -1 });
    expect(next[1]).not.toHaveProperty("dayMapStartMinutes");
    expect(next[1]).not.toHaveProperty("dayMapPeriod");
    expect(before.map(t => t.uuid)).toEqual(["b", "c"]);
  });

  it("takes them off today until tomorrow, at the top of tomorrow's list, unpinned", () => {
    const withPin = tasks.map(t => t.uuid === "b" ? { ...t, isNowFocus: true, orderIndex: 4 } : t);
    const { tasks: next } = moveToTomorrow(withPin, ["b", "c"], "2026-09-24", 1);
    expect(next[1]).toMatchObject({ deferredUntil: "2026-09-24", orderIndex: -2, isNowFocus: false });
    expect(next[2]).toMatchObject({ deferredUntil: "2026-09-24", orderIndex: -1 });
  });

  it("a second move the same day queues after the first batch, still ahead of the list", () => {
    const { tasks: once } = moveToTomorrow(tasks, ["b", "c"], "2026-09-24", 1);
    const { tasks: twice } = moveToTomorrow(once, ["a"], "2026-09-24", 2);
    const order = Object.fromEntries(twice.map(t => [t.uuid, t.orderIndex]));
    expect(order.b).toBeLessThan(order.c);
    expect(order.c).toBeLessThan(order.a);
    expect(order.a).toBeLessThan(0);
    expect(twice.find(t => t.uuid === "a").dayMapOrder).toBe(order.a);
  });

  it("Undo gives the pin back, unless another task was pinned since", () => {
    const withPin = tasks.map(t => t.uuid === "b" ? { ...t, isNowFocus: true, orderIndex: 4 } : t);
    const { tasks: moved, before } = moveToTomorrow(withPin, ["b"], "2026-09-24", 1);
    const back = restoreSchedule(moved, before, 2);
    expect(back[1]).toMatchObject({ isNowFocus: true, orderIndex: 4 });
    expect(back[1]).not.toHaveProperty("deferredUntil");
    const repinned = moved.map(t => t.uuid === "a" ? { ...t, isNowFocus: true } : t);
    expect(restoreSchedule(repinned, before, 2)[1].isNowFocus).toBe(false);
  });

  it("Undo puts the schedule back and keeps other edits made since", () => {
    const { tasks: moved, before } = moveToTomorrow(tasks, ["b", "c"], "2026-09-24", 1);
    const edited = moved.map(t => t.uuid === "b" ? { ...t, title: "B, renamed" } : t);
    const back = restoreSchedule(edited, before, 2);
    expect(back[1]).toMatchObject({ title: "B, renamed", dayMapDate: "2026-09-23", dayMapOrder: 1, dayMapStartMinutes: 1060, dayMapPeriod: "evening" });
    expect(back[2]).toMatchObject({ dayMapDate: "2026-09-23", dayMapOrder: 2, dayMapStartMinutes: 1155 });
  });

  it("a fixed time stays with today: moved, the task flows; Undo fixes it again", () => {
    const fixed = tasks.map(t => t.uuid === "b" ? { ...t, dayMapFixedMinutes: 1060 } : t);
    const { tasks: moved, before } = moveToTomorrow(fixed, ["b"], "2026-09-24", 1);
    expect(moved[1]).not.toHaveProperty("dayMapFixedMinutes");
    expect(restoreSchedule(moved, before, 2)[1]).toMatchObject({ dayMapFixedMinutes: 1060, dayMapStartMinutes: 1060 });
  });
});

describe("bringBack (50h)", () => {
  const tasks = [
    { uuid: "a", title: "A", orderIndex: 0 },
    { uuid: "b", title: "B", orderIndex: 1, dayMapDate: "2026-09-23", dayMapOrder: 1, dayMapStartMinutes: 1060 },
    { uuid: "c", title: "C", orderIndex: 2 },
  ];

  it("returns a moved task to its old spot, on today and off tomorrow's route", () => {
    const { tasks: moved } = moveToTomorrow(tasks, ["b"], "2026-09-24", 1);
    expect(moved[1]).toMatchObject({ deferredFromOrder: 1, orderIndex: -1 });
    const { tasks: back, before } = bringBack(moved, "b", 2);
    expect(back[1].orderIndex).toBe(1);
    for (const f of ["deferredUntil", "deferredFromOrder", "dayMapDate", "dayMapOrder"]) expect(back[1]).not.toHaveProperty(f);
    expect(before.map(t => t.uuid)).toEqual(["b"]);
  });

  it("Undo sends it back to tomorrow as it was", () => {
    const { tasks: moved } = moveToTomorrow(tasks, ["b"], "2026-09-24", 1);
    const { tasks: back, before } = bringBack(moved, "b", 2);
    expect(restoreSchedule(back, before, 3)[1]).toMatchObject({ deferredUntil: "2026-09-24", orderIndex: -1, deferredFromOrder: 1, dayMapDate: "2026-09-24" });
  });

  it("a task with no old spot keeps its place at the top; one not moved is left alone", () => {
    const { tasks: moved } = moveToTomorrow([{ uuid: "n", title: "N" }], ["n"], "2026-09-24", 1);
    expect(moved[0]).not.toHaveProperty("deferredFromOrder");
    expect(bringBack(moved, "n", 2).tasks[0]).toMatchObject({ orderIndex: -1 });
    expect(bringBack(tasks, "a", 2).tasks).toBe(tasks);
  });
});

describe("dayProgress (50e–f)", () => {
  const at = (h, m) => new Date(2026, 8, 23, h, m);
  const win = (startMin, endMin, overnight = false) => ({ startMin, endMin, overnight });

  it("places now between the day's start and end", () => {
    const p = dayProgress(at(11, 35), [win(9 * 60, 17 * 60 + 15)]);
    expect(p).toMatchObject({ start: 540, end: 1035, now: 695 });
    expect(p.passed).toBeCloseTo(155 / 495, 5);
  });

  it("spans every window, and clamps before the start and after the end", () => {
    const windows = [win(14 * 60, 18 * 60), win(9 * 60, 12 * 60)];
    expect(dayProgress(at(7, 0), windows)).toMatchObject({ start: 540, end: 1080, passed: 0 });
    expect(dayProgress(at(20, 0), windows).passed).toBe(1);
  });

  it("runs past midnight for a window that does", () => {
    const p = dayProgress(at(1, 0), [win(20 * 60, 2 * 60, true)]);
    expect(p).toMatchObject({ start: 1200, end: 1560, now: 1500 });
    expect(p.passed).toBeCloseTo(300 / 360, 5);
  });

  it("is null with no windows", () => {
    expect(dayProgress(at(9, 0), [])).toBeNull();
  });
});

