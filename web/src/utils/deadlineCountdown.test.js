import { describe, it, expect } from "vitest";
import {
  buildDeadlineMoveRollover,
  formatCountdown,
  formatTodayCountdown,
  getLocalDateString,
  isDailyDone,
  markDeadlineMoveDone,
  markDeadlineMoveOpen
} from "./deadlineCountdown.js";

describe("formatCountdown", () => {
  it("formats exactly one day", () => {
    expect(formatCountdown(86400 * 1000)).toBe("1d");
  });

  it("formats 119 days", () => {
    const ms = (119 * 86400 + 8 * 3600 + 14 * 60 + 22) * 1000;
    expect(formatCountdown(ms)).toBe("119d");
  });

  it("returns null for 0ms (expired)", () => {
    expect(formatCountdown(0)).toBeNull();
  });

  it("returns null for negative ms", () => {
    expect(formatCountdown(-1000)).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(formatCountdown(NaN)).toBeNull();
  });

  it("returns null for undefined / null", () => {
    expect(formatCountdown(undefined)).toBeNull();
    expect(formatCountdown(null)).toBeNull();
  });

  it("returns null for less than one day remaining", () => {
    expect(formatCountdown((14 * 60 + 5) * 1000)).toBeNull();
  });
});

describe("formatTodayCountdown", () => {
  it("formats 9h 32m", () => {
    expect(formatTodayCountdown((9 * 60 + 32) * 60 * 1000)).toBe("09h 32m");
  });

  it("formats midnight boundary (full day)", () => {
    expect(formatTodayCountdown(24 * 60 * 60 * 1000)).toBe("24h 00m");
  });

  it("formats under one hour", () => {
    expect(formatTodayCountdown(45 * 60 * 1000)).toBe("00h 45m");
  });

  it("returns null for 0ms", () => {
    expect(formatTodayCountdown(0)).toBeNull();
  });

  it("returns null for negative ms", () => {
    expect(formatTodayCountdown(-5000)).toBeNull();
  });

  it("returns null for NaN / undefined / null", () => {
    expect(formatTodayCountdown(NaN)).toBeNull();
    expect(formatTodayCountdown(undefined)).toBeNull();
    expect(formatTodayCountdown(null)).toBeNull();
  });
});

describe("isDailyDone", () => {
  it("returns true when saved date matches today", () => {
    expect(isDailyDone("2026-06-06", "2026-06-06")).toBe(true);
  });

  it("returns false on the next day (checkpoint resets)", () => {
    expect(isDailyDone("2026-06-06", "2026-06-07")).toBe(false);
  });

  it("returns false when savedDate is undefined (never done)", () => {
    expect(isDailyDone(undefined, "2026-06-06")).toBe(false);
  });

  it("returns false when savedDate is null", () => {
    expect(isDailyDone(null, "2026-06-06")).toBe(false);
  });

  it("returns false when savedDate is empty string", () => {
    expect(isDailyDone("", "2026-06-06")).toBe(false);
  });

  it("returns false when savedDate is a past date", () => {
    expect(isDailyDone("2026-01-01", "2026-06-06")).toBe(false);
  });
});

describe("getLocalDateString", () => {
  it("uses local calendar fields, not UTC slicing", () => {
    expect(getLocalDateString(new Date(2026, 5, 7, 23, 30))).toBe("2026-06-07");
  });
});

describe("deadline move history helpers", () => {
  const baseConfig = {
    deadlineLabel: "Job contract by September",
    deadlineDate: "2026-09-30",
    deadlineAction: "Apply to one job today"
  };

  it("starts tracking on first seen day without backfilling old missed days", () => {
    const next = buildDeadlineMoveRollover(baseConfig, "2026-06-07");

    expect(next.deadlineMoveLastCheckedDate).toBe("2026-06-07");
    expect(next.deadlineMoveTrackingStartDate).toBe("2026-06-07");
    expect(next.deadlineMoveHistory).toEqual({});
  });

  it("marks the previous tracked day missed after the local day rolls over", () => {
    const next = buildDeadlineMoveRollover({
      ...baseConfig,
      deadlineMoveLastCheckedDate: "2026-06-06",
      deadlineMoveTrackingStartDate: "2026-06-06"
    }, "2026-06-07");

    expect(next.deadlineMoveHistory["2026-06-06"]).toBe("missed");
    expect(next.deadlineMoveLastCheckedDate).toBe("2026-06-07");
  });

  it("preserves a previous done mark instead of overwriting it as missed", () => {
    const next = buildDeadlineMoveRollover({
      ...baseConfig,
      deadlineDailyDoneDate: "2026-06-06",
      deadlineMoveHistory: { "2026-06-06": "done" },
      deadlineMoveLastCheckedDate: "2026-06-06",
      deadlineMoveTrackingStartDate: "2026-06-06"
    }, "2026-06-07");

    expect(next.deadlineMoveHistory["2026-06-06"]).toBe("done");
  });

  it("marks skipped tracked days missed up to today", () => {
    const next = buildDeadlineMoveRollover({
      ...baseConfig,
      deadlineMoveLastCheckedDate: "2026-06-04",
      deadlineMoveTrackingStartDate: "2026-06-04"
    }, "2026-06-07");

    expect(next.deadlineMoveHistory["2026-06-04"]).toBe("missed");
    expect(next.deadlineMoveHistory["2026-06-05"]).toBe("missed");
    expect(next.deadlineMoveHistory["2026-06-06"]).toBe("missed");
    expect(next.deadlineMoveHistory["2026-06-07"]).toBeUndefined();
  });

  it("returns null when already checked today", () => {
    expect(buildDeadlineMoveRollover({
      ...baseConfig,
      deadlineMoveLastCheckedDate: "2026-06-07"
    }, "2026-06-07")).toBeNull();
  });

  it("does nothing when no deadline is configured", () => {
    expect(buildDeadlineMoveRollover({}, "2026-06-07")).toBeNull();
  });

  it("records today's move as done", () => {
    const next = markDeadlineMoveDone(baseConfig, "2026-06-07");

    expect(next.deadlineDailyDoneDate).toBe("2026-06-07");
    expect(next.deadlineMoveHistory["2026-06-07"]).toBe("done");
    expect(next.deadlineMoveLastCheckedDate).toBe("2026-06-07");
  });

  it("reopens today's move by removing today's history entry", () => {
    const next = markDeadlineMoveOpen({
      ...baseConfig,
      deadlineDailyDoneDate: "2026-06-07",
      deadlineMoveHistory: { "2026-06-07": "done", "2026-06-06": "missed" }
    }, "2026-06-07");

    expect(next.deadlineDailyDoneDate).toBeNull();
    expect(next.deadlineMoveHistory["2026-06-07"]).toBeUndefined();
    expect(next.deadlineMoveHistory["2026-06-06"]).toBe("missed");
  });
});
