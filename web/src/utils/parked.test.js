import { describe, it, expect } from "vitest";
import { parkedTasks, parkedSince, restoreParked, undoRestoreParked } from "./parked";

const T = (uuid, extra = {}) => ({ uuid, title: uuid, horizonLevel: "today", orderIndex: 0, ...extra });

describe("parked", () => {
  it("lists open parked tasks, oldest first", () => {
    const tasks = [
      T("a", { isParked: true, parkedAt: 300 }),
      T("b", { isParked: true, lastUpdated: 100 }),
      T("c", { isParked: true, isDeleted: true }),
      T("d", { isParked: true, isCompleted: true }),
      T("e"),
    ];
    expect(parkedTasks(tasks).map(t => t.uuid)).toEqual(["b", "a"]);
    expect(parkedSince(tasks[1])).toBe(100);
  });

  it("restores to the bottom of Today and undoes back", () => {
    const tasks = [T("x", { orderIndex: 4 }), T("y", { orderIndex: 2 }), T("p", { isParked: true, horizonLevel: "month", orderIndex: 1, deferredUntil: "2026-10-02" })];
    const { tasks: next, before } = restoreParked(tasks, "p", 9);
    const p = next.find(t => t.uuid === "p");
    expect(p).toMatchObject({ isParked: false, horizonLevel: "today", orderIndex: 5, deferredUntil: null });
    const back = undoRestoreParked(next, "p", before, 10).find(t => t.uuid === "p");
    expect(back).toMatchObject({ isParked: true, horizonLevel: "month", orderIndex: 1, deferredUntil: "2026-10-02" });
  });

  it("undo leaves a task alone once it changed again", () => {
    const { tasks: next, before } = restoreParked([T("p", { isParked: true, horizonLevel: "week" })], "p");
    const done = next.map(t => ({ ...t, isCompleted: true }));
    expect(undoRestoreParked(done, "p", before)[0].isParked).toBe(false);
  });

  it("ignores a task that isn't parked", () => {
    const tasks = [T("p")];
    expect(restoreParked(tasks, "p").before).toBeNull();
  });
});
