import { describe, expect, it } from "vitest";
import { horizonsFromConfig } from "./horizons";
import { dayLabel, doneTasks, horizonChoices, ladderRungs, listTasks, openingRung, runwayLayout, runwayTicks, workOlderCount } from "./planLadder";

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
    expect(ticks.map(x => x.names.join(" · "))).toEqual(["This month · This quarter", "This week", "6 months"]);
    expect(ticks.map(x => x.date)).toEqual(["30 SEP", "4 OCT", "31 MAR 2027"]);
    expect(ticks[0].ids).toEqual(["month", "quarter"]);
    expect(ticks[ticks.length - 1].furthest).toBe(true);
    expect(ticks[ticks.length - 1].at).toBe(1);
  });

  // 76: x = √(days ÷ days to the furthest end): near dates get room.
  it("places ticks on a square-root scale", () => {
    const rungs = ladderRungs([], hs, "2026-09-28");
    const ticks = runwayTicks(rungs, "2026-09-28");
    // 6 of 184 days: linear would be 3%; √ puts it at 18%.
    expect(ticks.find(t => t.end === "2026-10-04").at).toBeCloseTo(Math.sqrt(6 / 184), 5);
  });

  // 76 (turn 77, 1): measured boxes, a 12px gap; neighbours merge, centred
  // between their ticks; the ends never merge or drop; the open one wins;
  // what still collides drops, its tick unlabelled. Each character is 8px
  // here, so a label's box is easy to reason about.
  const W = (text) => text.length * 8;
  const tick = (end, at, name, date, furthest = false) => ({ end, at, ids: [end], names: [name], date, furthest });
  const layout = (ticks, o = {}) => runwayLayout(ticks, { width: 1000, nameWidth: W, dateWidth: W, todayDate: "MON 5 OCT", ...o });

  it("merges two neighbours that would collide, centred between them", () => {
    const ticks = [tick("a", 0.25, "Career", "10 OCT"), tick("b", 0.26, "This week", "11 OCT"), tick("c", 0.6, "This quarter", "31 DEC"), tick("z", 1, "6 months", "30 APR 2027", true)];
    const { labels, unlabelled } = layout(ticks);
    const merged = labels.find(l => l.key === "a+b");
    expect(merged.names).toEqual(["Career", "This week"]);
    expect(merged.date).toBe("10–11 OCT");
    expect((merged.left + merged.right) / 2).toBeCloseTo(255, 5);
    expect(labels.map(l => l.key)).toEqual(["today", "a+b", "c", "z"]);
    expect([...unlabelled]).toEqual([]);
  });

  it("keeps Today and the far end; drops a label that would hit them", () => {
    const ticks = [tick("a", 0.02, "This week", "11 OCT"), tick("z", 1, "6 months", "30 APR 2027", true)];
    const { labels, unlabelled } = layout(ticks);
    expect(labels.map(l => l.key)).toEqual(["today", "z"]);
    expect([...unlabelled]).toEqual(["a"]);
  });

  it("the open horizon's label always shows; a neighbour it hits drops", () => {
    const ticks = [tick("a", 0.40, "This month", "31 OCT"), tick("b", 0.44, "Work", "2 NOV"), tick("c", 0.47, "Quarter", "31 DEC"), tick("z", 1, "6 months", "30 APR 2027", true)];
    // a and b merge; c collides with the merged label and is dropped…
    expect([...layout(ticks).unlabelled]).toEqual(["c"]);
    // …unless c is open: then it shows, and the merged label drops.
    const open = layout(ticks, { openId: "c" });
    expect(open.labels.find(l => l.key === "c").open).toBe(true);
    expect([...open.unlabelled]).toEqual(["a", "b"]);
  });

  // 76d (tablet): a merged open label that would sit on Today keeps only
  // its own name; if even that doesn't clear Today, it slides right.
  it("an open label near Today drops its merge-partner, then slides clear", () => {
    const ticks = [tick("a", 0.1, "Career", "10 OCT"), tick("b", 0.11, "This week", "11 OCT"), tick("z", 1, "6 months", "30 APR 2027", true)];
    const { labels, unlabelled } = layout(ticks, { openId: "a" });
    const open = labels.find(l => l.open);
    expect(open.names).toEqual(["Career"]);
    expect(open.left).toBeGreaterThanOrEqual(72 + 12);
    expect([...unlabelled]).toEqual(["b"]);
  });

  it("a phone labels only the two ends (57b.30)", () => {
    const ticks = [tick("a", 0.5, "This week", "11 OCT"), tick("z", 1, "6 months", "30 APR 2027", true)];
    const { labels, unlabelled } = layout(ticks, { phone: true });
    expect(labels.map(l => l.key)).toEqual(["today", "z"]);
    expect([...unlabelled]).toEqual(["a"]);
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

describe("the horizon picker (57h)", () => {
  const config = { horizons: {
    month: { hidden: true },
    two: { id: "two", name: "2 weeks", kind: "weeks", count: 2, startDate: "2026-09-28" },
  } };
  const choices = horizonChoices(config, day);
  it("Today, then the visible horizons in Plan's order, customs included; no Work", () => {
    expect(choices.map(c => c.id)).toEqual(["today", "week", "quarter", "two", "halfyear"]);
  });
  it("each with its end date, red at ≤3 days; 6 months reads TO …", () => {
    expect(choices.find(c => c.id === "quarter")).toMatchObject({ date: "WED 30 SEP", red: true });
    expect(choices.find(c => c.id === "halfyear").date).toBe("TO 31 MAR 2027");
    expect(choices[0].date).toBe(null);
  });
});
