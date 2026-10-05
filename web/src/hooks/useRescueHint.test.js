import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Same hand-rolled React hooks mock as useFocusLedger.test.js — vitest runs
// in node here with no DOM renderer, and no new dependencies.
let stateIndex = 0;
let states = [];
let stateSetters = [];
let refs = [];
let refIndex = 0;
let effects = [];
let effectIndex = 0;
let lastDeps = [];
let reRunCallback = () => {};

vi.mock("react", () => ({
  useState: (initialVal) => {
    const idx = stateIndex++;
    if (states.length <= idx) {
      states.push(typeof initialVal === "function" ? initialVal() : initialVal);
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
  useCallback: (fn) => fn,
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
    if (shouldRun) effects.push({ callback });
  },
}));

const { useRescueHint } = await import("./useRescueHint");

function renderHook(hookFn, initialArgs) {
  let currentArgs = initialArgs;
  const run = () => {
    stateIndex = 0; refIndex = 0; effectIndex = 0; effects = [];
    hookFn(currentArgs);
    effects.forEach(({ callback }) => callback());
  };
  reRunCallback = () => run();
  run();
  return { rerender(newArgs) { currentArgs = newArgs; run(); } };
}

const NOW = new Date(2024, 5, 15, 12, 0).getTime();
const store = {};

describe("useRescueHint — waits for the cloud copy", () => {
  beforeEach(() => {
    states = []; stateSetters = []; refs = []; effects = []; lastDeps = [];
    reRunCallback = () => {};
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const k of Object.keys(store)) delete store[k];
    // The one thing has sat 50 minutes with no start, so the hint is due.
    store.loci_one_thing_since = JSON.stringify({ uuid: "t1", at: NOW - 50 * 60000 });
    vi.stubGlobal("window", { localStorage: {
      getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; },
    } });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("writes nothing from the cached config while syncing, then settles and records from the synced one", () => {
    const saveConfigPatch = vi.fn();
    const args = {
      saveConfigPatch, todayStr: "2024-06-15", windows: [{ startMin: 0, endMin: 1440 }],
      oneThing: { uuid: "t1" }, focusActive: false, ledgerRaw: null,
      // The cache still has yesterday's hint, which the cloud already settled.
      config: { rescueHintShown: { date: "2024-06-14", kind: "idle", minutes: 50, acted: false }, rescueHintIgnored: 2 },
      syncing: true,
    };
    const h = renderHook(useRescueHint, args);
    expect(saveConfigPatch).not.toHaveBeenCalled();

    h.rerender({ ...args, config: { rescueHintIgnored: 0 }, syncing: false });
    // No stale "ignored" (which would have turned the hint off); only today's showing.
    expect(saveConfigPatch.mock.calls).toEqual([
      [{ rescueHintShown: { date: "2024-06-15", kind: "idle", minutes: 50, acted: false } }],
    ]);
  });
});
