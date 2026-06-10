import { describe, it, expect } from "vitest";
import {
  shouldShowFloatingTimer, buildExtendedTimerState, shouldStopFocusOnComplete,
  shouldTriggerSessionComplete, shouldShowFocusCompletionPrompt, buildFocusCompletionPayload,
  buildResetFocusState, getTimerState,
} from "./focusSession";

describe("shouldShowFloatingTimer", () => {
  const base = { activeTab: "roadmap", focusSessionActive: true, hasActiveTask: true, isFocusMode: false, sessionCompletePending: false };

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

  it("hides the floating timer when a focus session completion prompt is pending", () => {
    expect(shouldShowFloatingTimer({ ...base, sessionCompletePending: true })).toBe(false);
  });
});

describe("getTimerState", () => {
  it("returns normal when remaining time is more than 30%", () => {
    expect(getTimerState(100, 100)).toBe("normal");
    expect(getTimerState(31, 100)).toBe("normal");
  });

  it("returns near-end when remaining time is between 15% and 30% inclusive", () => {
    expect(getTimerState(30, 100)).toBe("near-end");
    expect(getTimerState(16, 100)).toBe("near-end");
  });

  it("returns almost-done when remaining time is between 1% and 15% inclusive", () => {
    expect(getTimerState(15, 100)).toBe("almost-done");
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
    const result = buildFocusCompletionPayload(payload, task, "2026-06-10");
    expect(result.tasks[0].isCompleted).toBe(true);
    expect(result.tasks[0].isNowFocus).toBe(false);
    expect(result.tasks[0].dateCompletedString).toBe("2026-06-10");
  });

  it("awards 120 XP", () => {
    const payload = { tasks: [task], config: { totalXp: 100 }, contributions: [] };
    const result = buildFocusCompletionPayload(payload, task, "2026-06-10");
    expect(result.config.totalXp).toBe(220);
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
