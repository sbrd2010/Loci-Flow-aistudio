import { describe, expect, it } from "vitest";
import { shouldReflowPastRoute } from "./dayMapRoute";

describe("shouldReflowPastRoute", () => {
  it("returns true when the first scheduled task starts before the current anchor", () => {
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 720 }], 930)).toBe(true);
  });

  it("returns false when the route already starts at the anchor", () => {
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 930 }], 930)).toBe(false);
  });

  it("returns false when the route starts after the anchor", () => {
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 960 }], 930)).toBe(false);
  });

  it("returns false for empty or malformed routes", () => {
    expect(shouldReflowPastRoute([], 930)).toBe(false);
    expect(shouldReflowPastRoute(null, 930)).toBe(false);
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: "not-time" }], 930)).toBe(false);
  });
});
