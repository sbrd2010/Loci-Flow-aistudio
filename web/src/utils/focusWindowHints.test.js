import { describe, it, expect } from "vitest";
import {
  getWindowDuration,
  formatDuration,
  findOverlaps,
  analyzeFocusWindowRows,
  getTotalPlannedMinutes,
} from "./focusWindowHints";

describe("getWindowDuration", () => {
  it("measures a normal window", () => {
    expect(getWindowDuration("09:00", "17:00")).toBe(480);
    expect(getWindowDuration("10:15", "10:45")).toBe(30);
  });

  it("treats an end at or before the start as crossing midnight", () => {
    expect(getWindowDuration("22:00", "02:00")).toBe(240);
  });

  it("returns null for unset, invalid, or zero-length input", () => {
    expect(getWindowDuration("", "17:00")).toBeNull();
    expect(getWindowDuration("09:00", "banana")).toBeNull();
    expect(getWindowDuration("09:00", "09:00")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(30)).toBe("30m");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(810)).toBe("13h 30m");
  });
});

describe("findOverlaps", () => {
  it("reports no overlap for windows that merely touch", () => {
    expect(findOverlaps([{ start: "09:00", end: "12:00" }, { start: "12:00", end: "15:00" }]))
      .toEqual([[], []]);
  });

  it("finds overlap in both directions", () => {
    expect(findOverlaps([{ start: "09:00", end: "13:00" }, { start: "12:00", end: "15:00" }]))
      .toEqual([[1], [0]]);
  });

  it("detects an overnight window colliding with an early-morning one", () => {
    // 22:00-02:00 wraps midnight, so it shares minutes with 01:00-03:00.
    expect(findOverlaps([{ start: "22:00", end: "02:00" }, { start: "01:00", end: "03:00" }]))
      .toEqual([[1], [0]]);
  });

  it("ignores incomplete rows", () => {
    expect(findOverlaps([{ start: "09:00", end: "" }, { start: "09:30", end: "10:00" }]))
      .toEqual([[], []]);
  });
});

// The reported failure: the settings time picker starts on AM, so entering an
// afternoon time and leaving the meridiem alone stores the morning one. Two of
// these five rows are "1:00 PM" and "2:45 PM" typed that way.
describe("analyzeFocusWindowRows — the AM/PM slip", () => {
  const rows = [
    { start: "10:15", end: "10:45" },
    { start: "11:00", end: "12:15" },
    { start: "01:00", end: "14:30" }, // meant 1:00 PM
    { start: "02:45", end: "16:00" }, // meant 2:45 PM
    { start: "16:15", end: "17:00" },
  ];

  it("measures the slipped rows and shows what they swallow", () => {
    const result = analyzeFocusWindowRows(rows);
    expect(result[2].durationMin).toBe(810); // 13h 30m
    expect(result[3].durationMin).toBe(795); // 13h 15m
    // The two slipped rows span most of the day, so they also engulf the
    // correct morning rows — those get reported as overlapping too, and only
    // come clean once the slips are fixed. Only rows 2 and 3 carry a fix, so
    // the editor can offer the correction where it belongs.
    expect(result[0].overlapsWith).toEqual([2, 3]);
    expect(result[1].overlapsWith).toEqual([2, 3]);
    expect(result[4].overlapsWith).toEqual([]); // 4:15 PM starts after both end
    expect(result[0].meridiemFix).toBeNull();
    expect(result[1].meridiemFix).toBeNull();
  });

  it("comes fully clean once the two suggested fixes are applied", () => {
    const fixed = rows.map((r, i) =>
      i === 2 ? { ...r, start: "13:00" } : i === 3 ? { ...r, start: "14:45" } : r);
    const result = analyzeFocusWindowRows(fixed);
    expect(result.every(r => r.overlapsWith.length === 0)).toBe(true);
    expect(result.every(r => r.meridiemFix === null)).toBe(true);
    expect(getTotalPlannedMinutes(fixed)).toBe(30 + 75 + 90 + 75 + 45); // 5h 15m
  });

  it("suggests exactly the intended PM start", () => {
    const result = analyzeFocusWindowRows(rows);
    expect(result[2].meridiemFix).toEqual({ field: "start", value: "13:00", durationMin: 90 });
    expect(result[3].meridiemFix).toEqual({ field: "start", value: "14:45", durationMin: 75 });
    expect(result[0].meridiemFix).toBeNull();
  });

  it("counts shared minutes once in the planned total", () => {
    // Summing each window's own length gives 29h 15m — more than a day holds.
    expect(getTotalPlannedMinutes(rows)).toBe(945); // 15h 45m of real coverage
  });
});

// Length alone must never trigger a warning: the app's own default window is 19
// hours long, and a 9-5 workday is a single 8-hour window.
describe("analyzeFocusWindowRows — does not cry wolf", () => {
  it("leaves the default 7:00 AM-2:00 AM window alone", () => {
    const [only] = analyzeFocusWindowRows([{ start: "07:00", end: "02:00" }]);
    expect(only.durationMin).toBe(1140); // 19h
    expect(only.overlapsWith).toEqual([]);
    expect(only.meridiemFix).toBeNull();
  });

  it("leaves a plain 9-5 day alone", () => {
    const [only] = analyzeFocusWindowRows([{ start: "09:00", end: "17:00" }]);
    expect(only.meridiemFix).toBeNull();
  });

  it("leaves a deliberate split day alone", () => {
    const result = analyzeFocusWindowRows([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
      { start: "21:00", end: "23:00" },
    ]);
    expect(result.every(r => r.overlapsWith.length === 0)).toBe(true);
    expect(result.every(r => r.meridiemFix === null)).toBe(true);
    expect(getTotalPlannedMinutes([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
      { start: "21:00", end: "23:00" },
    ])).toBe(180 + 240 + 120);
  });

  it("offers no fix when shifting would only trade one overlap for another", () => {
    // 01:00-14:30 overlaps 13:00-15:00; moving its start to 13:00 still would.
    const result = analyzeFocusWindowRows([
      { start: "01:00", end: "14:30" },
      { start: "13:00", end: "15:00" },
    ]);
    expect(result[0].overlapsWith).toEqual([1]);
    expect(result[0].meridiemFix).toBeNull();
  });

  it("can suggest fixing the end when that is the slipped side", () => {
    // "9:00 AM to 5:00 PM" typed with the end left on AM becomes a 20h window
    // that swallows the later one.
    const result = analyzeFocusWindowRows([
      { start: "09:00", end: "05:00" },
      { start: "18:00", end: "19:00" },
    ]);
    expect(result[0].meridiemFix).toEqual({ field: "end", value: "17:00", durationMin: 480 });
  });
});
