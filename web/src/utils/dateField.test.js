import { describe, expect, it } from "vitest";
import { dateToYmd, formatDateField, isFullIsoDate, localeWeekStart, parseTypedDate, ymdToDate } from "./dateField";
import { getFocusWindows, getLociDayStr } from "./focusWindows";

const inZone = (tz, fn) => {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try { fn(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
};
const ZONES = ["Asia/Kolkata", "America/Los_Angeles", "Europe/London"];

describe("date field strings (#658)", () => {
  it("round-trips YYYY-MM-DD through a local date in every zone, across DST and year-end", () => {
    const days = ["2026-03-08", "2026-03-29", "2026-10-25", "2026-11-01", "2026-12-31", "2027-01-01", "2028-02-29"];
    for (const tz of ZONES) inZone(tz, () => {
      for (const ymd of days) expect(dateToYmd(ymdToDate(ymd)), `${tz} ${ymd}`).toBe(ymd);
    });
  });

  it("refuses impossible dates", () => {
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-5", "", null, "13/11/2026"]) expect(ymdToDate(bad)).toBeNull();
  });

  it("shows a date as 13 Nov 2026", () => {
    expect(formatDateField("2026-11-13")).toBe("13 Nov 2026");
    expect(formatDateField("2027-01-01")).toBe("1 Jan 2027");
    expect(formatDateField("")).toBe("");
  });

  it("reads what a person types", () => {
    for (const [text, want] of [
      ["2026-11-13", "2026-11-13"], ["2026-1-5", "2026-01-05"], [" 13 Nov 2026 ", "2026-11-13"],
      ["13 november 2026", "2026-11-13"], ["Nov 13, 2026", "2026-11-13"], ["13 Sept 2026", "2026-09-13"],
      ["1 Jan. 2027", "2027-01-01"], ["29 Feb 2028", "2028-02-29"],
    ]) expect(parseTypedDate(text), text).toBe(want);
  });

  it("never guesses: half-typed, ambiguous or impossible input is null", () => {
    for (const text of ["13 Nov 2", "13/11/2026", "11/13/2026", "Ma 3 2026", "31 Feb 2026", "tomorrow", "", "2026-11"]) {
      expect(parseTypedDate(text), text).toBeNull();
    }
  });

  it("takes only a full ISO date at once", () => {
    expect(isFullIsoDate("2026-11-13")).toBe(true);
    expect(isFullIsoDate("2026-11-1")).toBe(false);
    expect(isFullIsoDate("13 Nov 2026")).toBe(false);
  });

  it("reads the week start from the locale, or leaves the default", () => {
    const gb = localeWeekStart("en-GB");
    const us = localeWeekStart("en-US");
    // Node without week data returns undefined for both; with it, GB is Monday and US Sunday.
    if (gb !== undefined) expect(gb).toBe(1);
    if (us !== undefined) expect(us).toBe(0);
    expect(localeWeekStart("not a locale !!")).toBeUndefined();
  });

  // §9: the field never picks "today" itself. A front's end-date minimum is
  // the Loci day the caller passes, which at 00:30 inside a window that ends
  // at 02:00 is still yesterday's date; a reminder's is the calendar date.
  it("at 00:30 in a late window, the Loci day (front minimum) is yesterday while the calendar day is today", () => {
    for (const tz of ZONES) inZone(tz, () => {
      const windows = getFocusWindows({ focusWindows: [{ start: "18:00", end: "02:00" }] });
      const now = new Date(2026, 10, 14, 0, 30);
      expect(getLociDayStr(now, windows), tz).toBe("2026-11-13");
      expect(dateToYmd(now), tz).toBe("2026-11-14");
    });
  });
});
