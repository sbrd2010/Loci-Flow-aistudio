import { describe, expect, it } from "vitest";
import { horizonsFromConfig } from "./horizons";
import { dayLabel, doneTasks, ladderRungs, listTasks, openingRung, runwayLabelsShown, runwayTicks, workOlderCount } from "./planLadder";

const day = "2026-09-28"; // Mon, the 57 sample date
const hs = horizonsFromConfig({}, day);
const t = (uuid, horizonLevel, extra = {}) => ({ uuid, horizonLevel, title: uuid, ...extra });

describe("ladder rungs (57)", () => {
  const tasks = [t("a", "week"), t("b", "week", { isCompleted: true }), t("c", "month"), t("d", "week", { isParked: true })];
  const rungs = ladderRungs(tasks, hs, day);

  it("one per visible horizon, counting open tasks only (42.2)", () => {
    expect(rungs.map(r => [r.id, r.count])).toEqual([["week", 1], ["month", 1], ["quarter", 0], ["halfyear", 0]]);
  });

  it("days left, red at ≤3, and how much of the period has gone", () => {
    const week = rungs[0];
    expect(week.daysLeft).toBe(6);
    expect(week.red).toBe(false);
    expect(week.elapsed).toBeCloseTo(1 / 7);
    const month = rungs[1];
    expect(month.daysLeft).toBe(2);
    expect(month.red).toBe(true);
  });

  it("6 months is dotted and never red", () => {
    const six = rungs[3];
    expect(six.dotted).toBe(true);
    expect(six.red).toBe(false);
  });

  it("hidden horizons are left off", () => {
    const hidden = horizonsFromConfig({ horizons: { quarter: { hidden: true } } }, day);
    expect(ladderRungs([], hidden, day).map(r => r.id)).toEqual(["week", "month", "halfyear"]);
  });
});

describe("the open list and its Done fold", () => {
  it("pinned first, then the manual order (42.4)", () => {
    const tasks = [
      t("x", "week", { orderIndex: 2 }),
      t("y", "week", { orderIndex: 0 }),
      t("z", "week", { orderIndex: 5, isHorizonPinned: true }),
    ];
    expect(listTasks(tasks, "week").map(x => x.uuid)).toEqual(["z", "y", "x"]);
  });

  it("Done · N: finished in this period, oldest first (42.2)", () => {
    const tasks = [
      t("late", "week", { isCompleted: true, dateCompletedString: "2026-09-30" }),
      t("early", "week", { isCompleted: true, dateCompletedString: "2026-09-28" }),
      t("before", "week", { isCompleted: true, dateCompletedString: "2026-09-20" }),
    ];
    expect(doneTasks(tasks, "week", { start: "2026-09-28", end: "2026-10-04" }).map(x => x.uuid)).toEqual(["early", "late"]);
  });

  it("Work · older counts the old Work horizon's open tasks", () => {
    expect(workOlderCount([t("w", "office"), t("v", "office", { isCompleted: true })])).toBe(1);
  });
});

describe("the runway", () => {
  it("one tick per end date; same-date ends share one, smallest first (42.3)", () => {
    const rungs = ladderRungs([], hs, "2026-09-28");
    const ticks = runwayTicks(rungs, "2026-09-28");
    expect(ticks.map(x => x.label)).toEqual(["SEP · Q3", "4 OCT", "31 MAR"]);
    const shared = ticks.find(x => x.end === "2026-09-30");
    expect(shared.label).toBe("SEP · Q3");
    expect(ticks[ticks.length - 1].furthest).toBe(true);
    expect(ticks[ticks.length - 1].at).toBe(1);
  });

  it("labels need 45px from the last one; a phone shows only the ends (57b.30)", () => {
    const ticks = [
      { end: "a", at: 0.05, furthest: false },
      { end: "b", at: 0.5, furthest: false },
      { end: "c", at: 1, furthest: true },
    ];
    expect([...runwayLabelsShown(ticks, 400)]).toEqual(["b", "c"]);
    expect([...runwayLabelsShown(ticks, 400, true)]).toEqual(["c"]);
  });
});

describe("which rung Plan opens on (42.1)", () => {
  const rungs = ladderRungs([], hs, day);
  it("the last one opened, if it's still there", () => {
    expect(openingRung(rungs, "quarter")).toBe("quarter");
  });
  it("otherwise This week", () => {
    expect(openingRung(rungs, "gone")).toBe("week");
    expect(openingRung(rungs, null)).toBe("week");
  });
});

it("dayLabel: SUN 4 OCT, with the year when it isn't this one", () => {
  expect(dayLabel("2026-10-04", day)).toBe("SUN 4 OCT");
  expect(dayLabel("2027-03-31", day)).toBe("WED 31 MAR 2027");
});
