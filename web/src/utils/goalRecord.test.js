import { describe, it, expect } from "vitest";
import { buildGoalRecord, goalStartDay, nextGoalTask, goalTaskDoneToday } from "./goalRecord";

const G = "front-1780000000000-abc123";
const done = (day, extra = {}) => ({ uuid: `d-${day}-${Math.random()}`, frontId: G, isCompleted: true, dateCompletedString: day, ...extra });

// 2026-10-01 is a Thursday.
describe("buildGoalRecord, all 7 days", () => {
  it("draws 7 rolling days ending today, oldest first", () => {
    const r = buildGoalRecord({ tasks: [], goalId: G, todayStr: "2026-10-01" });
    expect(r.days.map(d => d.day)).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(r.days[6].isToday).toBe(true);
  });

  it("counts a completed goal task on its Loci day; other fronts and deleted tasks don't count", () => {
    const tasks = [done("2026-09-28"), done("2026-09-30"), done("2026-09-29", { frontId: "front-other" }), done("2026-09-27", { isDeleted: true })];
    const r = buildGoalRecord({ tasks, goalId: G, todayStr: "2026-10-01" });
    expect(r.days.filter(d => d.done).map(d => d.day)).toEqual(["2026-09-28", "2026-09-30"]);
    expect(r.todayCounts).toBe(false);
    expect(r.sentence).toBe("2 of 6 past days had a goal task done. Today: not yet.");
  });

  it("once today counts, the sentence includes it", () => {
    const tasks = [done("2026-09-28"), done("2026-09-30"), done("2026-10-01")];
    const r = buildGoalRecord({ tasks, goalId: G, todayStr: "2026-10-01" });
    expect(r.todayCounts).toBe(true);
    expect(r.sentence).toBe("3 of 7 days had a goal task done, today included.");
  });

  it("leaves out days before the goal was set", () => {
    const r = buildGoalRecord({ tasks: [done("2026-09-26")], goalId: G, todayStr: "2026-10-01", startDay: "2026-09-30" });
    expect(r.days.map(d => d.day)).toEqual(["2026-09-30", "2026-10-01"]);
    expect(r.sentence).toBe("0 of 1 past day had a goal task done. Today: not yet.");
  });

  it("a goal set today says only 'Today: not yet.'", () => {
    const r = buildGoalRecord({ tasks: [], goalId: G, todayStr: "2026-10-01", startDay: "2026-10-01" });
    expect(r.days).toHaveLength(1);
    expect(r.sentence).toBe("Today: not yet.");
  });
});

describe("buildGoalRecord, weekdays only", () => {
  it("shows the last 5 weekdays; an empty weekend shows nothing", () => {
    const r = buildGoalRecord({ tasks: [], goalId: G, todayStr: "2026-10-01", mode: "weekdays" });
    expect(r.days.map(d => d.day)).toEqual(["2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(r.sentence).toBe("0 of 4 past weekdays had a goal task done. Today: not yet.");
  });

  it("a weekend day with a goal task done shows as a bonus and is named apart", () => {
    const tasks = [done("2026-09-27"), done("2026-09-29")];
    const r = buildGoalRecord({ tasks, goalId: G, todayStr: "2026-10-01", mode: "weekdays" });
    expect(r.days.map(d => [d.day, d.bonus])).toEqual([
      ["2026-09-25", false], ["2026-09-27", true], ["2026-09-28", false], ["2026-09-29", false], ["2026-09-30", false], ["2026-10-01", false],
    ]);
    expect(r.sentence).toBe("1 of 4 past weekdays had a goal task done, plus 1 weekend day. Today: not yet.");
  });

  it("on a weekend day there is no 'Today: not yet'", () => {
    // 2026-10-03 is a Saturday.
    const r = buildGoalRecord({ tasks: [done("2026-09-30")], goalId: G, todayStr: "2026-10-03", mode: "weekdays" });
    expect(r.days.map(d => d.day)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(r.sentence).toBe("1 of 5 weekdays had a goal task done.");
  });

  it("work done on a weekend today is a bonus", () => {
    const r = buildGoalRecord({ tasks: [done("2026-10-03")], goalId: G, todayStr: "2026-10-03", mode: "weekdays" });
    expect(r.days.at(-1)).toMatchObject({ day: "2026-10-03", isToday: true, bonus: true, done: true });
    expect(r.todayCounts).toBe(true);
    expect(r.sentence).toBe("0 of 5 weekdays had a goal task done, plus 1 weekend day.");
  });
});

describe("goalStartDay", () => {
  it("reads a front's creation day from its id", () => {
    const ms = new Date(2026, 8, 20, 9).getTime();
    expect(goalStartDay({ id: `front-${ms}-x1y2z3` })).toBe("2026-09-20");
  });
  it("uses the Key deadline's Started date", () => {
    expect(goalStartDay({ id: "front-key-deadline" }, { deadlineStartDate: "2026-09-15" })).toBe("2026-09-15");
    expect(goalStartDay({ id: "front-key-deadline" }, {})).toBe(null);
  });
});

describe("nextGoalTask", () => {
  const horizons = [{ id: "week" }, { id: "month" }];
  const t = (uuid, extra) => ({ uuid, frontId: G, isCompleted: false, ...extra });
  it("prefers Today's order, skipping the one thing", () => {
    const tasks = [t("pin", { horizonLevel: "today", isNowFocus: true, orderIndex: 0 }), t("b", { horizonLevel: "today", orderIndex: 2 }), t("a", { horizonLevel: "today", orderIndex: 1 }), t("w", { horizonLevel: "week", orderIndex: 0 })];
    expect(nextGoalTask({ tasks, goalId: G, todayStr: "2026-10-01", horizons }).uuid).toBe("a");
  });
  it("falls back to Plan's nearest horizon", () => {
    const tasks = [t("m", { horizonLevel: "month", orderIndex: 0 }), t("w", { horizonLevel: "week", orderIndex: 5 }), t("x", { horizonLevel: "week", frontId: "front-other" })];
    expect(nextGoalTask({ tasks, goalId: G, todayStr: "2026-10-01", horizons }).uuid).toBe("w");
  });
  it("skips a call at a set time, which is never the one thing", () => {
    const tasks = [t("call", { horizonLevel: "today", orderIndex: 0, fixedKind: "event", dayMapFixedMinutes: 600 }), t("w", { horizonLevel: "week", orderIndex: 0 })];
    expect(nextGoalTask({ tasks, goalId: G, todayStr: "2026-10-01", horizons }).uuid).toBe("w");
  });
  it("returns null when there's none", () => {
    expect(nextGoalTask({ tasks: [t("p", { horizonLevel: "week", isParked: true })], goalId: G, todayStr: "2026-10-01", horizons })).toBe(null);
  });
  it("finds the goal task done today", () => {
    expect(goalTaskDoneToday([done("2026-10-01", { title: "Send CV" })], G, "2026-10-01").title).toBe("Send CV");
  });
});
