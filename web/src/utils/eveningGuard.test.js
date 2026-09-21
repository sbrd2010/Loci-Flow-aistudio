import { describe, it, expect } from "vitest";
import { isEveningGuardBlocked, EVENING_GUARD_HOUR } from "./eveningGuard";

// The rule was written inline in AddTaskDialog and again in coachActions, and
// a third creation path — the wall's commit field — was built without it and
// bypassed the setting entirely. One predicate, so the next new path has
// something to call rather than something to remember.
const at = (hour, minute = 0) => new Date(2024, 5, 15, hour, minute);
const on = { eveningGuardWindowActive: true };

describe("isEveningGuardBlocked", () => {
  it("blocks from 8pm", () => {
    expect(isEveningGuardBlocked(on, at(EVENING_GUARD_HOUR))).toBe(true);
    expect(isEveningGuardBlocked(on, at(23, 59))).toBe(true);
  });

  it("allows before 8pm", () => {
    expect(isEveningGuardBlocked(on, at(19, 59))).toBe(false);
    expect(isEveningGuardBlocked(on, at(9))).toBe(false);
  });

  // The boundary is the hour, not the day: after midnight is a new day and
  // the guard is off again, which is the behaviour both existing call sites
  // already had.
  it("is off again after midnight", () => {
    expect(isEveningGuardBlocked(on, at(0, 30))).toBe(false);
    expect(isEveningGuardBlocked(on, at(1))).toBe(false);
  });

  it("does nothing when the user has not switched it on", () => {
    expect(isEveningGuardBlocked({}, at(22))).toBe(false);
    expect(isEveningGuardBlocked({ eveningGuardWindowActive: false }, at(22))).toBe(false);
    expect(isEveningGuardBlocked(undefined, at(22))).toBe(false);
  });

  it("accepts an epoch as well as a Date", () => {
    expect(isEveningGuardBlocked(on, at(22).getTime())).toBe(true);
  });
});
