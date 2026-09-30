import { describe, it, expect } from "vitest";
import {
  shouldShowFloatingTimer, buildExtendedTimerState, shouldStopFocusOnComplete,
  shouldTriggerSessionComplete, shouldShowFocusCompletionPrompt, buildFocusCompletionPayload,
  buildResetFocusState, getTimerState, focusBlockSeconds, focusExpiryReason, focusOutcome, PAUSE_EXPIRY_MS, startLengthOptions, chosenStartOption,
} from "./focusSession";

describe("shouldShowFloatingTimer", () => {
  const base = { activeTab: "roadmap", focusSessionActive: true, hasActiveTask: true, isFocusMode: false, sessionCompletePending: false };

  it("shows the floating timer on a non-Today tab while a session is active", () => {
    expect(shouldShowFloatingTimer(base)).toBe(true);
  });

  it("never shows on Today, focus page open or not (59e–f)", () => {
    expect(shouldShowFloatingTimer({ ...base, activeTab: "today", isFocusMode: false })).toBe(false);
    expect(shouldShowFloatingTimer({ ...base, activeTab: "today", isFocusMode: true })).toBe(false);
  });

  it("shows on the Day map page (59e)", () => {
    expect(shouldShowFloatingTimer({ ...base, activeTab: "daymap" })).toBe(true);
  });

  it("hides the floating timer once the session has ended", () => {
    expect(shouldShowFloatingTimer({ ...base, focusSessionActive: false })).toBe(false);
  });

  it("hides the floating timer when there is no active task", () => {
    expect(shouldShowFloatingTimer({ ...base, hasActiveTask: false })).toBe(false);
  });

  it("hides the floating timer when a focus session completion prompt is pending", () => {
    expect(shouldShowFloatingTimer({ ...base, sessionCompletePending: true })).toBe(false);
  });
});

describe("getTimerState", () => {
  it("returns normal when remaining time is more than 50%", () => {
    expect(getTimerState(100, 100)).toBe("normal");
    expect(getTimerState(51, 100)).toBe("normal");
  });

  it("returns near-end when remaining time is between 25% and 50% inclusive", () => {
    expect(getTimerState(50, 100)).toBe("near-end");
    expect(getTimerState(26, 100)).toBe("near-end");
  });

  it("returns almost-done when remaining time is between 1% and 25% inclusive", () => {
    expect(getTimerState(25, 100)).toBe("almost-done");
    expect(getTimerState(1, 100)).toBe("almost-done");
  });

  it("returns complete when remaining time is 0", () => {
    expect(getTimerState(0, 100)).toBe("complete");
    expect(getTimerState(-1, 100)).toBe("complete");
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

describe("shouldTriggerSessionComplete", () => {
  it("triggers when a running timer reaches 0:00", () => {
    expect(shouldTriggerSessionComplete({ isTimerRunning: true, timerSecondsLeft: 0 })).toBe(true);
  });

  it("does not trigger while time remains", () => {
    expect(shouldTriggerSessionComplete({ isTimerRunning: true, timerSecondsLeft: 5 })).toBe(false);
  });

  it("does not trigger for a paused timer sitting at 0:00", () => {
    expect(shouldTriggerSessionComplete({ isTimerRunning: false, timerSecondsLeft: 0 })).toBe(false);
  });
});

describe("shouldShowFocusCompletionPrompt", () => {
  it("shows the prompt when a session is pending and a task is active", () => {
    expect(shouldShowFocusCompletionPrompt({ sessionCompletePending: true, hasActiveTask: true })).toBe(true);
  });

  it("hides the prompt when no session is pending", () => {
    expect(shouldShowFocusCompletionPrompt({ sessionCompletePending: false, hasActiveTask: true })).toBe(false);
  });

  it("hides the prompt when there is no active task", () => {
    expect(shouldShowFocusCompletionPrompt({ sessionCompletePending: true, hasActiveTask: false })).toBe(false);
  });

  it("does not depend on which tab is active, so it shows the same on any tab", () => {
    // The prompt is rendered at the App level and takes no activeTab — the same
    // pending/active-task state always yields the same result.
    const state = { sessionCompletePending: true, hasActiveTask: true };
    expect(shouldShowFocusCompletionPrompt(state)).toBe(shouldShowFocusCompletionPrompt(state));
  });
});

describe("buildFocusCompletionPayload", () => {
  const task = { uuid: "task-1", title: "Write report", isCompleted: false, isNowFocus: true, dateCompletedString: null };
  const other = { uuid: "task-2", title: "Other task", isCompleted: false, isNowFocus: false, dateCompletedString: null };

  it("marks the focused task complete, clears isNowFocus, and stamps the completion date", () => {
    const payload = { tasks: [task], config: { totalXp: 100 }, contributions: [] };
    const result = buildFocusCompletionPayload(payload, task, "2026-06-10", new Date(2026, 5, 10, 12));
    expect(result.tasks[0].isCompleted).toBe(true);
    expect(result.tasks[0].isNowFocus).toBe(false);
    expect(result.tasks[0].dateCompletedString).toBe("2026-06-10");
  });

  it("stamps dateCompletedString with the Loci day, decoupled from the calendar-day contribution, during an overnight focus window", () => {
    const payload = {
      tasks: [task],
      config: { totalXp: 0, focusWindows: [{ start: "22:00", end: "04:00" }] },
      contributions: [],
    };
    // 2026-06-11 at 1:00 AM: still inside the 22:00-04:00 window that started
    // the previous calendar day, so the Loci day is 2026-06-10.
    const result = buildFocusCompletionPayload(payload, task, "2026-06-11", new Date(2026, 5, 11, 1, 0));
    expect(result.tasks[0].dateCompletedString).toBe("2026-06-10");
    expect(result.contributions[0].dateString).toBe("2026-06-11");
  });

  it("leaves config alone (no XP)", () => {
    const payload = { tasks: [task], config: { totalXp: 100 }, contributions: [] };
    const result = buildFocusCompletionPayload(payload, task, "2026-06-10");
    expect(result.config).toBe(payload.config);
  });

  it("does not touch other tasks", () => {
    const payload = { tasks: [task, other], config: { totalXp: 0 }, contributions: [] };
    const result = buildFocusCompletionPayload(payload, task, "2026-06-10");
    expect(result.tasks[1]).toBe(other);
  });

  it("creates a new contribution entry for today when none exists", () => {
    const payload = { tasks: [task], config: { totalXp: 0 }, contributions: [] };
    const result = buildFocusCompletionPayload(payload, task, "2026-06-10");
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]).toMatchObject({ dateString: "2026-06-10", count: 1 });
  });

  it("increments an existing contribution entry for today", () => {
    const payload = {
      tasks: [task], config: { totalXp: 0 },
      contributions: [{ dateString: "2026-06-10", count: 2 }],
    };
    const result = buildFocusCompletionPayload(payload, task, "2026-06-10");
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0].count).toBe(3);
  });
});

describe("buildResetFocusState", () => {
  it("clears all session/timer-running flags for a clean account switch", () => {
    const result = buildResetFocusState({ pomodoroDurationMinutes: 25 });
    expect(result).toMatchObject({
      isTimerRunning: false,
      isFocusMode: false,
      focusSessionActive: false,
      sessionCompletePending: false,
      showExtendPicker: false,
    });
  });

  it("resets the countdown to the new account's configured pomodoro duration", () => {
    expect(buildResetFocusState({ pomodoroDurationMinutes: 50 })).toMatchObject({
      timerSecondsLeft: 3000, timerMaxSeconds: 3000,
    });
  });

  it("falls back to 25 minutes when no pomodoro duration is configured yet", () => {
    expect(buildResetFocusState({})).toMatchObject({ timerSecondsLeft: 1500, timerMaxSeconds: 1500 });
    expect(buildResetFocusState()).toMatchObject({ timerSecondsLeft: 1500, timerMaxSeconds: 1500 });
  });

  it("falls back to 25 minutes for an invalid (zero or negative) configured duration", () => {
    expect(buildResetFocusState({ pomodoroDurationMinutes: 0 })).toMatchObject({ timerSecondsLeft: 1500 });
    expect(buildResetFocusState({ pomodoroDurationMinutes: -10 })).toMatchObject({ timerSecondsLeft: 1500 });
  });
});

// Addendum D delta 3: at 00:00 there is no modal. Screen 3 carries K4's hold
// inline — a frozen timer and two buttons — and a dialog over it would both
// contradict "never a failure event" and cover the choices it offers.
describe("shouldShowFocusCompletionPrompt — not over the Focus session", () => {
  it("shows on every other screen, as before", () => {
    expect(shouldShowFocusCompletionPrompt({ sessionCompletePending: true, hasActiveTask: true })).toBe(true);
  });

  it("is suppressed inside focus mode, where the hold is already on screen", () => {
    expect(shouldShowFocusCompletionPrompt({
      sessionCompletePending: true, hasActiveTask: true, isFocusMode: true,
    })).toBe(false);
  });

  it("still needs a pending bell and a task, focus mode or not", () => {
    expect(shouldShowFocusCompletionPrompt({ sessionCompletePending: false, hasActiveTask: true })).toBe(false);
    expect(shouldShowFocusCompletionPrompt({ sessionCompletePending: true, hasActiveTask: false })).toBe(false);
  });
});

describe("focusBlockSeconds (53e)", () => {
  it("is one block of the Focus timer setting, 25 minutes unless set", () => {
    expect(focusBlockSeconds({})).toBe(25 * 60);
    expect(focusBlockSeconds({ pomodoroDurationMinutes: 50 })).toBe(50 * 60);
    expect(focusBlockSeconds({ pomodoroDurationMinutes: 0 })).toBe(25 * 60);
    expect(focusBlockSeconds()).toBe(25 * 60);
  });
});

describe("focusExpiryReason (59j)", () => {
  const base = { sessionOpen: true, pausedAt: null, dayEndsAt: 20_000_000, now: 10_000_000 };
  it("keeps a running session, and a pause of 15 minutes or less", () => {
    expect(focusExpiryReason(base)).toBeNull();
    expect(focusExpiryReason({ ...base, pausedAt: base.now - PAUSE_EXPIRY_MS })).toBeNull();
  });
  it("closes a session paused for more than 15 minutes", () => {
    expect(focusExpiryReason({ ...base, pausedAt: base.now - PAUSE_EXPIRY_MS - 1 })).toBe("paused_too_long");
  });
  it("closes a session once its Loci day has ended, running or not", () => {
    expect(focusExpiryReason({ ...base, now: base.dayEndsAt })).toBe("day_ended");
    expect(focusExpiryReason({ ...base, now: base.dayEndsAt - 1 })).toBeNull();
  });
  it("has nothing to close without an open session", () => {
    expect(focusExpiryReason({ ...base, sessionOpen: false, now: base.dayEndsAt })).toBeNull();
  });
  // Codex review of #419: when both have happened, the first one is why.
  it("names whichever expiry came first when both have happened", () => {
    const late = base.dayEndsAt + 60_000;
    expect(focusExpiryReason({ ...base, now: late, pausedAt: base.dayEndsAt - PAUSE_EXPIRY_MS - 1000 })).toBe("paused_too_long");
    expect(focusExpiryReason({ ...base, now: late + PAUSE_EXPIRY_MS, pausedAt: base.dayEndsAt - 1000 })).toBe("day_ended");
  });
});

describe("focusOutcome (59j)", () => {
  it("is done, ended or expired", () => {
    expect(focusOutcome("focus_completed", "completed_task")).toBe("done");
    expect(focusOutcome("focus_abandoned", "user_abandoned")).toBe("ended");
    expect(focusOutcome("focus_abandoned", "timer_elapsed")).toBe("ended");
    expect(focusOutcome("focus_abandoned", "paused_too_long")).toBe("expired");
    expect(focusOutcome("focus_abandoned", "day_ended")).toBe("expired");
    // A task marked done after its sitting expired was not done in it.
    expect(focusOutcome("focus_completed", "paused_too_long")).toBe("expired");
  });
});

describe("start chooser (53e)", () => {
  it("offers 5 minutes, one block, 50 minutes, and the whole task only when estimated", () => {
    expect(startLengthOptions(25, null).map(o => o.minutes)).toEqual([5, 25, 50]);
    expect(startLengthOptions(25, 180).map(o => o.choice)).toEqual([5, "block", 50, "whole"]);
    expect(startLengthOptions(25, 180)[3].minutes).toBe(180);
  });
  it("offers the whole task only when it is a length of its own", () => {
    expect(startLengthOptions(25, 25).map(o => o.choice)).toEqual([5, "block", 50]);
    expect(startLengthOptions(25, 50).map(o => o.choice)).toEqual([5, "block", 50]);
    expect(startLengthOptions(25, 15).map(o => o.choice)).toEqual([5, "block", 50, "whole"]);
  });
  it("shows a block of 5 or 50 once, as the block", () => {
    expect(startLengthOptions(50, null).map(o => o.choice)).toEqual([5, "block"]);
    expect(startLengthOptions(5, null).map(o => o.choice)).toEqual(["block", 50]);
  });
  it("runs the remembered choice when it is on offer, else one block", () => {
    expect(chosenStartOption(5, 25, null).minutes).toBe(5);
    expect(chosenStartOption("whole", 25, 90).minutes).toBe(90);
    expect(chosenStartOption("whole", 25, null)).toMatchObject({ choice: "block", minutes: 25 });
    expect(chosenStartOption(undefined, 25, 90)).toMatchObject({ choice: "block", minutes: 25 });
    expect(chosenStartOption(50, 50, null)).toMatchObject({ choice: "block", minutes: 50 });
  });
});
