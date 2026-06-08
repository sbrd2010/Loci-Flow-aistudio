import { describe, it, expect } from "vitest";
import {
  getLociDayStr,
  getCurrentAnchorSlot,
  getAnchorVariant,
  getTodayCheckedIds,
  getTodayShownSlots,
} from "./dailyAnchors";

const dt = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe("getLociDayStr", () => {
  it("returns today for 10am inside window", () => {
    expect(getLociDayStr(dt(2024, 6, 15, 10), 7, 26)).toBe("2024-06-15");
  });

  it("returns yesterday for 1am with dayEndHour=26 (still in prev Loci day)", () => {
    expect(getLociDayStr(dt(2024, 6, 16, 1), 7, 26)).toBe("2024-06-15");
  });

  it("returns calendar day for 4am when wrapHour=2 (gap between days)", () => {
    // 4am is past wrapHour=2 but before dayStartHour=7, so it's the gap → calendar today
    expect(getLociDayStr(dt(2024, 6, 15, 4), 7, 26)).toBe("2024-06-15");
  });

  it("uses calendar date for standard window (dayEndHour < 24)", () => {
    expect(getLociDayStr(dt(2024, 6, 15, 22), 7, 22)).toBe("2024-06-15");
  });

  it("handles midnight exactly as previous day for dayEndHour=26", () => {
    // 0:00 → hour 0 < wrapHour 2 → previous day
    expect(getLociDayStr(dt(2024, 6, 16, 0), 7, 26)).toBe("2024-06-15");
  });
});

describe("getCurrentAnchorSlot", () => {
  const s = 7, e = 26; // window 7am-2am, thirds ≈6.33h each

  it("returns morning for 9am", () => {
    expect(getCurrentAnchorSlot(dt(2024, 6, 15, 9), s, e)).toBe("morning");
  });

  it("returns afternoon for 2pm", () => {
    expect(getCurrentAnchorSlot(dt(2024, 6, 15, 14), s, e)).toBe("afternoon");
  });

  it("returns evening for 9pm", () => {
    expect(getCurrentAnchorSlot(dt(2024, 6, 15, 21), s, e)).toBe("evening");
  });

  it("returns evening for 1am (Loci hour 25)", () => {
    expect(getCurrentAnchorSlot(dt(2024, 6, 16, 1), s, e)).toBe("evening");
  });

  it("returns null before window starts (5am)", () => {
    expect(getCurrentAnchorSlot(dt(2024, 6, 15, 5), s, e)).toBeNull();
  });

  it("returns null at wrapHour exactly (2am = dayEndHour boundary)", () => {
    expect(getCurrentAnchorSlot(dt(2024, 6, 16, 2), s, e)).toBeNull();
  });

  it("returns null outside standard (non-overnight) window", () => {
    expect(getCurrentAnchorSlot(dt(2024, 6, 15, 23), 7, 22)).toBeNull();
  });

  it("returns morning for 7am exactly (window start)", () => {
    expect(getCurrentAnchorSlot(dt(2024, 6, 15, 7), s, e)).toBe("morning");
  });
});

describe("getAnchorVariant", () => {
  it("returns same variant for same calendar day", () => {
    const d1 = dt(2024, 6, 15, 9);
    const d2 = dt(2024, 6, 15, 21);
    expect(getAnchorVariant(d1)).toEqual(getAnchorVariant(d2));
  });

  it("rotates to different combination on next day", () => {
    const v1 = getAnchorVariant(dt(2024, 1, 1, 10));
    const v2 = getAnchorVariant(dt(2024, 1, 2, 10));
    // At least one field must differ
    expect(v1.title !== v2.title || v1.accentColor !== v2.accentColor).toBe(true);
  });

  it("has title, intro, and accentColor strings", () => {
    const v = getAnchorVariant(dt(2024, 6, 15, 10));
    expect(typeof v.title).toBe("string");
    expect(typeof v.intro).toBe("string");
    expect(typeof v.accentColor).toBe("string");
    expect(v.title.length).toBeGreaterThan(0);
    expect(v.intro.length).toBeGreaterThan(0);
  });

  it("cycles back after 6 days (6 copy variants)", () => {
    const base = new Date(2024, 0, 1); // Jan 1
    const v0 = getAnchorVariant(base);
    const v6 = getAnchorVariant(new Date(2024, 0, 7)); // Jan 7 = +6 days
    expect(v0.title).toBe(v6.title);
  });
});

describe("getTodayCheckedIds", () => {
  it("returns empty for date mismatch", () => {
    expect(getTodayCheckedIds({ anchorsCheckedDate: "2024-01-01", anchorsCheckedIds: ["a1"] }, "2024-06-15")).toEqual([]);
  });

  it("returns ids for matching date", () => {
    expect(getTodayCheckedIds({ anchorsCheckedDate: "2024-06-15", anchorsCheckedIds: ["a1", "a2"] }, "2024-06-15")).toEqual(["a1", "a2"]);
  });

  it("returns empty for missing config fields", () => {
    expect(getTodayCheckedIds({}, "2024-06-15")).toEqual([]);
  });

  it("returns empty for null anchorsCheckedDate", () => {
    expect(getTodayCheckedIds({ anchorsCheckedDate: null, anchorsCheckedIds: ["a1"] }, "2024-06-15")).toEqual([]);
  });
});

describe("getTodayShownSlots", () => {
  it("returns empty for date mismatch", () => {
    expect(getTodayShownSlots({ anchorsSlotsDate: "2024-01-01", anchorsShownSlots: ["morning"] }, "2024-06-15")).toEqual([]);
  });

  it("returns slots for matching date", () => {
    expect(getTodayShownSlots({ anchorsSlotsDate: "2024-06-15", anchorsShownSlots: ["morning", "afternoon"] }, "2024-06-15")).toEqual(["morning", "afternoon"]);
  });

  it("returns empty for missing fields", () => {
    expect(getTodayShownSlots({}, "2024-06-15")).toEqual([]);
  });
});
