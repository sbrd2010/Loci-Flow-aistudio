import { describe, expect, it } from "vitest";

import {
  DAILY_QUOTE_CATEGORY_PATTERN,
  FOCUS_QUOTES,
  countQuoteCategories,
  getDailyFocusQuotePlan,
  getFocusQuoteForSlot,
  getQuoteCategoryForSlot,
  getTwoHourSlot,
} from "./focusQuotes";

function countWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

describe("focus quote rotation", () => {
  it("uses exactly 12 two-hour slots with a 6/4/2 category mix", () => {
    expect(DAILY_QUOTE_CATEGORY_PATTERN).toHaveLength(12);

    const plan = getDailyFocusQuotePlan(new Date(2026, 5, 5, 9, 0, 0));

    expect(countQuoteCategories(plan)).toEqual({
      execution: 6,
      focus: 4,
      antiPlanning: 2,
    });
  });

  it("maps local hours to two-hour quote slots", () => {
    expect(getTwoHourSlot(new Date(2026, 5, 5, 0, 0, 0))).toBe(0);
    expect(getTwoHourSlot(new Date(2026, 5, 5, 1, 59, 0))).toBe(0);
    expect(getTwoHourSlot(new Date(2026, 5, 5, 2, 0, 0))).toBe(1);
    expect(getTwoHourSlot(new Date(2026, 5, 5, 23, 59, 0))).toBe(11);
  });

  it("returns the same quote inside the same local two-hour slot", () => {
    const first = getFocusQuoteForSlot(new Date(2026, 5, 5, 8, 1, 0));
    const second = getFocusQuoteForSlot(new Date(2026, 5, 5, 9, 59, 0));

    expect(first.id).toBe(second.id);
    expect(first.category).toBe(getQuoteCategoryForSlot(4));
  });

  it("returns a quote for every slot without adjacent duplicates", () => {
    const plan = getDailyFocusQuotePlan(new Date(2026, 5, 5, 12, 0, 0));

    expect(plan).toHaveLength(12);

    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      expect(item.slot).toBe(index);
      expect(item.quote?.quote).toBeTruthy();
      expect(item.quote.category).toBe(item.category);

      if (index > 0) {
        expect(item.quote.id).not.toBe(plan[index - 1].quote.id);
      }
    }
  });

  it("keeps all displayed quotes compact and categorized", () => {
    expect(FOCUS_QUOTES.length).toBeGreaterThanOrEqual(100);

    for (const item of FOCUS_QUOTES) {
      expect(["execution", "focus", "antiPlanning"]).toContain(item.category);
      expect(item.quote).toBe(item.text);
      expect(item.author).toBeTruthy();
      expect(item.wordCount).toBe(countWords(item.quote));
      expect(item.wordCount).toBeLessThanOrEqual(14);
    }
  });
});
