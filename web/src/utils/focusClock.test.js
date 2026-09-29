import { describe, expect, it } from "vitest";
import { clockParts, ringGeometry } from "./focusClock";

describe("the focus clock (59a)", () => {
  it("reads mm:ss, and h:mm:ss for a block over 99 minutes", () => {
    expect(clockParts(18 * 60 + 42, 25 * 60)).toEqual({ lead: "18", seconds: "42", hours: false, lastMinute: false });
    expect(clockParts(65 * 60 + 7, 120 * 60)).toEqual({ lead: "1:05", seconds: "07", hours: true, lastMinute: false });
    expect(clockParts(99 * 60, 99 * 60).hours).toBe(false);
  });

  it("puts the seconds at full size from 0:59 left", () => {
    expect(clockParts(60, 1500).lastMinute).toBe(false);
    expect(clockParts(59, 1500).lastMinute).toBe(true);
  });

  it("draws the ring: stroke size/48 (at least 4), the arc the share left, digits 21% or 16%", () => {
    const g = ringGeometry(384, 750, 1500);
    expect(g.stroke).toBe(8);
    expect(g.dash).toBe(`${g.c / 2} ${g.c}`);
    expect(g.offset).toBeCloseTo(-g.c / 2);
    expect(g.fontSize).toBeCloseTo(384 * 0.21);
    expect(ringGeometry(132, 0, 1500).stroke).toBe(4);
    expect(ringGeometry(248, 1500, 1500, true).fontSize).toBeCloseTo(248 * 0.16);
  });
});
