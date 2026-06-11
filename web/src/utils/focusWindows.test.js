import { describe, it, expect } from "vitest";
import {
  parseTimeToMinutes,
  formatMinutesToTime,
  getFocusWindows,
  getWindowState,
  getRemainingFocusMinutes,
  getNextWindowStart,
  getOverallSpan,
  getCurrentFocusSlot,
  getFocusProgress,
} from "./focusWindows";

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);

describe("parseTimeToMinutes", () => {
  it("parses HH:MM to minutes since midnight", () => {
    expect(parseTimeToMinutes("09:00")).toBe(540);
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
  });

  it("returns null for invalid input", () => {
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("12:60")).toBeNull();
    expect(parseTimeToMinutes("not a time")).toBeNull();
    expect(parseTimeToMinutes(null)).toBeNull();
    expect(parseTimeToMinutes(undefined)).toBeNull();
  });
});

describe("formatMinutesToTime", () => {
  it("formats minutes back to HH:MM", () => {
    expect(formatMinutesToTime(540)).toBe("09:00");
    expect(formatMinutesToTime(0)).toBe("00:00");
    expect(formatMinutesToTime(1439)).toBe("23:59");
  });

  it("wraps values >= 1440", () => {
    expect(formatMinutesToTime(1500)).toBe("01:00"); // 25:00 -> 1:00
  });
});

describe("getFocusWindows", () => {
  // 1. old dayStartHour/dayEndHour fallback
  it("falls back to dayStartHour/dayEndHour when focusWindows is missing", () => {
    expect(getFocusWindows({ dayStartHour: 7, dayEndHour: 26 })).toEqual([
      { startMin: 420, endMin: 120, overnight: true },
    ]);
  });

  it("falls back to 7am-2am defaults when config has neither field", () => {
    expect(getFocusWindows({})).toEqual([{ startMin: 420, endMin: 120, overnight: true }]);
    expect(getFocusWindows()).toEqual([{ startMin: 420, endMin: 120, overnight: true }]);
  });

  it("falls back when focusWindows is an empty array", () => {
    expect(getFocusWindows({ focusWindows: [], dayStartHour: 9, dayEndHour: 17 })).toEqual([
      { startMin: 540, endMin: 1020, overnight: false },
    ]);
  });

  it("falls back when focusWindows is not an array (string, object, or null)", () => {
    const expected = [{ startMin: 540, endMin: 1020, overnight: false }];
    expect(getFocusWindows({ focusWindows: "garbage", dayStartHour: 9, dayEndHour: 17 })).toEqual(expected);
    expect(getFocusWindows({ focusWindows: {}, dayStartHour: 9, dayEndHour: 17 })).toEqual(expected);
    expect(getFocusWindows({ focusWindows: null, dayStartHour: 9, dayEndHour: 17 })).toEqual(expected);
  });

  it("falls back when every entry in focusWindows is invalid", () => {
    expect(
      getFocusWindows({ focusWindows: [{ start: "bad", end: "data" }], dayStartHour: 9, dayEndHour: 17 })
    ).toEqual([{ startMin: 540, endMin: 1020, overnight: false }]);
  });

  it("ignores invalid entries but keeps valid ones", () => {
    expect(
      getFocusWindows({ focusWindows: [{ start: "bad", end: "data" }, { start: "09:00", end: "17:00" }] })
    ).toEqual([{ startMin: 540, endMin: 1020, overnight: false }]);
  });

  it("treats a zero-length window (start === end) as invalid", () => {
    expect(
      getFocusWindows({ focusWindows: [{ start: "09:00", end: "09:00" }], dayStartHour: 8, dayEndHour: 18 })
    ).toEqual([{ startMin: 480, endMin: 1080, overnight: false }]);
  });

  // 2. single normal window
  it("normalizes a single non-overnight focus window", () => {
    expect(getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] })).toEqual([
      { startMin: 540, endMin: 1020, overnight: false },
    ]);
  });

  // 3. split windows with a gap, sorted by start time regardless of input order
  it("normalizes split windows with a gap, sorted by start time", () => {
    expect(
      getFocusWindows({
        focusWindows: [
          { start: "16:00", end: "20:00" },
          { start: "11:00", end: "15:00" },
        ],
      })
    ).toEqual([
      { startMin: 660, endMin: 900, overnight: false },
      { startMin: 960, endMin: 1200, overnight: false },
    ]);
  });

  // 4. overnight window
  it("marks a window crossing midnight as overnight", () => {
    expect(getFocusWindows({ focusWindows: [{ start: "16:00", end: "03:00" }] })).toEqual([
      { startMin: 960, endMin: 180, overnight: true },
    ]);
  });
});

describe("legacy single overnight window (7am-2am, via dayStartHour/dayEndHour fallback)", () => {
  const windows = getFocusWindows({ dayStartHour: 7, dayEndHour: 26 });

  it("is during at 10am with 16h left until 2am", () => {
    expect(getWindowState(dt(10), windows)).toBe("during");
    expect(getRemainingFocusMinutes(dt(10), windows)).toBe(960);
  });

  // overnight window: tail after midnight
  it("is during in the overnight tail at 1am with 1h left until 2am", () => {
    expect(getWindowState(dt(1), windows)).toBe("during");
    expect(getRemainingFocusMinutes(dt(1), windows)).toBe(60);
  });

  it("is before at 3am (gap before window opens), with the full day ahead", () => {
    expect(getWindowState(dt(3), windows)).toBe("before");
    expect(getRemainingFocusMinutes(dt(3), windows)).toBe(1140); // 19h, the full window
  });
});

describe("split windows with a gap and an overnight last window: 11:00-15:00, 16:00-03:00", () => {
  const windows = getFocusWindows({
    focusWindows: [
      { start: "11:00", end: "15:00" },
      { start: "16:00", end: "03:00" },
    ],
  });

  // 6. inside second (overnight) window
  it("is during at 22:00 with 5h left until 3am", () => {
    expect(getWindowState(dt(22), windows)).toBe("during");
    expect(getRemainingFocusMinutes(dt(22), windows)).toBe(300);
  });

  // overnight window: tail after midnight
  it("is during at 1am (tail of the overnight window) with 2h left", () => {
    expect(getWindowState(dt(1), windows)).toBe("during");
    expect(getRemainingFocusMinutes(dt(1), windows)).toBe(120);
  });

  it("is before during the 15:00-16:00 gap, opening next at 16:00", () => {
    expect(getWindowState(dt(15, 30), windows)).toBe("before");
    expect(getNextWindowStart(dt(15, 30), windows).startMin).toBe(960);
  });

  // 8. "today left" sums only remaining valid windows (gap excluded)
  it("during window 1 at noon, today left = remaining window1 + full window2", () => {
    expect(getWindowState(dt(12), windows)).toBe("during");
    expect(getRemainingFocusMinutes(dt(12), windows)).toBe(180 + 660); // 3h + 11h = 14h
  });
});

describe("split windows without overnight: 11:00-15:00, 16:00-20:00", () => {
  const windows = getFocusWindows({
    focusWindows: [
      { start: "11:00", end: "15:00" },
      { start: "16:00", end: "20:00" },
    ],
  });

  // 5. before first window
  it("is before at 08:00, opening next at 11:00 with both windows ahead", () => {
    expect(getWindowState(dt(8), windows)).toBe("before");
    expect(getNextWindowStart(dt(8), windows).startMin).toBe(660);
    expect(getRemainingFocusMinutes(dt(8), windows)).toBe(240 + 240);
  });

  // 6. inside second window
  it("is during at 18:00 with 2h left until 20:00", () => {
    expect(getWindowState(dt(18), windows)).toBe("during");
    expect(getRemainingFocusMinutes(dt(18), windows)).toBe(120);
  });

  // 7. after all windows
  it("is after at 21:00 with nothing left and no next window", () => {
    expect(getWindowState(dt(21), windows)).toBe("after");
    expect(getRemainingFocusMinutes(dt(21), windows)).toBe(0);
    expect(getNextWindowStart(dt(21), windows)).toBeNull();
  });

  // 8. "today left" sums only remaining valid windows (gap excluded)
  it("during window 1 at noon, today left excludes the 15:00-16:00 gap", () => {
    expect(getWindowState(dt(12), windows)).toBe("during");
    // 3h left in window1 (12:00-15:00) + 4h full window2 (16:00-20:00) = 7h, not 8h
    expect(getRemainingFocusMinutes(dt(12), windows)).toBe(180 + 240);
  });
});

describe("getOverallSpan", () => {
  it("spans first start to last end for a single overnight window", () => {
    const windows = getFocusWindows({ dayStartHour: 7, dayEndHour: 26 });
    expect(getOverallSpan(windows)).toEqual({ startMin: 420, endMin: 1560 });
  });

  it("spans first start to last (overnight) end across split windows", () => {
    const windows = getFocusWindows({
      focusWindows: [
        { start: "11:00", end: "15:00" },
        { start: "16:00", end: "03:00" },
      ],
    });
    expect(getOverallSpan(windows)).toEqual({ startMin: 660, endMin: 1620 });
  });
});

describe("getFocusProgress", () => {
  it("is 0 before a single window opens and 1 after it closes", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
    expect(getFocusProgress(dt(8), windows)).toBe(0);
    expect(getFocusProgress(dt(18), windows)).toBe(1);
  });

  it("tracks elapsed/total scheduled minutes during a single window", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
    expect(getFocusProgress(dt(12), windows)).toBeCloseTo(180 / 480); // 3h elapsed of 8h total
  });

  it("holds steady through a gap between split windows (excludes gap time)", () => {
    const windows = getFocusWindows({
      focusWindows: [
        { start: "11:00", end: "15:00" },
        { start: "16:00", end: "20:00" },
      ],
    });
    // total scheduled = 4h + 4h = 8h; window1 fully elapsed = 4h -> 0.5
    const atGapStart = getFocusProgress(dt(15, 1), windows);
    const atGapEnd = getFocusProgress(dt(15, 59), windows);
    expect(atGapStart).toBeCloseTo(0.5);
    expect(atGapEnd).toBeCloseTo(0.5);
    expect(atGapStart).toBe(atGapEnd);
  });

  it("resumes after the gap once the next window opens", () => {
    const windows = getFocusWindows({
      focusWindows: [
        { start: "11:00", end: "15:00" },
        { start: "16:00", end: "20:00" },
      ],
    });
    expect(getFocusProgress(dt(18), windows)).toBeCloseTo((240 + 120) / 480); // 6h elapsed of 8h total
  });

  it("handles the overnight tail (legacy 7am-2am window)", () => {
    const windows = getFocusWindows({ dayStartHour: 7, dayEndHour: 26 });
    expect(getFocusProgress(dt(10), windows)).toBeCloseTo(180 / 1140); // 3h of 19h
    expect(getFocusProgress(dt(1), windows)).toBeCloseTo(1080 / 1140); // 18h of 19h
    expect(getFocusProgress(dt(3), windows)).toBe(0); // gap before tomorrow's window opens
  });
});

describe("getCurrentFocusSlot across split windows 11:00-15:00, 16:00-03:00", () => {
  const windows = getFocusWindows({
    focusWindows: [
      { start: "11:00", end: "15:00" },
      { start: "16:00", end: "03:00" },
    ],
  });

  it("returns null before any window starts", () => {
    expect(getCurrentFocusSlot(dt(9), windows)).toBeNull();
  });

  it("returns morning shortly after window 1 opens", () => {
    expect(getCurrentFocusSlot(dt(12), windows)).toBe("morning");
  });

  it("returns afternoon partway through window 2", () => {
    expect(getCurrentFocusSlot(dt(18), windows)).toBe("afternoon");
  });

  it("returns evening late in window 2", () => {
    expect(getCurrentFocusSlot(dt(23), windows)).toBe("evening");
  });

  it("returns evening in the overnight tail (2am)", () => {
    expect(getCurrentFocusSlot(dt(2), windows)).toBe("evening");
  });
});
