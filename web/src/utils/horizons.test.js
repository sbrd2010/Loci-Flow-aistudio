import { describe, expect, it } from "vitest";
import { BUILT_IN_HORIZONS, currentPeriod, daysLeft, horizonsFromConfig, taskHorizonId } from "./horizons";

const [week, month, quarter, sixMonths] = BUILT_IN_HORIZONS;

describe("built-in periods (57, sample date Mon 28 Sep 2026)", () => {
  it("This week runs Monday to Sunday: ENDS SUN 4 OCT · 6 DAYS", () => {
    expect(currentPeriod(week, "2026-09-28")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(daysLeft(week, "2026-09-28")).toBe(6);
  });

  it("This month and This quarter are the calendar month and quarter", () => {
    expect(currentPeriod(month, "2026-09-28")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(currentPeriod(quarter, "2026-09-28")).toEqual({ start: "2026-07-01", end: "2026-09-30" });
  });

  it("6 months runs to the last day of the month six months out: TO 31 MAR 2027", () => {
    expect(currentPeriod(sixMonths, "2026-09-28").end).toBe("2027-03-31");
  });
});

describe("the date edges", () => {
  it("30 Sep → 1 Oct: September and Q3 end; October and Q4 begin; 6 months moves a month", () => {
    expect(daysLeft(month, "2026-09-30")).toBe(0);
    expect(currentPeriod(month, "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(currentPeriod(quarter, "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(currentPeriod(sixMonths, "2026-10-01").end).toBe("2027-04-30");
    // The week doesn't turn over at the month.
    expect(currentPeriod(week, "2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });

  it("Sun 4 → Mon 5 Oct: the week turns over", () => {
    expect(daysLeft(week, "2026-10-04")).toBe(0);
    expect(currentPeriod(week, "2026-10-05")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });

  it("31 Dec → 1 Jan: a week across the year, and the year turning over", () => {
    expect(currentPeriod(week, "2026-12-31")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(currentPeriod(week, "2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(currentPeriod(quarter, "2026-12-31").end).toBe("2026-12-31");
    expect(currentPeriod(quarter, "2027-01-01")).toEqual({ start: "2027-01-01", end: "2027-03-31" });
    expect(currentPeriod(sixMonths, "2026-12-31").end).toBe("2027-06-30");
  });

  it("29 Feb in a leap year", () => {
    expect(currentPeriod(month, "2028-02-29")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
});

describe("custom horizons", () => {
  const job = { id: "h1", name: "Job hunt", kind: "custom", startDate: "2026-09-01", endDate: "2026-09-30", lengthDays: 30 };

  it("runs to its end date, then repeats with the same length", () => {
    expect(currentPeriod(job, "2026-09-28")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(currentPeriod(job, "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-10-30" });
    expect(currentPeriod(job, "2026-11-15")).toEqual({ start: "2026-10-31", end: "2026-11-29" });
  });

  it("a new end date moves this period only; the length stays (Q44.4)", () => {
    const moved = { ...job, endDate: "2026-10-14" };
    expect(currentPeriod(moved, "2026-10-01")).toEqual({ start: "2026-09-01", end: "2026-10-14" });
    expect(currentPeriod(moved, "2026-10-15")).toEqual({ start: "2026-10-15", end: "2026-11-13" });
  });
});

describe("horizonsFromConfig", () => {
  it("gives the built-ins in their order, with renames and hides", () => {
    const hs = horizonsFromConfig({ horizons: { month: { name: "October push" }, quarter: { hidden: true } } }, "2026-10-01");
    expect(hs.map(h => h.id)).toEqual(["week", "month", "quarter", "halfyear"]);
    expect(hs[1].name).toBe("October push");
    expect(hs[2].hidden).toBe(true);
  });

  it("slots custom horizons in by their end date", () => {
    const hs = horizonsFromConfig({ horizons: {
      h1: { id: "h1", name: "Sprint", kind: "custom", startDate: "2026-09-28", endDate: "2026-10-20", lengthDays: 23 },
      h2: { id: "h2", name: "Thesis", kind: "custom", startDate: "2026-09-01", endDate: "2027-08-31", lengthDays: 365 },
    } }, "2026-10-01");
    expect(hs.map(h => h.id)).toEqual(["week", "h1", "month", "quarter", "halfyear", "h2"]);
  });

  it("ignores a broken custom entry", () => {
    const hs = horizonsFromConfig({ horizons: { bad: { id: "bad", kind: "custom" } } }, "2026-10-01");
    expect(hs).toHaveLength(4);
  });
});

describe("taskHorizonId", () => {
  const hs = horizonsFromConfig({}, "2026-10-01");
  it("reads the ids the app has always stored, unchanged", () => {
    expect(taskHorizonId({ horizonLevel: "week" }, hs)).toBe("week");
    expect(taskHorizonId({ horizonLevel: "halfyear" }, hs)).toBe("halfyear");
    expect(taskHorizonId({ horizonLevel: "today" }, hs)).toBe("today");
  });
  it("puts the old Work horizon, and an unknown id, in Work · older (null)", () => {
    expect(taskHorizonId({ horizonLevel: "office" }, hs)).toBeNull();
    expect(taskHorizonId({ horizonLevel: "gone" }, hs)).toBeNull();
  });
});

describe("calendar kinds (Q45)", () => {
  const twoWeeks = { id: "h2w", name: "Sprint", kind: "weeks", count: 2, startDate: "2026-09-30" };
  const twoMonths = { id: "h2m", name: "Autumn", kind: "months", count: 2, startDate: "2026-09-30" };
  const year = { id: "hy", name: "This year", kind: "year", startDate: "2026-09-30" };

  it("Weeks run from a Monday, N at a time", () => {
    // Added on Wed 30 Sep: the grid starts Mon 28 Sep.
    expect(currentPeriod(twoWeeks, "2026-09-30")).toEqual({ start: "2026-09-28", end: "2026-10-11" });
    expect(currentPeriod(twoWeeks, "2026-10-12")).toEqual({ start: "2026-10-12", end: "2026-10-25" });
  });

  it("Months run from the 1st, N at a time, across the year", () => {
    expect(currentPeriod(twoMonths, "2026-09-30")).toEqual({ start: "2026-09-01", end: "2026-10-31" });
    expect(currentPeriod(twoMonths, "2026-11-01")).toEqual({ start: "2026-11-01", end: "2026-12-31" });
    expect(currentPeriod(twoMonths, "2027-01-01")).toEqual({ start: "2027-01-01", end: "2027-02-28" });
  });

  it("Year is 1 Jan to 31 Dec", () => {
    expect(currentPeriod(year, "2026-09-30")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(currentPeriod(year, "2027-01-01")).toEqual({ start: "2027-01-01", end: "2027-12-31" });
  });

  it("a moved end date holds, then the next period lines back up with the calendar (Q44.4, Q45)", () => {
    const moved = { ...twoWeeks, endDate: "2026-10-07" };
    expect(currentPeriod(moved, "2026-10-05")).toEqual({ start: "2026-09-28", end: "2026-10-07" });
    // The rest of that grid period, then the grid again.
    expect(currentPeriod(moved, "2026-10-08")).toEqual({ start: "2026-10-08", end: "2026-10-11" });
    expect(currentPeriod(moved, "2026-10-12")).toEqual({ start: "2026-10-12", end: "2026-10-25" });
  });

  it("slot into the ladder by end date", () => {
    const hs = horizonsFromConfig({ horizons: { h2w: twoWeeks, hy: year } }, "2026-09-30");
    // On 30 Sep This month and This quarter end that day; the sprint ends 11 Oct.
    expect(hs.map(h => h.id)).toEqual(["week", "month", "quarter", "h2w", "hy", "halfyear"]);
  });
});
