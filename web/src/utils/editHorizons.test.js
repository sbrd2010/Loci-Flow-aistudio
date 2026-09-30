import { describe, expect, it } from "vitest";
import { horizonsFromConfig, currentPeriod } from "./horizons";
import { applyHorizonDelete, deleteTargets, horizonRule, horizonSentence, makeHorizon, moveHorizonEnd, moveSentence, undoHorizonDelete } from "./editHorizons";

const day = "2026-09-28"; // Mon

describe("Edit horizons (57g)", () => {
  const hs = horizonsFromConfig({}, day);
  it("each horizon's rule", () => {
    expect(hs.map(h => horizonRule(h, day))).toEqual([
      "MON – SUN · REVIEW EACH MONDAY",
      "CALENDAR MONTH · REVIEW ON THE 1ST",
      "CALENDAR QUARTER · REVIEW ON THE 1ST",
      "SLIDES MONTHLY · NO REVIEW",
    ]);
    const c = makeHorizon({ name: "Grant", endDate: "2026-11-30" }, day, "g");
    expect(horizonRule(c, day)).toBe("ENDS 30 NOV · REPEATS EVERY 64 DAYS");
  });

  it("a preset starts today (Q45); 2 weeks from this Monday", () => {
    const h = makeHorizon({ preset: "2w", name: "2 weeks" }, day, "a");
    expect(h).toMatchObject({ kind: "weeks", count: 2, startDate: day });
    expect(currentPeriod(h, day)).toEqual({ start: "2026-09-28", end: "2026-10-11" });
    expect(horizonSentence(h, day)).toBe("14 days from today, to SUN 11 OCT. When it ends, you review it and it repeats for another 2 weeks.");
  });

  it("Something else: a name and an end date; no name or a past date makes nothing", () => {
    expect(makeHorizon({ name: "Year", endDate: "2027-09-27" }, day, "y")).toMatchObject({ kind: "custom", lengthDays: 365 });
    expect(makeHorizon({ name: "  ", endDate: "2026-10-10" }, day, "x")).toBe(null);
    expect(makeHorizon({ name: "Old", endDate: "2026-09-01" }, day, "x")).toBe(null);
  });

  it("a new end date moves this period only (Q44.4)", () => {
    const h = makeHorizon({ name: "Sprint", endDate: "2026-10-27" }, day, "s"); // 30 days
    const moved = moveHorizonEnd(h, "2026-10-14", day);
    expect(currentPeriod(moved, day)).toEqual({ start: day, end: "2026-10-14" });
    expect(currentPeriod(moved, "2026-10-15").end).toBe("2026-11-13");
    expect(moveSentence(moved, "2026-10-14", day)).toBe("Ends 14 OCT, then every 30 days.");
  });
});

describe("deleting a horizon you added (Q44.3)", () => {
  const two = makeHorizon({ preset: "2w", name: "2 weeks" }, day, "two");
  const config = { horizons: { two } };
  const tasks = [
    { uuid: "a", horizonLevel: "two" },
    { uuid: "b", horizonLevel: "two" },
    { uuid: "c", horizonLevel: "two" },
    { uuid: "q", horizonLevel: "halfyear" },
  ];
  it("tasks default to the next larger visible horizon", () => {
    // 2 weeks ends 11 Oct: the quarter ends 30 Sep, 6 months 31 Mar.
    expect(deleteTargets(config, "two", day)).toEqual({ defaultTo: "halfyear", largerName: "6 months" });
  });
  it("each task goes where chosen, at the bottom of its list; Undo puts all back", () => {
    const before = { tasks, config };
    const after = applyHorizonDelete(before, "two", { a: "halfyear", b: "today", c: "drop" }, 5);
    expect(after.config.horizons.two).toBeUndefined();
    expect(after.tasks.find(t => t.uuid === "a")).toMatchObject({ horizonLevel: "halfyear", orderIndex: 1 });
    expect(after.tasks.find(t => t.uuid === "b").horizonLevel).toBe("today");
    expect(after.tasks.find(t => t.uuid === "c").isDeleted).toBe(true);
    const back = undoHorizonDelete(after, before, "two");
    expect(back.config.horizons.two).toEqual(two);
    expect(back.tasks.filter(t => t.horizonLevel === "two").map(t => t.uuid)).toEqual(["a", "b", "c"]);
    expect(back.tasks.find(t => t.uuid === "c").isDeleted).toBeUndefined();
  });
  it("a built-in can't be deleted", () => {
    expect(applyHorizonDelete({ tasks, config }, "week", {})).toEqual({ tasks, config });
  });
});
