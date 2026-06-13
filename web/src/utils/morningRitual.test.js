import { describe, it, expect } from "vitest";
import { getMorningRitualVariant, isMorningRitualSlot, isMorningRitualWindow, shouldShowMorningRitual, buildMorningRitualDoneConfig, buildMorningRitualSnoozeConfig } from "./morningRitual";
import { getFocusWindows } from "./focusWindows";

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);
const dtNextDay = (h, mi = 0) => new Date(2024, 5, 16, h, mi);

describe("getMorningRitualVariant", () => {
  it("returns a non-empty title and line", () => {
    const v = getMorningRitualVariant(dt(9));
    expect(typeof v.title).toBe("string");
    expect(typeof v.line).toBe("string");
    expect(v.title.length).toBeGreaterThan(0);
    expect(v.line.length).toBeGreaterThan(0);
  });

  it("returns the same variant for the same calendar day", () => {
    expect(getMorningRitualVariant(dt(8))).toEqual(getMorningRitualVariant(dt(20)));
  });

  it("rotates to a different variant on another day", () => {
    const v1 = getMorningRitualVariant(new Date(2024, 0, 1, 9));
    const v2 = getMorningRitualVariant(new Date(2024, 0, 2, 9));
    expect(v1.title === v2.title && v1.line === v2.line).toBe(false);
  });
});

describe("isMorningRitualSlot with a 09:00-17:00 focus window", () => {
  // Used by the Daily Coach check-ins, which remain Focus-Window based.
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });

  it("is eligible right at the first focus window start", () => {
    expect(isMorningRitualSlot(dt(9, 0), windows)).toBe(true);
  });

  it("is not eligible before the focus window opens", () => {
    expect(isMorningRitualSlot(dt(8, 59), windows)).toBe(false);
  });

  it("is still eligible later in the day (e.g. opening at noon after a 09:00 start)", () => {
    expect(isMorningRitualSlot(dt(12), windows)).toBe(true);
  });
});

describe("isMorningRitualSlot follows flexible focus windows, not a hardcoded hour", () => {
  it("uses an overnight window's start time (16:00) as the eligibility start, with no upper bound", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "16:00", end: "03:00" }] });
    expect(isMorningRitualSlot(dt(15, 59), windows)).toBe(false);
    expect(isMorningRitualSlot(dt(16, 0), windows)).toBe(true);
    expect(isMorningRitualSlot(dt(19, 30), windows)).toBe(true);
    expect(isMorningRitualSlot(dt(20, 0), windows)).toBe(true);
  });

  it("falls back to dayStartHour/dayEndHour (7am-2am) when no focusWindows are configured", () => {
    const windows = getFocusWindows({});
    expect(isMorningRitualSlot(dt(6, 59), windows)).toBe(false);
    expect(isMorningRitualSlot(dt(7, 0), windows)).toBe(true);
  });
});

describe("isMorningRitualWindow", () => {
  it("defaults to 05:00-11:00", () => {
    expect(isMorningRitualWindow(dt(4, 59), {})).toBe(false);
    expect(isMorningRitualWindow(dt(5, 0), {})).toBe(true);
    expect(isMorningRitualWindow(dt(10, 59), {})).toBe(true);
    expect(isMorningRitualWindow(dt(11, 0), {})).toBe(false);
  });

  it("respects a custom configured window", () => {
    const config = { morningRitualWindowStart: "06:00", morningRitualWindowEnd: "09:00" };
    expect(isMorningRitualWindow(dt(5, 30), config)).toBe(false);
    expect(isMorningRitualWindow(dt(6, 0), config)).toBe(true);
    expect(isMorningRitualWindow(dt(8, 59), config)).toBe(true);
    expect(isMorningRitualWindow(dt(9, 0), config)).toBe(false);
  });

  it("falls back to defaults when start and end are equal", () => {
    const config = { morningRitualWindowStart: "08:00", morningRitualWindowEnd: "08:00" };
    expect(isMorningRitualWindow(dt(5, 30), config)).toBe(true);
  });

  it("falls back to defaults when the range is inverted (start after end)", () => {
    const config = { morningRitualWindowStart: "12:00", morningRitualWindowEnd: "06:00" };
    expect(isMorningRitualWindow(dt(5, 30), config)).toBe(true);
  });

  it("falls back to defaults when fields are missing or malformed", () => {
    expect(isMorningRitualWindow(dt(7, 30), {})).toBe(true);
    expect(isMorningRitualWindow(dt(7, 30), { morningRitualWindowStart: "not-a-time", morningRitualWindowEnd: "11:00" })).toBe(true);
  });
});

describe("shouldShowMorningRitual", () => {
  it("is eligible inside the default 05:00-11:00 window", () => {
    expect(shouldShowMorningRitual(dt(7, 30), {})).toBe(true);
  });

  it("is not eligible outside the default window, with no fallback for a missed morning", () => {
    expect(shouldShowMorningRitual(dt(4, 59), {})).toBe(false);
    expect(shouldShowMorningRitual(dt(11, 0), {})).toBe(false);
    expect(shouldShowMorningRitual(dt(15, 0), {})).toBe(false);
  });

  it("is independent of Focus Windows", () => {
    const config = { focusWindows: [{ start: "09:00", end: "17:00" }] };
    expect(shouldShowMorningRitual(dt(7, 30), config)).toBe(true);
  });

  it("Done (morningRitualShownDate matching today) hides it for the rest of the local day", () => {
    expect(shouldShowMorningRitual(dt(9, 0), { morningRitualShownDate: "2024-06-15" })).toBe(false);
  });

  it("a stale shown date from a previous day does not hide it", () => {
    expect(shouldShowMorningRitual(dt(9, 0), { morningRitualShownDate: "2024-06-14" })).toBe(true);
  });

  it("Later (snoozeUntil in the future) hides it until the snooze passes", () => {
    const config = { morningRitualSnoozeUntil: dt(8, 0).getTime() };
    expect(shouldShowMorningRitual(dt(7, 0), config)).toBe(false);
    expect(shouldShowMorningRitual(dt(8, 0), config)).toBe(true);
  });

  it("a snooze that expires after the window closes stays hidden (window check wins)", () => {
    const config = { morningRitualSnoozeUntil: dt(12, 0).getTime() };
    expect(shouldShowMorningRitual(dt(11, 0), config)).toBe(false);
  });

  it("honors a custom configured window end-to-end", () => {
    const config = { morningRitualWindowStart: "06:00", morningRitualWindowEnd: "09:00" };
    expect(shouldShowMorningRitual(dt(5, 30), config)).toBe(false);
    expect(shouldShowMorningRitual(dt(7, 0), config)).toBe(true);
  });

  it("is disabled entirely when morningRitualEnabled is false, regardless of window", () => {
    expect(shouldShowMorningRitual(dt(7, 30), { morningRitualEnabled: false })).toBe(false);
  });

  it("defaults to enabled when morningRitualEnabled is unset", () => {
    expect(shouldShowMorningRitual(dt(7, 30), {})).toBe(true);
  });
});

describe("buildMorningRitualDoneConfig / buildMorningRitualSnoozeConfig", () => {
  it("buildMorningRitualDoneConfig records today's local date and clears any snooze", () => {
    expect(buildMorningRitualDoneConfig(dt(7, 30))).toEqual({
      morningRitualShownDate: "2024-06-15",
      morningRitualSnoozeUntil: null,
    });
  });

  it("buildMorningRitualSnoozeConfig snoozes for 90 minutes", () => {
    expect(buildMorningRitualSnoozeConfig(dt(7, 30))).toEqual({
      morningRitualSnoozeUntil: dt(7, 30).getTime() + 90 * 60 * 1000,
    });
  });

  it("Done hides the ritual for the rest of the local day but not the next day", () => {
    const doneConfig = buildMorningRitualDoneConfig(dt(7, 30));
    expect(shouldShowMorningRitual(dt(9, 0), doneConfig)).toBe(false);
    expect(shouldShowMorningRitual(dtNextDay(7, 0), doneConfig)).toBe(true);
  });
});
