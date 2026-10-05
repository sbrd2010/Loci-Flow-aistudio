import { describe, it, expect } from "vitest";
import { rescueHint, settleShown, earlyEndsInLastHour, hintLine, rescueHintSwitchPatch, RESCUE_STATE } from "./rescueHint";

const MIN = 60000;
const base = {
  config: {}, todayStr: "2024-06-15", nowMs: 1000 * MIN, lociNow: 600, dayStart: 420, inWindow: true,
  focusActive: false, visible: true, oneThingId: "t1", sinceMs: 1000 * MIN - 50 * MIN,
};

describe("rescueHint", () => {
  it("shows after 45 minutes with no start, naming the minutes", () => {
    expect(rescueHint(base)).toEqual({ kind: "idle", minutes: 50, isNew: true });
    expect(rescueHint({ ...base, sinceMs: base.nowMs - 44 * MIN })).toBeNull();
  });

  it("I'm stuck twice and two early ends come first", () => {
    expect(rescueHint({ ...base, stuckCount: 2 }).kind).toBe("stuck");
    expect(rescueHint({ ...base, earlyEnds: 2 }).kind).toBe("early");
    expect(rescueHint({ ...base, stuckCount: 2, earlyEnds: 2 }).kind).toBe("stuck");
  });

  it("never during focus, off-screen, outside working hours, in the first 30 minutes, without a one thing, or when off", () => {
    expect(rescueHint({ ...base, focusActive: true })).toBeNull();
    expect(rescueHint({ ...base, visible: false })).toBeNull();
    expect(rescueHint({ ...base, inWindow: false })).toBeNull();
    expect(rescueHint({ ...base, lociNow: base.dayStart + 29 })).toBeNull();
    expect(rescueHint({ ...base, oneThingId: null })).toBeNull();
    expect(rescueHint({ ...base, config: { rescueHintOff: true } })).toBeNull();
  });

  it("once a day: it stays with the same words until tapped, then nothing more today", () => {
    const shown = { date: base.todayStr, kind: "idle", minutes: 50, acted: false };
    expect(rescueHint({ ...base, sinceMs: base.nowMs, config: { rescueHintShown: shown } })).toEqual({ kind: "idle", minutes: 50, isNew: false });
    expect(rescueHint({ ...base, stuckCount: 2, config: { rescueHintShown: { ...shown, acted: true } } })).toBeNull();
    // Even off-screen, a hint already up stays up (it isn't new).
    expect(rescueHint({ ...base, visible: false, config: { rescueHintShown: shown } })).not.toBeNull();
  });
});

describe("settleShown", () => {
  it("counts an untapped day as ignored, turns off at three, and resets on a tap", () => {
    expect(settleShown({ rescueHintShown: { date: "2024-06-14", acted: false }, rescueHintIgnored: 1 }, "2024-06-15"))
      .toEqual({ rescueHintShown: null, rescueHintIgnored: 2 });
    expect(settleShown({ rescueHintShown: { date: "2024-06-14", acted: false }, rescueHintIgnored: 2 }, "2024-06-15"))
      .toEqual({ rescueHintShown: null, rescueHintIgnored: 3, rescueHintOff: true });
    expect(settleShown({ rescueHintShown: { date: "2024-06-14", acted: true }, rescueHintIgnored: 2 }, "2024-06-15"))
      .toEqual({ rescueHintShown: null, rescueHintIgnored: 0 });
    expect(settleShown({ rescueHintShown: { date: "2024-06-15" } }, "2024-06-15")).toBeNull();
    expect(settleShown({}, "2024-06-15")).toBeNull();
  });
});

describe("earlyEndsInLastHour", () => {
  it("counts blocks ended well short of plan in the last hour, today", () => {
    const now = 1000 * MIN;
    const e = (endedMinAgo, elapsed, planned = 1500, day = "2024-06-15") => ({
      lociDateString: day, focusEndedAt: now - endedMinAgo * MIN, focusElapsedSeconds: elapsed, focusFinalPlannedSeconds: planned,
    });
    expect(earlyEndsInLastHour([e(10, 300), e(50, 600), e(70, 300), e(5, 1490), e(5, 300, 1500, "2024-06-14")], "2024-06-15", now)).toBe(2);
  });
});

describe("words and states", () => {
  it("each trigger has its line and its Rescue state", () => {
    expect(hintLine("idle", 50)).toBe("This one hasn’t started in 50 minutes.");
    expect(hintLine("stuck")).toBe("You’ve hit a wall on this one twice.");
    expect(hintLine("early")).toBe("Two blocks ended early this hour.");
    expect(RESCUE_STATE).toEqual({ idle: "anxious", stuck: "overwhelmed", early: "distracted" });
  });
});

describe("rescueHintSwitchPatch", () => {
  it("back on clears a left-over hint, so it doesn't count as ignored at once", () => {
    const config = { rescueHintOff: true, rescueHintIgnored: 2, rescueHintShown: { date: "2024-06-10", acted: false } };
    const on = { ...config, ...rescueHintSwitchPatch(true) };
    expect(on).toMatchObject({ rescueHintOff: false, rescueHintIgnored: 0, rescueHintShown: null });
    expect(settleShown(on, "2024-06-15")).toBeNull();
    expect(rescueHintSwitchPatch(false)).toEqual({ rescueHintOff: true });
  });
});
