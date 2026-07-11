import { describe, expect, it, afterEach } from "vitest";
import {
  parseLocalDateOnly,
  getDateRangeDays,
  sliceContributions,
  computeRangeStats,
  computeCompletionsByDayOfWeek,
  computeCompletedByCategory,
  computeActiveMix,
} from "./insightsContext";

describe("parseLocalDateOnly", () => {
  const originalTZ = process.env.TZ;
  afterEach(() => {
    // process.env values are always coerced to strings — assigning
    // `undefined` directly would set the literal string "undefined"
    // instead of actually unsetting it, leaving later tests in this worker
    // running under a bogus TZ instead of the real original (possibly
    // absent) one.
    if (originalTZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTZ;
    }
  });

  it("parses a plain date string into the matching local y/m/d", () => {
    const d = parseLocalDateOnly("2026-06-07");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June, 0-indexed
    expect(d.getDate()).toBe(7);
  });

  it("handles a year boundary correctly (Dec 31 -> Jan 1)", () => {
    const dec31 = parseLocalDateOnly("2025-12-31");
    expect(dec31.getFullYear()).toBe(2025);
    expect(dec31.getMonth()).toBe(11);
    expect(dec31.getDate()).toBe(31);

    const jan1 = parseLocalDateOnly("2026-01-01");
    expect(jan1.getFullYear()).toBe(2026);
    expect(jan1.getMonth()).toBe(0);
    expect(jan1.getDate()).toBe(1);
  });

  it("computes the correct weekday across a US DST spring-forward boundary", () => {
    process.env.TZ = "America/New_York";
    // March 8, 2026 is the US DST spring-forward date, a Sunday; March 9 is the following Monday.
    expect(parseLocalDateOnly("2026-03-08").getDay()).toBe(0);
    expect(parseLocalDateOnly("2026-03-09").getDay()).toBe(1);
  });

  it("does not shift the date in a negative-offset timezone, unlike new Date(dateString)", () => {
    process.env.TZ = "America/Los_Angeles";
    // Self-verifying: first prove the naive bug this guards against is real
    // in this environment/timezone, then prove parseLocalDateOnly avoids it.
    expect(new Date("2026-03-01").getDate()).not.toBe(1);
    const safe = parseLocalDateOnly("2026-03-01");
    expect(safe.getFullYear()).toBe(2026);
    expect(safe.getMonth()).toBe(2);
    expect(safe.getDate()).toBe(1);
  });
});

describe("getDateRangeDays", () => {
  it("returns a single day for 'today'", () => {
    const today = new Date(2026, 5, 15);
    expect(getDateRangeDays("today", today)).toEqual(["2026-06-15"]);
  });

  it("returns 7 consecutive oldest-first days for '7d', ending at today", () => {
    const today = new Date(2026, 5, 15);
    const days = getDateRangeDays("7d", today);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-06-09");
    expect(days[6]).toBe("2026-06-15");
  });

  it("returns 30 consecutive days for '30d', crossing a month boundary correctly", () => {
    const today = new Date(2026, 2, 5); // March 5, 2026
    const days = getDateRangeDays("30d", today);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-02-04");
    expect(days[29]).toBe("2026-03-05");
  });
});

describe("sliceContributions", () => {
  it("0-fills every day in the range that has no contribution record", () => {
    const result = sliceContributions([{ dateString: "2026-06-10", count: 3 }], ["2026-06-09", "2026-06-10", "2026-06-11"]);
    expect(result).toEqual([
      { dateString: "2026-06-09", count: 0 },
      { dateString: "2026-06-10", count: 3 },
      { dateString: "2026-06-11", count: 0 },
    ]);
  });

  it("defensively sums duplicate records for the same date instead of trusting only the first match", () => {
    const result = sliceContributions(
      [
        { dateString: "2026-06-10", count: 2 },
        { dateString: "2026-06-10", count: 5 },
      ],
      ["2026-06-10"]
    );
    expect(result).toEqual([{ dateString: "2026-06-10", count: 7 }]);
  });

  it("clamps a negative count to 0 instead of letting corrupt data through", () => {
    const result = sliceContributions([{ dateString: "2026-06-10", count: -3 }], ["2026-06-10"]);
    expect(result).toEqual([{ dateString: "2026-06-10", count: 0 }]);
  });

  it("ignores malformed entries without throwing", () => {
    const result = sliceContributions([null, { count: 1 }, { dateString: "2026-06-10" }], ["2026-06-10"]);
    expect(result).toEqual([{ dateString: "2026-06-10", count: 0 }]);
  });
});

describe("computeRangeStats", () => {
  const rangeDays = ["2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14", "2026-06-15"];

  // computeRangeStats now takes an already-sliced `daily` array (see
  // sliceContributions) rather than raw contributions + rangeDays, so a
  // caller that needs both the range-stats numbers and the daily slice
  // itself (as InsightsPanel does) only pays for one scan of contributions.
  it("computes totalCompleted, dailyPace (divided by every calendar day, not just active ones), and completionDaysCount", () => {
    const contributions = [
      { dateString: "2026-06-10", count: 3 },
      { dateString: "2026-06-13", count: 2 },
    ];
    const stats = computeRangeStats(sliceContributions(contributions, rangeDays));
    expect(stats.totalCompleted).toBe(5);
    expect(stats.dailyPace).toBeCloseTo(5 / 7, 1);
    expect(stats.completionDaysCount).toBe(2);
  });

  it("returns all zeros for a completely empty period", () => {
    const stats = computeRangeStats(sliceContributions([], rangeDays));
    expect(stats).toEqual({ totalCompleted: 0, dailyPace: 0, completionDaysCount: 0 });
  });
});

describe("computeCompletionsByDayOfWeek", () => {
  // Also now takes an already-sliced `daily` array, same reasoning as
  // computeRangeStats above.
  it("buckets contributions by weekday, not by individual task records", () => {
    // 2026-06-08 is a Monday, 2026-06-13 is a Saturday.
    const contributions = [
      { dateString: "2026-06-08", count: 3 },
      { dateString: "2026-06-13", count: 3 },
      { dateString: "2026-06-15", count: 3 }, // another Monday
    ];
    const rangeDays = getDateRangeDays("30d", new Date(2026, 5, 15));
    const result = computeCompletionsByDayOfWeek(sliceContributions(contributions, rangeDays));
    expect(result.counts.Mon).toBe(6);
    expect(result.counts.Sat).toBe(3);
    expect(result.totalCount).toBe(9);
    expect(result.bestDay).toBe("Mon");
  });

  it("stays confident even when a task with the same completion date was later deleted (contributions[] is unaffected by deletion)", () => {
    // Simulates: contributions[] was incremented at completion time and never decremented,
    // even though the underlying task record no longer exists — the weekday count must still
    // reflect the full contributions total, not an undercounted per-task tally.
    const contributions = [{ dateString: "2026-06-08", count: 5 }]; // a Monday, 5 completions, but say only 1 retained task record exists
    const rangeDays = getDateRangeDays("7d", new Date(2026, 5, 8));
    const result = computeCompletionsByDayOfWeek(sliceContributions(contributions, rangeDays));
    expect(result.counts.Mon).toBe(5);
    expect(result.totalCount).toBe(5);
  });

  it("returns a null bestDay (not a misleading pattern) when total completions are too sparse", () => {
    const contributions = [{ dateString: "2026-06-08", count: 2 }];
    const rangeDays = getDateRangeDays("7d", new Date(2026, 5, 8));
    expect(computeCompletionsByDayOfWeek(sliceContributions(contributions, rangeDays)).bestDay).toBeNull();
  });

  it("returns a null bestDay on a tie between two weekdays", () => {
    const contributions = [
      { dateString: "2026-06-08", count: 2 }, // Mon
      { dateString: "2026-06-13", count: 2 }, // Sat
    ];
    const rangeDays = getDateRangeDays("7d", new Date(2026, 5, 13));
    expect(computeCompletionsByDayOfWeek(sliceContributions(contributions, rangeDays)).bestDay).toBeNull();
  });
});

describe("computeCompletedByCategory", () => {
  const rangeDays = ["2026-06-09", "2026-06-10", "2026-06-11"];

  it("counts retained completed tasks by category within range", () => {
    const tasks = [
      { uuid: "a", isCompleted: true, isDeleted: false, dateCompletedString: "2026-06-10", category: "Work" },
      { uuid: "b", isCompleted: true, isDeleted: false, dateCompletedString: "2026-06-10", category: "Work" },
      { uuid: "c", isCompleted: true, isDeleted: false, dateCompletedString: "2026-06-11", category: "Health" },
      { uuid: "d", isCompleted: true, isDeleted: false, dateCompletedString: "2026-07-01", category: "Work" }, // out of range
      { uuid: "e", isCompleted: false, isDeleted: false, dateCompletedString: null, category: "Work" }, // not completed
    ];
    const result = computeCompletedByCategory(tasks, rangeDays);
    expect(result.categoryCounts).toEqual({ Work: 2, Health: 1 });
    expect(result.retainedCount).toBe(3);
  });

  it("buckets a missing category as 'Uncategorized' rather than fabricating a default", () => {
    const tasks = [{ uuid: "a", isCompleted: true, isDeleted: false, dateCompletedString: "2026-06-10" }];
    const result = computeCompletedByCategory(tasks, rangeDays);
    expect(result.categoryCounts).toEqual({ Uncategorized: 1 });
  });

  it("does not compute or expose a coverage ratio against contributions[] — dateCompletedString and contributions[].dateString are stamped by different clocks (see issue #361), so retainedCount alone is what's returned", () => {
    const tasks = [{ uuid: "a", isCompleted: true, isDeleted: false, dateCompletedString: "2026-06-10", category: "Work" }];
    const result = computeCompletedByCategory(tasks, rangeDays);
    expect(result).toEqual({ categoryCounts: { Work: 1 }, retainedCount: 1 });
    expect(result.detailCoverage).toBeUndefined();
    expect(result.authoritativeTotal).toBeUndefined();
  });

  it("returns empty categoryCounts and a 0 retainedCount for a period with no retained completed tasks", () => {
    const result = computeCompletedByCategory([], rangeDays);
    expect(result.categoryCounts).toEqual({});
    expect(result.retainedCount).toBe(0);
  });
});

describe("computeActiveMix", () => {
  it("only counts tasks that are active (not deleted, not completed, not parked)", () => {
    const tasks = [
      { uuid: "a", category: "Work", priority: "P1", horizonLevel: "today" },
      { uuid: "b", category: "Work", priority: "P2", horizonLevel: "week", isCompleted: true },
      { uuid: "c", category: "Health", priority: "P1", horizonLevel: "today", isParked: true },
      { uuid: "d", category: "Health", priority: "P1", horizonLevel: "today", isDeleted: true },
    ];
    const result = computeActiveMix(tasks);
    expect(result.currentOpenCount).toBe(1);
    expect(result.categoryMix).toEqual({ Work: 1 });
  });

  it("buckets missing category as 'Uncategorized' instead of fabricating a default", () => {
    const result = computeActiveMix([{ uuid: "a" }]);
    expect(result.categoryMix).toEqual({ Uncategorized: 1 });
  });

  it("returns all-zero mixes for an empty task list", () => {
    const result = computeActiveMix([]);
    expect(result).toEqual({ categoryMix: {}, currentOpenCount: 0 });
  });
});
