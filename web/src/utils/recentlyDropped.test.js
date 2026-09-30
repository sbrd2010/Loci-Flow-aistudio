import { describe, expect, it } from "vitest";
import { droppedLine, recentlyDropped, restoreDropped } from "./recentlyDropped";

const DAY = 86400000;
const now = Date.UTC(2026, 8, 30, 12);

describe("Recently dropped", () => {
  const tasks = [
    { uuid: "new", isDeleted: true, deletedAt: now - DAY * 3, horizonLevel: "week" },
    { uuid: "today", isDeleted: true, deletedAt: now - 1000, horizonLevel: "gone" },
    { uuid: "old", isDeleted: true, deletedAt: now - DAY * 31, horizonLevel: "week" },
    { uuid: "split", isDeleted: true, horizonLevel: "week" },
    { uuid: "live", horizonLevel: "week" },
  ];
  it("dropped in the last 30 days, newest first; a split's original isn't listed", () => {
    expect(recentlyDropped(tasks, now).map(t => t.uuid)).toEqual(["today", "new"]);
  });
  it("says when and how long it stays", () => {
    expect(droppedLine(tasks[0], now)).toBe("Dropped 3 days ago · 27 days left");
    expect(droppedLine(tasks[1], now)).toBe("Dropped today · 30 days left");
  });
  it("Restore puts it back; a task whose horizon is gone lands in This week", () => {
    const p = restoreDropped({ tasks, config: {} }, "today", "2026-09-30", now);
    expect(p.tasks.find(t => t.uuid === "today")).toMatchObject({ isDeleted: false, deletedAt: null, horizonLevel: "week", orderIndex: 1 });
    const q = restoreDropped({ tasks, config: {} }, "new", "2026-09-30", now);
    expect(q.tasks.find(t => t.uuid === "new").horizonLevel).toBe("week");
  });
});

// Codex review of #445: This week hidden too → the first horizon shown.
it("Restore falls back to a shown horizon when This week is hidden", () => {
  const tasks = [{ uuid: "x", isDeleted: true, deletedAt: 1, horizonLevel: "gone" }];
  const p = restoreDropped({ tasks, config: { horizons: { week: { hidden: true } } } }, "x", "2026-09-30", 2);
  expect(p.tasks[0].horizonLevel).toBe("month");
});
