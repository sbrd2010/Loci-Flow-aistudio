import { describe, it, expect } from "vitest";
import { clearMyDay, clearMyDayPlan, undoClearMyDay } from "./clearMyDay";

const TODAY = "2026-10-01";
const t = (uuid, extra = {}) => ({ uuid, title: uuid, horizonLevel: "today", orderIndex: 0, isCompleted: false, lastUpdated: 1, ...extra });
const tasks = [
  t("one", { isNowFocus: true, orderIndex: 0 }),
  t("a", { orderIndex: 2 }),
  t("b", { orderIndex: 1 }),
  t("call", { dayMapFixedMinutes: 600, dayMapDate: TODAY, orderIndex: 3 }),
  t("done", { isCompleted: true }),
  t("parked", { isParked: true }),
  t("w1", { horizonLevel: "week", orderIndex: 4 }),
];

describe("clearMyDay", () => {
  it("plans Today's open tasks minus fixed times and the kept one thing", () => {
    const plan = clearMyDayPlan(tasks, { todayStr: TODAY, keepUuid: "one" });
    expect(plan.openCount).toBe(4);
    expect(plan.fixedCount).toBe(1);
    expect(plan.movable.map(x => x.uuid)).toEqual(["b", "a"]);
    expect(clearMyDayPlan(tasks, { todayStr: TODAY }).movable.map(x => x.uuid)).toEqual(["one", "b", "a"]);
  });

  it("moves to This week at the bottom, in order, and unpins", () => {
    const r = clearMyDay(tasks, { dest: "week", todayStr: TODAY, now: 9 });
    const byId = Object.fromEntries(r.tasks.map(x => [x.uuid, x]));
    expect(byId.b).toMatchObject({ horizonLevel: "week", orderIndex: 6, lastUpdated: 9 });
    expect(byId.a).toMatchObject({ horizonLevel: "week", orderIndex: 7 });
    expect(byId.one).toMatchObject({ horizonLevel: "week", orderIndex: 5, isNowFocus: false });
    expect(byId.call.horizonLevel).toBe("today");
    expect(byId.done).toBe(tasks[4]);
  });

  it("parks, or moves to tomorrow", () => {
    const parked = clearMyDay(tasks, { dest: "park", todayStr: TODAY, keepUuid: "one", now: 9 });
    expect(parked.tasks.filter(x => x.isParked && x.parkedAt === 9).map(x => x.uuid)).toEqual(["a", "b"]);
    const tomorrow = clearMyDay(tasks, { dest: "tomorrow", todayStr: TODAY, keepUuid: "one", now: 9 });
    expect(tomorrow.tasks.find(x => x.uuid === "a").deferredUntil).toBe("2026-10-02");
    expect(tomorrow.tasks.find(x => x.uuid === "one").isNowFocus).toBe(true);
  });

  it("returns null when nothing would move", () => {
    expect(clearMyDay([t("one", { isNowFocus: true })], { todayStr: TODAY, keepUuid: "one" })).toBe(null);
  });

  it("Undo puts every moved task back, unless it changed since", () => {
    const r = clearMyDay(tasks, { dest: "week", todayStr: TODAY, now: 9 });
    const touched = r.tasks.map(x => (x.uuid === "a" ? { ...x, title: "edited", lastUpdated: 10 } : x));
    const undone = undoClearMyDay(touched, r);
    expect(undone.find(x => x.uuid === "one")).toEqual(tasks[0]);
    expect(undone.find(x => x.uuid === "b")).toEqual(tasks[2]);
    expect(undone.find(x => x.uuid === "a").title).toBe("edited");
  });
});
