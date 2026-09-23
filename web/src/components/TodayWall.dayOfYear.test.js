import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { localDayOfYear } from "./TodayWall";

// The anchor line turns one step per local date. Dividing local-midnight
// differences by 24h drifted across DST: the day after the spring change is
// an hour short, so two dates shared an anchor.
describe("localDayOfYear", () => {
  let tz;
  beforeAll(() => { tz = process.env.TZ; process.env.TZ = "Europe/Amsterdam"; });
  afterAll(() => { process.env.TZ = tz; });

  it("counts 1 January as day 1", () => {
    expect(localDayOfYear(new Date(2024, 0, 1, 9))).toBe(1);
  });

  it("steps by exactly one across the spring DST change", () => {
    const days = [29, 30, 31].map(d => localDayOfYear(new Date(2024, 2, d, 0, 30)))
      .concat([1, 2].map(d => localDayOfYear(new Date(2024, 3, d, 0, 30))));
    expect(days).toEqual([89, 90, 91, 92, 93]);
  });

  it("steps by exactly one across the autumn DST change", () => {
    const days = [26, 27, 28].map(d => localDayOfYear(new Date(2024, 9, d, 23, 30)));
    expect(days[1] - days[0]).toBe(1);
    expect(days[2] - days[1]).toBe(1);
  });
});
