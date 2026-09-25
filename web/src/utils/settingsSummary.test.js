import { describe, expect, it } from "vitest";
import { focusWindowRows, focusWindowsLine, focusWindowsSummary, reconcileFocusWindowRows } from "./settingsSummary";

describe("focusWindowsSummary", () => {
  it("counts windows, covered time and the end of the last one (44d)", () => {
    const config = { focusWindows: [
      { start: "10:00", end: "11:15" }, { start: "11:30", end: "12:30" },
      { start: "13:00", end: "15:00" }, { start: "15:30", end: "17:15" },
    ] };
    expect(focusWindowsSummary(config)).toEqual({ count: 4, totalMinutes: 360, dayEnds: "17:15", isFallback: false });
    expect(focusWindowsLine(config)).toBe("4 windows · 6h · day ends 17:15");
  });
  it("a window past midnight ends the day after midnight", () => {
    expect(focusWindowsSummary({ focusWindows: [{ start: "22:00", end: "01:00" }] }).dayEnds).toBe("01:00");
  });
  it("ignores incomplete rows, and with none set says the fallback applies", () => {
    const config = { focusWindows: [{ start: "09:00", end: "" }, { start: "10:00", end: "10:00" }] };
    expect(focusWindowsSummary(config)).toMatchObject({ count: 0, isFallback: true, dayEnds: "00:00", totalMinutes: 17 * 60 });
    expect(focusWindowsLine({})).toBe("Not set · 07:00–24:00");
  });
});

describe("an older account's dayStartHour/dayEndHour", () => {
  it("is one window the person set, not the fallback", () => {
    const config = { dayStartHour: 7, dayEndHour: 26 };
    expect(focusWindowRows(config)).toEqual([{ start: "07:00", end: "02:00" }]);
    expect(focusWindowsLine(config)).toBe("1 window · 19h · day ends 02:00");
  });
  it("focusWindows, when set, win over the old hours", () => {
    expect(focusWindowRows({ dayStartHour: 7, dayEndHour: 26, focusWindows: [{ start: "09:00", end: "17:00" }] })).toEqual([{ start: "09:00", end: "17:00" }]);
  });
});

describe("incoming focus-window configuration", () => {
  it("replaces complete local rows while retaining a time input still being edited", () => {
    const local = [{ start: "09:00", end: "17:00" }, { start: "18:00", end: "" }];
    const remote = [{ start: "10:00", end: "16:00" }, { start: "20:00", end: "21:00" }];
    expect(reconcileFocusWindowRows(local, remote)).toEqual([remote[0], { start: "18:00", end: "" }, remote[1]]);
  });
  it("keeps a first-row draft at the first row while another complete row remains", () => {
    const local = [{ start: "07:00", end: "" }, { start: "09:00", end: "17:00" }];
    expect(reconcileFocusWindowRows(local, [{ start: "09:00", end: "17:00" }]))
      .toEqual(local);
  });
  it("does not keep a stale complete row when another device changes it", () => {
    expect(reconcileFocusWindowRows([{ start: "09:00", end: "17:00" }], [{ start: "10:00", end: "18:00" }]))
      .toEqual([{ start: "10:00", end: "18:00" }]);
  });
});

describe("overnight coverage", () => {
  it("counts an early-morning overlap only once", () => {
    const summary = focusWindowsSummary({ focusWindows: [
      { start: "22:00", end: "02:00" }, { start: "01:00", end: "03:00" },
    ] });
    expect(summary.totalMinutes).toBe(5 * 60);
  });
});
