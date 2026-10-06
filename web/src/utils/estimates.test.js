import { describe, expect, it } from "vitest";
import { ESTIMATE_CHIPS, formatEstimate, parseEstimate } from "./estimates";

describe("estimates", () => {
  it("offers one set of chips, 5m to 3h", () => {
    expect(ESTIMATE_CHIPS.map(formatEstimate)).toEqual(["5m", "15m", "25m", "30m", "45m", "1h", "1h30m", "2h", "3h"]);
  });

  it("reads what people type", () => {
    for (const [text, min] of [
      ["40", 40], ["40m", 40], ["40 min", 40], ["40 minutes", 40],
      ["1h", 60], ["1h20", 80], ["1h 20m", 80], ["1 h 20 min", 80], ["1:20", 80],
      ["1.5h", 90], ["1,5h", 90], ["2 hours", 120], [" 3H ", 180], ["12h", 720],
    ]) expect(parseEstimate(text), text).toBe(min);
  });

  it("refuses what isn't a length from 1 minute to 12 hours", () => {
    for (const text of ["", "  ", "0", "0m", "abc", "-5", "13h", "721", "1.5h20", "1h20h", "m"]) {
      expect(parseEstimate(text), text).toBeNull();
    }
  });

  it("reads back what it writes", () => {
    for (const m of [5, 40, 60, 80, 90, 135, 720]) expect(parseEstimate(formatEstimate(m))).toBe(m);
  });
});
