import { describe, expect, it } from "vitest";
import { addDays, assertTimeZone, dateString, daysBetween, wallClock } from "../src/time.js";

describe("wallClock", () => {
  it("runs the tests on a UTC clock", () => {
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });

  it("gives the user's date when it differs from UTC (India, 23:00 UTC is already tomorrow)", () => {
    const ms = Date.UTC(2026, 9, 21, 23, 0, 0);
    expect(dateString(new Date(ms))).toBe("2026-10-21");
    expect(dateString(wallClock(ms, "Asia/Kolkata"))).toBe("2026-10-22");
    expect(wallClock(ms, "Asia/Kolkata").getHours()).toBe(4); // 04:30 IST: getHours() reads the user's hour
    expect(wallClock(ms, "Asia/Kolkata").getMinutes()).toBe(30);
  });

  it("follows daylight saving", () => {
    const winter = Date.UTC(2026, 0, 15, 12, 0, 0);
    const summer = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(wallClock(winter, "America/New_York").getHours()).toBe(7);
    expect(wallClock(summer, "America/New_York").getHours()).toBe(8);
  });

  it("treats midnight as 0, not 24", () => {
    expect(wallClock(Date.UTC(2026, 9, 22, 18, 30, 0), "Asia/Kolkata").getHours()).toBe(0);
  });
});

describe("assertTimeZone", () => {
  it("accepts an IANA zone and rejects anything else", () => {
    expect(() => assertTimeZone("Asia/Kolkata")).not.toThrow();
    expect(() => assertTimeZone("India")).toThrow(/IANA/);
  });
});

describe("date strings", () => {
  it("counts whole days across month, year and leap boundaries", () => {
    expect(daysBetween("2026-10-22", "2026-10-25")).toBe(3);
    expect(daysBetween("2026-10-22", "2026-10-20")).toBe(-2);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("adds days", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
