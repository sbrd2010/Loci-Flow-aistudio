import { describe, it, expect } from "vitest";
import { appScale } from "./useAppScale";

describe("appScale (Turn 76)", () => {
  it("is 1 on a laptop and below", () => {
    expect(appScale(1280, 720)).toBe(1);
    expect(appScale(1024, 768)).toBe(1);
    expect(appScale(412, 760)).toBe(1);
  });
  it("follows the height on a 24-inch 1903×940 window: ×1.175", () => {
    expect(appScale(1903, 940)).toBeCloseTo(1.175, 5);
  });
  it("takes the smaller of width and height", () => {
    expect(appScale(1600, 900)).toBeCloseTo(1.125, 5);
    expect(appScale(2560, 1305)).toBeCloseTo(1305 / 800, 5);
    expect(appScale(1500, 2000)).toBeCloseTo(1500 / 1422, 5);
  });
  it("stops at 28.5/16", () => {
    expect(appScale(5120, 2880)).toBe(28.5 / 16);
  });
  it("is 1 for a missing size", () => {
    expect(appScale(0, 0)).toBe(1);
    expect(appScale(NaN, 900)).toBe(1);
  });
});
