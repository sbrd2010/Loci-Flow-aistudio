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
});
