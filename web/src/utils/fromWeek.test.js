import { describe, it, expect } from "vitest";
import { weekTasks, pullFromWeek, undoPullFromWeek } from "./fromWeek";

const t = (uuid, extra = {}) => ({ uuid, title: uuid, horizonLevel: "week", orderIndex: 0, isDeleted: false, isCompleted: false, lastUpdated: 1, ...extra });

describe("weekTasks", () => {
  it("lists open This week tasks in their order", () => {
    const tasks = [t("b", { orderIndex: 2 }), t("a", { orderIndex: 1 }), t("done", { isCompleted: true }), t("parked", { isParked: true }), t("today", { horizonLevel: "today" })];
    expect(weekTasks(tasks).map(x => x.uuid)).toEqual(["a", "b"]);
  });
});

describe("pullFromWeek", () => {
  it("moves the chosen tasks to the bottom of Today in the order picked; the first is the one thing", () => {
    const tasks = [t("x", { horizonLevel: "today", orderIndex: 4 }), t("a"), t("b", { dayMapOrder: 3, dayMapDate: "2024-06-14" })];
    const { tasks: next, before } = pullFromWeek(tasks, ["b", "a"], 99);
    const b = next.find(x => x.uuid === "b");
    const a = next.find(x => x.uuid === "a");
    expect([b.horizonLevel, b.orderIndex, b.isNowFocus, b.lastUpdated]).toEqual(["today", 5, true, 99]);
    expect([a.horizonLevel, a.orderIndex, a.isNowFocus]).toEqual(["today", 6, false]);
    expect(b.dayMapOrder).toBeUndefined();
    expect(before).toEqual([{ uuid: "b", horizonLevel: "week", orderIndex: 0 }, { uuid: "a", horizonLevel: "week", orderIndex: 0 }]);
  });

  it("takes the one thing from whatever held it", () => {
    const tasks = [t("held", { horizonLevel: "month", isNowFocus: true }), t("a")];
    const { tasks: next } = pullFromWeek(tasks, ["a"], 5);
    expect(next.find(x => x.uuid === "held").isNowFocus).toBe(false);
    expect(next.find(x => x.uuid === "a").isNowFocus).toBe(true);
  });

  it("ignores tasks that aren't open This week tasks", () => {
    const tasks = [t("a", { horizonLevel: "today" }), t("gone", { isDeleted: true })];
    expect(pullFromWeek(tasks, ["a", "gone", "missing"], 5)).toEqual({ tasks, before: [] });
  });
});

describe("undoPullFromWeek", () => {
  // Codex review of #486: the route takes the moved tasks in at once
  // (joinRoute), giving them route fields and a new lastUpdated.
  it("puts back tasks the route has since taken in, without their route fields", () => {
    const { tasks: moved, before } = pullFromWeek([t("a", { orderIndex: 2 })], ["a"], 50);
    const routed = moved.map(x => ({ ...x, dayMapDate: "2024-06-15", dayMapOrder: 0, lastUpdated: 55 }));
    const back = undoPullFromWeek(routed, before, 70).find(x => x.uuid === "a");
    expect(back).toMatchObject({ horizonLevel: "week", orderIndex: 2, isNowFocus: false, lastUpdated: 70 });
    expect(back.dayMapDate).toBeUndefined();
    expect(back.dayMapOrder).toBeUndefined();
  });

  it("puts back the moved tasks still open in Today; a done one stays", () => {
    const tasks = [t("a", { orderIndex: 2 }), t("b", { orderIndex: 3 }), t("c", { orderIndex: 4 })];
    const { tasks: moved, before } = pullFromWeek(tasks, ["a", "b", "c"], 50);
    const later = moved.map(x => x.uuid === "b" ? { ...x, isCompleted: true, lastUpdated: 60 } : x.uuid === "c" ? { ...x, horizonLevel: "month", lastUpdated: 61 } : x);
    const back = undoPullFromWeek(later, before, 70);
    expect(back.find(x => x.uuid === "a")).toMatchObject({ horizonLevel: "week", orderIndex: 2, isNowFocus: false, lastUpdated: 70 });
    expect(back.find(x => x.uuid === "b").horizonLevel).toBe("today");
    expect(back.find(x => x.uuid === "c").horizonLevel).toBe("month");
  });
});
