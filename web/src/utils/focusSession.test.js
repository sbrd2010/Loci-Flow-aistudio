import { describe, it, expect } from "vitest";
import { shouldShowFloatingTimer, buildExtendedTimerState, shouldStopFocusOnComplete } from "./focusSession";

describe("shouldShowFloatingTimer", () => {
  const base = { activeTab: "roadmap", focusSessionActive: true, hasActiveTask: true, isFocusMode: false };

  it("shows the floating timer on a non-Today tab while a session is active", () => {
    expect(shouldShowFloatingTimer(base)).toBe(true);
  });

  it("shows the floating timer on Today when the dark Focus overlay is closed", () => {
    expect(shouldShowFloatingTimer({ ...base, activeTab: "today", isFocusMode: false })).toBe(true);
  });

  it("hides the floating timer on Today while the dark Focus overlay is open", () => {
    expect(shouldShowFloatingTimer({ ...base, activeTab: "today", isFocusMode: true })).toBe(false);
  });

  it("hides the floating timer on Day Map regardless of session state", () => {
    expect(shouldShowFloatingTimer({ ...base, activeTab: "daymap" })).toBe(false);
    expect(shouldShowFloatingTimer({ ...base, activeTab: "daymap", isFocusMode: true })).toBe(false);
  });

  it("hides the floating timer once the session has ended", () => {
    expect(shouldShowFloatingTimer({ ...base, focusSessionActive: false })).toBe(false);
  });

  it("hides the floating timer when there is no active task", () => {
    expect(shouldShowFloatingTimer({ ...base, hasActiveTask: false })).toBe(false);
  });
});

describe("buildExtendedTimerState", () => {
  it("converts minutes to seconds for both the countdown and its max", () => {
    expect(buildExtendedTimerState(15)).toEqual({ timerMaxSeconds: 900, timerSecondsLeft: 900, isTimerRunning: true });
  });

  it("restarts the timer in a running state", () => {
    expect(buildExtendedTimerState(5).isTimerRunning).toBe(true);
  });

  it("supports every duration in the Keep Going picker", () => {
    for (const mins of [5, 10, 15, 20, 25, 30, 45, 60, 90, 120]) {
      expect(buildExtendedTimerState(mins)).toEqual({ timerMaxSeconds: mins * 60, timerSecondsLeft: mins * 60, isTimerRunning: true });
    }
  });

  it("never returns a negative duration", () => {
    expect(buildExtendedTimerState(-5)).toEqual({ timerMaxSeconds: 0, timerSecondsLeft: 0, isTimerRunning: true });
  });
});

describe("shouldStopFocusOnComplete", () => {
  it("stops the focus session when completing the currently focused task", () => {
    expect(shouldStopFocusOnComplete({ isNowFocus: true }, true)).toBe(true);
  });

  it("does not stop the focus session when completing a different task", () => {
    expect(shouldStopFocusOnComplete({ isNowFocus: false }, true)).toBe(false);
  });

  it("does not stop the focus session when un-completing the focused task", () => {
    expect(shouldStopFocusOnComplete({ isNowFocus: true }, false)).toBe(false);
  });

  it("handles a missing task gracefully", () => {
    expect(shouldStopFocusOnComplete(null, true)).toBe(false);
  });
});
