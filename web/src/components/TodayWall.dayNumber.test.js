import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { localDayNumber } from "./TodayWall";

// The anchor line turns one step per local date. Dividing local-midnight
// differences by 24h drifted across DST (the day after the spring change is an
// hour short, so two dates shared an anchor), and a day-of-year reset at New
// Year repeated or skipped one too.
describe("localDayNumber", () => {
  let tz;
  beforeAll(() => { tz = process.env.TZ; process.env.TZ = "Europe/Amsterdam"; });
  afterAll(() => { process.env.TZ = tz; });

  const steps = (dates) => dates.map(localDayNumber).slice(1).map((n, i) => n - localDayNumber(dates[i]));

  it("steps by exactly one across the spring DST change", () => {
    expect(steps([29, 30, 31].map(d => new Date(2024, 2, d, 0, 30)).concat([1, 2].map(d => new Date(2024, 3, d, 0, 30)))))
      .toEqual([1, 1, 1, 1]);
  });

  it("steps by exactly one across the autumn DST change", () => {
    expect(steps([26, 27, 28].map(d => new Date(2024, 9, d, 23, 30)))).toEqual([1, 1]);
  });

  it("steps by exactly one across New Year", () => {
    expect(steps([new Date(2024, 11, 30, 12), new Date(2024, 11, 31, 23, 59), new Date(2025, 0, 1, 0, 1), new Date(2025, 0, 2, 12)]))
      .toEqual([1, 1, 1]);
  });

  it("is the same number all day long", () => {
    expect(localDayNumber(new Date(2024, 5, 15, 0, 0))).toBe(localDayNumber(new Date(2024, 5, 15, 23, 59)));
  });
});
