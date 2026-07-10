import { vi, describe, it, expect, beforeEach } from "vitest";

// Minimal React hooks mock, same pattern as useFocusAudio.test.js, so this
// hook (which is App-level and not wrapped by a DOM renderer in this repo's
// node-environment vitest setup) can be unit tested.
let stateIndex = 0;
let states = [];
let stateSetters = [];
let refs = [];
let refIndex = 0;
let effects = [];
let effectIndex = 0;
let cleanupFuncs = [];
let lastDeps = [];
let reRunCallback = () => {};

vi.mock("react", () => {
  return {
    useState: (initialVal) => {
      const idx = stateIndex++;
      if (states.length <= idx) {
        states.push(initialVal);
        stateSetters.push((newVal) => {
          if (typeof newVal === "function") {
            states[idx] = newVal(states[idx]);
          } else {
            states[idx] = newVal;
          }
          reRunCallback();
        });
      }
      return [states[idx], stateSetters[idx]];
    },
    useRef: (initialVal) => {
      const idx = refIndex++;
      if (refs.length <= idx) {
        refs.push({ current: initialVal });
      }
      return refs[idx];
    },
    useEffect: (callback, deps) => {
      const idx = effectIndex++;
      let shouldRun = false;
      if (lastDeps.length <= idx) {
        lastDeps.push(deps);
        shouldRun = true;
      } else {
        const prevDeps = lastDeps[idx];
        if (!prevDeps || !deps) {
          shouldRun = true;
        } else {
          shouldRun = deps.some((dep, i) => dep !== prevDeps[i]);
        }
        lastDeps[idx] = deps;
      }
      if (shouldRun) {
        effects.push({ idx, callback });
      }
    },
  };
});

vi.mock("../utils/focusNotifications", () => ({
  requestNotifPermission: vi.fn(),
  notifyFocusComplete: vi.fn(),
}));

// node environment has no DOM; the hook only touches document.title and
// (optionally) documentPictureInPicture, addEventListener/removeEventListener.
globalThis.document = {
  title: "Loci",
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
globalThis.window = { documentPictureInPicture: undefined };

const { useFocusTimer } = await import("./useFocusTimer");

function renderHook(hookFn, initialArgs) {
  let currentArgs = initialArgs;
  const result = { current: null };

  const run = () => {
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
    effects = [];

    result.current = hookFn(...currentArgs);

    effects.forEach(({ idx, callback }) => {
      if (cleanupFuncs[idx]) cleanupFuncs[idx]();
      const cleanup = callback();
      cleanupFuncs[idx] = typeof cleanup === "function" ? cleanup : null;
    });
  };

  reRunCallback = () => run();
  run();

  return {
    result,
    rerender(newArgs) {
      currentArgs = newArgs;
      run();
    },
  };
}

describe("useFocusTimer", () => {
  beforeEach(() => {
    states = [];
    stateSetters = [];
    refs = [];
    effects = [];
    cleanupFuncs = [];
    lastDeps = [];
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
    reRunCallback = () => {};
    document.title = "Loci";
  });

  it("starts the countdown from the active task's own time estimate", () => {
    const tasks = [{ uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 15 }];
    const { result } = renderHook(useFocusTimer, [tasks, {}, "u1"]);
    expect(result.current.timerMaxSeconds).toBe(15 * 60);
    expect(result.current.timerSecondsLeft).toBe(15 * 60);
  });

  it("resets the countdown to the new task's duration when switching focus tasks mid-session", () => {
    // Reproduces the reported bug: a 25-min default session is already
    // running (no estimate on the original task), then the user pins a
    // different task — e.g. via DayMap's "Start Focus" — that has its own
    // 15-minute estimate. The countdown must restart from that task's
    // duration, not keep ticking down from the old task's session.
    const taskA = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: null };
    const { result, rerender } = renderHook(useFocusTimer, [[taskA], {}, "u1"]);

    expect(result.current.timerMaxSeconds).toBe(25 * 60);

    // Start the session for task A.
    result.current.setIsTimerRunning(true);
    rerender([[taskA], {}, "u1"]);
    expect(result.current.timerSecondsLeft).toBe(25 * 60);

    // Let some real time elapse on task A's session before the switch —
    // mirrors the actual bug report, where the prior session wasn't fresh.
    result.current.setTimerSecondsLeft(10 * 60);

    // Switch the active task to a different one with a 15-minute estimate,
    // while the timer is still marked running (mirrors DayMap's
    // pin-then-auto-start flow).
    const taskB = { uuid: "b", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 15 };
    const taskAUnfocused = { ...taskA, isNowFocus: false };
    rerender([[taskAUnfocused, taskB], {}, "u1"]);

    expect(result.current.timerMaxSeconds).toBe(15 * 60);
    expect(result.current.timerSecondsLeft).toBe(15 * 60);
  });

  it("preserves elapsed time (does not reset) when the same task's duration is edited mid-session", () => {
    const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 60 };
    const { result, rerender } = renderHook(useFocusTimer, [[task], {}, "u1"]);

    result.current.setIsTimerRunning(true);
    rerender([[task], {}, "u1"]);
    expect(result.current.timerSecondsLeft).toBe(60 * 60);

    // Simulate 10 minutes elapsed, then the same task's estimate is edited
    // (e.g. from DayMap) down to 30 minutes.
    result.current.setTimerSecondsLeft(50 * 60);
    const editedTask = { ...task, timeEstimateMinutes: 30 };
    rerender([[editedTask], {}, "u1"]);

    // 10 minutes had elapsed out of the original 60; the new 30-minute
    // estimate should leave 20 minutes, not reset to a full 30 or keep 50.
    expect(result.current.timerSecondsLeft).toBe(20 * 60);
  });

  it("adds time to both the countdown and its max without resetting elapsed progress", () => {
    const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 25 };
    const { result, rerender } = renderHook(useFocusTimer, [[task], {}, "u1"]);

    result.current.setTimerSecondsLeft(10 * 60); // 10 minutes elapsed
    rerender([[task], {}, "u1"]);

    result.current.addTimeToSession(5);
    rerender([[task], {}, "u1"]);

    expect(result.current.timerMaxSeconds).toBe(30 * 60);
    expect(result.current.timerSecondsLeft).toBe(15 * 60);
  });

  it("does not resurrect a completed session even via a closure captured before completion", () => {
    // Mirrors the real PiP "+5" button: its click listener is attached once
    // when the popup opens and is never replaced on later renders, so it can
    // hold an addTimeToSession closure from a render where the session hadn't
    // completed yet. The guard must still block it via a ref, not a stale
    // closed-over state value.
    const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 25 };
    const { result, rerender } = renderHook(useFocusTimer, [[task], {}, "u1"]);

    result.current.setIsTimerRunning(true);
    rerender([[task], {}, "u1"]);

    const preCompletionAddTimeToSession = result.current.addTimeToSession;

    // Countdown reaches 0 while running — triggers the "session complete" prompt.
    result.current.setTimerSecondsLeft(0);
    rerender([[task], {}, "u1"]);
    expect(result.current.sessionCompletePending).toBe(true);
    expect(result.current.isTimerRunning).toBe(false);

    // A stale PiP "+5" click landing after completion must not bring the
    // countdown back to life behind the user's back.
    preCompletionAddTimeToSession(5);
    rerender([[task], {}, "u1"]);

    expect(result.current.timerSecondsLeft).toBe(0);
    expect(result.current.sessionCompletePending).toBe(true);
  });

  it("blocks a stale PiP +5 while the keep-going duration picker is open", () => {
    // After "Keep going", App.jsx clears sessionCompletePending right away
    // but leaves showExtendPicker open until the user taps a duration. A
    // stray PiP +5 click landing in that window must not skew the still-0:00
    // countdown before extendTimer() actually restarts it.
    const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 25 };
    const { result, rerender } = renderHook(useFocusTimer, [[task], {}, "u1"]);

    result.current.setIsTimerRunning(true);
    rerender([[task], {}, "u1"]);

    const preCompletionAddTimeToSession = result.current.addTimeToSession;

    result.current.setTimerSecondsLeft(0);
    rerender([[task], {}, "u1"]);
    expect(result.current.sessionCompletePending).toBe(true);

    // Mirrors handleFocusSessionKeepGoing: dismiss the prompt, open the picker.
    result.current.dismissSessionComplete();
    result.current.setShowExtendPicker(true);
    rerender([[task], {}, "u1"]);
    expect(result.current.sessionCompletePending).toBe(false);
    expect(result.current.showExtendPicker).toBe(true);

    preCompletionAddTimeToSession(5);
    rerender([[task], {}, "u1"]);

    expect(result.current.timerSecondsLeft).toBe(0);
    expect(result.current.timerMaxSeconds).toBe(25 * 60);
  });

  describe("startFocusSession / endFocusSession", () => {
    it("mints a focusSessionId and starts the timer/focus mode", () => {
      const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 25 };
      const { result, rerender } = renderHook(useFocusTimer, [[task], {}, "u1"]);

      const started = result.current.startFocusSession();
      rerender([[task], {}, "u1"]);

      expect(typeof started.focusSessionId).toBe("string");
      expect(started.focusSessionId.length).toBeGreaterThan(0);
      expect(started.focusInitialPlannedSeconds).toBe(25 * 60);
      expect(typeof started.focusStartedAt).toBe("number");
      expect(result.current.focusSessionId).toBe(started.focusSessionId);
      expect(result.current.isFocusMode).toBe(true);
      expect(result.current.isTimerRunning).toBe(true);
    });

    it("endFocusSession returns the session's data and clears focusSessionId, guaranteeing exactly one terminal consumption", () => {
      const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 25 };
      const { result, rerender } = renderHook(useFocusTimer, [[task], {}, "u1"]);

      const started = result.current.startFocusSession();
      rerender([[task], {}, "u1"]);

      result.current.setTimerSecondsLeft(20 * 60); // 5 minutes elapsed
      rerender([[task], {}, "u1"]);

      const ended = result.current.endFocusSession("completed_task");
      rerender([[task], {}, "u1"]);

      expect(ended.focusSessionId).toBe(started.focusSessionId);
      expect(ended.focusStartedAt).toBe(started.focusStartedAt);
      expect(ended.focusInitialPlannedSeconds).toBe(started.focusInitialPlannedSeconds);
      expect(ended.focusFinalPlannedSeconds).toBe(25 * 60);
      expect(ended.focusElapsedSeconds).toBe(5 * 60);
      expect(ended.focusEndReason).toBe("completed_task");

      // The session is now consumed — a second call (e.g. a duplicate
      // "End Session" click racing the "Done!" handler) must not produce a
      // second terminal event for the same session.
      const secondEnd = result.current.endFocusSession("user_abandoned");
      expect(secondEnd).toBeNull();
      expect(result.current.focusSessionId).toBeNull();
    });

    it("endFocusSession returns null when no session was ever started", () => {
      const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 25 };
      const { result } = renderHook(useFocusTimer, [[task], {}, "u1"]);
      expect(result.current.endFocusSession("user_abandoned")).toBeNull();
    });

    it("reflects mid-session extensions (addTimeToSession) in focusFinalPlannedSeconds while focusInitialPlannedSeconds stays fixed", () => {
      const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 25 };
      const { result, rerender } = renderHook(useFocusTimer, [[task], {}, "u1"]);

      const started = result.current.startFocusSession();
      rerender([[task], {}, "u1"]);
      expect(started.focusInitialPlannedSeconds).toBe(25 * 60);

      result.current.addTimeToSession(10);
      rerender([[task], {}, "u1"]);

      const ended = result.current.endFocusSession("user_abandoned");
      expect(ended.focusInitialPlannedSeconds).toBe(25 * 60);
      expect(ended.focusFinalPlannedSeconds).toBe(35 * 60);
    });

    it("clears any in-flight session on an account switch (uid change) so a stale session can't leak into the next account", () => {
      const task = { uuid: "a", isNowFocus: true, isDeleted: false, isCompleted: false, timeEstimateMinutes: 25 };
      const { result, rerender } = renderHook(useFocusTimer, [[task], {}, "u1"]);

      result.current.startFocusSession();
      rerender([[task], {}, "u1"]);
      expect(result.current.focusSessionId).not.toBeNull();

      // Switch accounts — the reset effect keys on uid.
      rerender([[task], {}, "u2"]);

      expect(result.current.focusSessionId).toBeNull();
      expect(result.current.endFocusSession("user_abandoned")).toBeNull();
    });
  });
});
