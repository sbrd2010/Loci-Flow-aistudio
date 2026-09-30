import { describe, expect, it } from "vitest";
import { isWellOver, markNoteSeen, noteDue, reestimateChoices } from "./blockEnd";

describe("block end: over the estimate", () => {
  it("needs half as much again and 15 minutes past", () => {
    expect(isWellOver(30, 45)).toBe(true);
    expect(isWellOver(30, 44)).toBe(false);
    expect(isWellOver(20, 34)).toBe(false); // 1.7×, but only 14m past
    expect(isWellOver(0, 300)).toBe(false);
  });

  it("offers up to four lengths above the time spent", () => {
    expect(reestimateChoices(65)).toEqual([90, 120, 180, 240]);
    expect(reestimateChoices(400)).toEqual([480]);
  });

  it("shows once per task per day, and again for a new estimate", () => {
    let seen = {};
    expect(noteDue(seen, "a", "2026-09-29", 30)).toBe(true);
    seen = markNoteSeen(seen, "a", "2026-09-29", 30);
    expect(noteDue(seen, "a", "2026-09-29", 30)).toBe(false);
    expect(noteDue(seen, "a", "2026-09-29", 90)).toBe(true);
    expect(noteDue(seen, "a", "2026-09-30", 30)).toBe(true);
    expect(markNoteSeen(seen, "b", "2026-09-30", 60)).toEqual({ b: { day: "2026-09-30", estimate: 60 } });
  });
});
