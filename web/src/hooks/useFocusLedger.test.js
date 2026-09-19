import { vi, describe, it, expect, beforeEach } from "vitest";

// Same hand-rolled React hooks mock as useFocusTimer.test.js / useFocusAudio
// .test.js — this repo's vitest runs in a node environment with no DOM
// renderer, and the handoff forbids adding dependencies.
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

vi.mock("react", () => ({
  useState: (initialVal) => {
    const idx = stateIndex++;
    if (states.length <= idx) {
      states.push(initialVal);
      stateSetters.push((newVal) => {
        states[idx] = typeof newVal === "function" ? newVal(states[idx]) : newVal;
        reRunCallback();
      });
    }
    return [states[idx], stateSetters[idx]];
  },
  useRef: (initialVal) => {
    const idx = refIndex++;
    if (refs.length <= idx) refs.push({ current: initialVal });
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
      shouldRun = !prevDeps || !deps || deps.some((dep, i) => dep !== prevDeps[i]);
      lastDeps[idx] = deps;
    }
    if (shouldRun) effects.push({ idx, callback });
  },
}));

const refMock = vi.fn((_db, path) => ({ path }));
const queryMock = vi.fn((base, ...constraints) => ({ base, constraints }));
const orderByKeyMock = vi.fn(() => "orderByKey");
const startAtMock = vi.fn(v => ({ startAt: v }));
const onValueMock = vi.fn();

vi.mock("firebase/database", () => ({
  ref: (...args) => refMock(...args),
  query: (...args) => queryMock(...args),
  orderByKey: (...args) => orderByKeyMock(...args),
  startAt: (...args) => startAtMock(...args),
  onValue: (...args) => onValueMock(...args),
}));

vi.mock("../firebase", () => ({ db: {}, auth: { currentUser: null } }));

const { useFocusLedger } = await import("./useFocusLedger");

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
    rerender(newArgs) { currentArgs = newArgs; run(); },
    unmount() { cleanupFuncs.forEach(fn => fn && fn()); cleanupFuncs = []; },
  };
}

describe("useFocusLedger", () => {
  beforeEach(() => {
    states = []; stateSetters = []; refs = []; effects = [];
    cleanupFuncs = []; lastDeps = [];
    stateIndex = 0; refIndex = 0; effectIndex = 0;
    reRunCallback = () => {};
    vi.clearAllMocks();
    onValueMock.mockImplementation(() => () => {});
  });

  it("reads nothing at all without a uid — demo mode has none", () => {
    const { result } = renderHook(useFocusLedger, [null]);
    expect(result.current).toBeNull();
    expect(onValueMock).not.toHaveBeenCalled();
    expect(refMock).not.toHaveBeenCalled();
  });

  it("subscribes to the signed-in user's own events path", () => {
    renderHook(useFocusLedger, ["alice"]);
    expect(refMock).toHaveBeenCalledWith({}, "activityLogs/alice/events");
  });

  it("bounds the read to the window instead of the whole history", () => {
    renderHook(useFocusLedger, ["alice", 7]);
    // Day keys are "YYYY-MM-DD", which sort lexicographically in the same
    // order they sort chronologically, so startAt(oldestDay) is a real bound
    // rather than a scan of everything the user has ever logged.
    expect(orderByKeyMock).toHaveBeenCalled();
    expect(startAtMock).toHaveBeenCalledTimes(1);
    expect(startAtMock.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("asks for a wider window when told to", () => {
    renderHook(useFocusLedger, ["alice", 30]);
    const oldest = startAtMock.mock.calls[0][0];
    const daysAgo = Math.round((Date.now() - new Date(`${oldest}T00:00:00`).getTime()) / 86400000);
    expect(daysAgo).toBeGreaterThanOrEqual(28);
    expect(daysAgo).toBeLessThanOrEqual(30);
  });

  it("returns whatever the snapshot holds", () => {
    const events = { "2026-11-04": { e1: { type: "focus_completed", focusElapsedSeconds: 1500 } } };
    onValueMock.mockImplementation((_q, onNext) => { onNext({ val: () => events }); return () => {}; });
    const { result } = renderHook(useFocusLedger, ["alice"]);
    expect(result.current).toEqual(events);
  });

  it("falls back to null when the read is refused, rather than taking the screen down", () => {
    onValueMock.mockImplementation((_q, _onNext, onError) => {
      onError(new Error("permission_denied"));
      return () => {};
    });
    const { result } = renderHook(useFocusLedger, ["alice"]);
    expect(result.current).toBeNull();
  });

  it("unsubscribes on unmount", () => {
    const unsub = vi.fn();
    onValueMock.mockImplementation(() => unsub);
    const { unmount } = renderHook(useFocusLedger, ["alice"]);
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("resubscribes when the user changes, so one account never shows another's ledger", () => {
    const unsub = vi.fn();
    onValueMock.mockImplementation(() => unsub);
    const { rerender } = renderHook(useFocusLedger, ["alice"]);
    expect(refMock).toHaveBeenLastCalledWith({}, "activityLogs/alice/events");
    rerender(["bob"]);
    expect(unsub).toHaveBeenCalled();
    expect(refMock).toHaveBeenLastCalledWith({}, "activityLogs/bob/events");
  });

  it("does not resubscribe when only the windows array identity changes", () => {
    const { rerender } = renderHook(useFocusLedger, ["alice", 7, [{ startMin: 420, endMin: 1080 }]]);
    expect(onValueMock).toHaveBeenCalledTimes(1);
    // A fresh array on every render is the normal React case; it must not tear
    // the listener down and rebuild it each time.
    rerender(["alice", 7, [{ startMin: 420, endMin: 1080 }]]);
    rerender(["alice", 7, [{ startMin: 420, endMin: 1080 }]]);
    expect(onValueMock).toHaveBeenCalledTimes(1);
  });

  it("drops the subscription when the user signs out", () => {
    const unsub = vi.fn();
    onValueMock.mockImplementation(() => unsub);
    const { result, rerender } = renderHook(useFocusLedger, ["alice"]);
    rerender([null]);
    expect(unsub).toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
