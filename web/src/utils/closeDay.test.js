import { describe, expect, it } from "vitest";
import { applyClose, closeLineDue, defaultChoice, isDayClosed, leftovers, pinFirstThing, reopenDay, undoClose } from "./closeDay";

const DAY = "2026-09-30";
const TOMORROW = "2026-10-01";
const t = (uuid, extra = {}) => ({ uuid, title: uuid, horizonLevel: "today", orderIndex: 0, ...extra });

describe("Close the day (55d–e, Q47)", () => {
  const tasks = [
    t("a", { orderIndex: 1 }),
    t("b", { orderIndex: 0, isNowFocus: true }),
    t("r", { orderIndex: 2, reviewFrom: { label: "FROM SEPTEMBER", day: "2026-09-29", horizon: "month" } }),
    t("done", { isCompleted: true, dateCompletedString: DAY }),
    t("later", { deferredUntil: TOMORROW }),
    t("wk", { horizonLevel: "week" }),
  ];

  it("leftovers: open and on Today now, the one thing first", () => {
    expect(leftovers(tasks, DAY).map(x => x.uuid)).toEqual(["b", "a", "r"]);
  });

  it("Tomorrow by default; Plan for a review's task left over again (47.1)", () => {
    expect(defaultChoice(tasks[0])).toBe("tomorrow");
    expect(defaultChoice(tasks[2])).toBe("plan");
  });

  it("closes: Tomorrow (first thing heads it), Plan back to its horizon, Drop; logged for Coach", () => {
    const before = { tasks, config: {} };
    const after = applyClose(before, { day: DAY, choices: { b: "drop" }, firstThing: "a", note: " Good day ", summary: { focusMin: 185 } }, 9);
    const by = Object.fromEntries(after.tasks.map(x => [x.uuid, x]));
    expect(by.a).toMatchObject({ deferredUntil: TOMORROW });
    expect(by.a.orderIndex).toBeLessThan(0);
    expect(by.r).toMatchObject({ horizonLevel: "month", deferredUntil: null, isNowFocus: false });
    expect(by.b).toMatchObject({ isDeleted: true, deletedAt: 9, isNowFocus: false });
    expect(after.config.dayClose).toEqual({ day: DAY, at: 9, firstThing: "a", reopened: false });
    expect(after.config.dayCloseLog).toEqual([{ day: DAY, done: 1, tomorrow: 1, planned: 1, dropped: 1, focusMin: 185, minimum: null, note: "Good day", firstThing: "a", at: 9 }]);
    // 47.2: the line is where the evening reflection's note was.
    expect(after.config).toMatchObject({ dailyReflectionDate: DAY, dailyReflectionNote: "Good day", dailyReflectionMood: null });
    expect(isDayClosed(after.config, DAY)).toBe(true);
    expect(leftovers(after.tasks, DAY)).toEqual([]);

    // Undo within 10 s: all back, the day open.
    const back = undoClose(after, before, DAY);
    expect(leftovers(back.tasks, DAY).map(x => x.uuid)).toEqual(["b", "a", "r"]);
    expect(isDayClosed(back.config, DAY)).toBe(false);
    // …and the line is gone from Coach's reflection too.
    expect(back.config).toMatchObject({ dailyReflectionDate: null, dailyReflectionNote: null, dailyReflectionCompletedAt: null });
  });

  it("closing with no line still counts as the evening reflection; an earlier one is kept", () => {
    const bare = applyClose({ tasks, config: {} }, { day: DAY }, 5);
    expect(bare.config).toMatchObject({ dailyReflectionDate: DAY, dailyReflectionNote: "", dailyReflectionCompletedAt: 5 });
    const earlier = { dailyReflectionDate: DAY, dailyReflectionMood: "ok", dailyReflectionNote: "Earlier" };
    const kept = applyClose({ tasks, config: earlier }, { day: DAY }, 6);
    expect(kept.config).toMatchObject({ dailyReflectionMood: "ok", dailyReflectionNote: "Earlier", dailyReflectionCompletedAt: 6 });
    expect(undoClose(kept, { tasks, config: earlier }, DAY).config).toMatchObject({ ...earlier, dailyReflectionCompletedAt: null });
  });

  it("Undo puts back what the close changed and keeps what changed since, for the day that was closed", () => {
    const before = { tasks, config: {} };
    const after = applyClose(before, { day: DAY, choices: { b: "drop" } }, 9);
    // Since the close, "a" was renamed on another device and "r" sent to the Week.
    const now = { ...after, tasks: after.tasks.map(x => (x.uuid === "a" ? { ...x, title: "a2", lastUpdated: 12 } : x.uuid === "r" ? { ...x, horizonLevel: "week", lastUpdated: 12 } : x)) };
    // Undo lands after midnight: the day passed is the one closed, not the new one.
    const back = undoClose(now, before, DAY, after);
    const by = Object.fromEntries(back.tasks.map(x => [x.uuid, x]));
    expect(by.a).toMatchObject({ title: "a2", horizonLevel: "today", orderIndex: 1 });
    expect(by.a.deferredUntil).toBeUndefined();
    expect(by.b.isNowFocus).toBe(true);
    expect("isDeleted" in by.b || "deletedAt" in by.b).toBe(false);
    expect(by.r.horizonLevel).toBe("week");
  });

  it("Reopen: open again, what was moved stays moved (47.3)", () => {
    const closed = applyClose({ tasks, config: {} }, { day: DAY }, 1);
    const reopened = reopenDay(closed.config, 2);
    expect(isDayClosed(reopened, DAY)).toBe(false);
    expect(closed.tasks.find(x => x.uuid === "a").deferredUntil).toBe(TOMORROW);
  });

  it("the next day, the first thing becomes the one thing, once", () => {
    const closed = applyClose({ tasks, config: {} }, { day: DAY, firstThing: "a" }, 1);
    const next = pinFirstThing(closed, TOMORROW, 2);
    expect(next.tasks.find(x => x.uuid === "a").isNowFocus).toBe(true);
    expect(next.config.dayClose.pinnedOn).toBe(TOMORROW);
    expect(pinFirstThing(next, TOMORROW, 3)).toBe(null);
    // Not the same day it was closed.
    expect(pinFirstThing(closed, DAY, 2)).toBe(null);
  });

  it("the line shows from 30 minutes before the day ends, until closed", () => {
    expect(closeLineDue(17 * 60, 17 * 60 + 30, false)).toBe(true);
    expect(closeLineDue(16 * 60 + 59, 17 * 60 + 30, false)).toBe(false);
    expect(closeLineDue(17 * 60 + 10, 17 * 60 + 30, true)).toBe(false);
  });
});
