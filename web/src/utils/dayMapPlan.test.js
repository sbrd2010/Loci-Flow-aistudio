import { describe, expect, it } from "vitest";
import { dayLeftFrom, formatClock24, formatSpan, moveToTomorrow, nextDateStr, planDay, restoreSchedule } from "./dayMapPlan";

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
  it("skips the gaps between windows", () => {
    const split = [{ startMin: 540, endMin: 720, overnight: false }, { startMin: 780, endMin: 1020, overnight: false }];
    expect(dayLeftFrom(600, new Date("2026-09-23T10:00:00"), split)).toBe(120 + 240);
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
});
