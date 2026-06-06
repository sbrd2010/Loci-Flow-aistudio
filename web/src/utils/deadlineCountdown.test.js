import { describe, it, expect } from "vitest";
import { formatCountdown } from "./deadlineCountdown.js";

describe("formatCountdown", () => {
  it("formats exactly one day", () => {
    expect(formatCountdown(86400 * 1000)).toBe("1d 00h 00m 00s");
  });

  it("formats 119d 08h 14m 22s", () => {
    const ms = (119 * 86400 + 8 * 3600 + 14 * 60 + 22) * 1000;
    expect(formatCountdown(ms)).toBe("119d 08h 14m 22s");
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

  it("formats less than one hour", () => {
    expect(formatCountdown((14 * 60 + 5) * 1000)).toBe("0d 00h 14m 05s");
  });
});
