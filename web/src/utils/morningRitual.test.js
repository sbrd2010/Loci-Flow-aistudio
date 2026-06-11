import { describe, it, expect } from "vitest";
import { getMorningRitualVariant, isMorningRitualSlot, shouldShowMorningRitual } from "./morningRitual";
import { getFocusWindows } from "./focusWindows";

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);

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

describe("isMorningRitualSlot / shouldShowMorningRitual with a 09:00-17:00 focus window", () => {
  // Eligible from 09:00 onward, with no upper bound, until shown or snoozed.
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });

  // 1. popup appears after first focus window start
  it("is eligible right at the first focus window start", () => {
    expect(isMorningRitualSlot(dt(9, 0), windows)).toBe(true);
    expect(shouldShowMorningRitual(dt(9, 0), windows, {}, [])).toBe(true);
  });

  it("is not eligible before the focus window opens", () => {
    expect(isMorningRitualSlot(dt(8, 59), windows)).toBe(false);
    expect(shouldShowMorningRitual(dt(8, 59), windows, {}, [])).toBe(false);
  });

  // 2. popup appears on first app open after start time
  it("is still eligible if the app is first opened later within the morning slot", () => {
    expect(shouldShowMorningRitual(dt(10, 30), windows, {}, [])).toBe(true);
  });

  it("is still eligible later in the day (e.g. opening at noon after a 09:00 start)", () => {
    expect(isMorningRitualSlot(dt(12), windows)).toBe(true);
    expect(shouldShowMorningRitual(dt(12), windows, {}, [])).toBe(true);
  });

  // 3. Done hides it for the day
  it("Done (recording 'morning' as shown) hides it for the rest of the day", () => {
    expect(shouldShowMorningRitual(dt(9, 30), windows, {}, ["morning"])).toBe(false);
  });

  // 4. Later snoozes it
  it("Later (snoozeUntil in the future) hides it until the snooze passes", () => {
    const config = { anchorsSnoozeUntil: dt(11, 0).getTime() };
    expect(shouldShowMorningRitual(dt(10, 30), windows, config, [])).toBe(false);
    expect(shouldShowMorningRitual(dt(11, 0), windows, config, [])).toBe(true);
  });

  // 5. no anchors configured does not crash: trigger logic never looks at anchors
  it("eligibility does not depend on whether any anchors are configured", () => {
    expect(shouldShowMorningRitual(dt(9, 30), windows, {}, [])).toBe(true);
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
