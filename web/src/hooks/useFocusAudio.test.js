import { vi, describe, it, expect, beforeEach } from "vitest";
import { useFocusAudio } from "./useFocusAudio";

// Mock global Audio
class MockAudio {
  constructor(src) {
    this.src = src;
    this.loop = false;
    this.volume = 1.0;
    this.paused = true;
    MockAudio.instances.push(this);
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}
MockAudio.instances = [];

globalThis.Audio = MockAudio;

// Simple custom React hooks runner for testing in pure Node environment
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
          console.log(`[useState mock] Setter called idx=${idx} newVal=`, newVal);
          if (typeof newVal === "function") {
            states[idx] = newVal(states[idx]);
          } else {
            states[idx] = newVal;
          }
          console.log(`[useState mock] Setter finished idx=${idx} states=`, states);
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
    }
  };
});

function renderHook(hookFn, initialArgs) {
  let currentArgs = initialArgs;
  const result = { current: null };

  const run = () => {
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
    effects = [];

    result.current = hookFn(...currentArgs);

    // Execute effects and save cleanups
    effects.forEach(({ idx, callback }) => {
      if (cleanupFuncs[idx]) {
        cleanupFuncs[idx]();
      }
      const cleanup = callback();
      if (typeof cleanup === "function") {
        cleanupFuncs[idx] = cleanup;
      } else {
        cleanupFuncs[idx] = null;
      }
    });
  };

  reRunCallback = () => {
    run();
  };

  run();

  return {
    result,
    rerender(newArgs) {
      currentArgs = newArgs;
      run();
    },
    unmount() {
      cleanupFuncs.forEach(cleanup => {
        if (cleanup) cleanup();
      });
      cleanupFuncs = [];
      lastDeps = [];
    }
  };
}

describe("useFocusAudio", () => {
  beforeEach(() => {
    // Reset React hooks mock states
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

    // Reset Mock Audio instances
    MockAudio.instances = [];
  });

  it("initializes with default values when config is empty", () => {
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, {}, null]
    );

    expect(result.current.selectedTrack).toBeNull();
    expect(result.current.volume).toBe(0.5);
    expect(MockAudio.instances.length).toBe(0);
  });

  it("initializes with config values if provided", () => {
    const config = { focusSoundTrack: "2-am-debug-loop.mp3", focusSoundVolume: 0.75 };
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, null]
    );

    expect(result.current.selectedTrack).toBe("2-am-debug-loop.mp3");
    expect(result.current.volume).toBe(0.75);

    // Audio is created when track is selected during initialization
    expect(MockAudio.instances.length).toBe(1);
    expect(MockAudio.instances[0].src).toBe("/sounds/2-am-debug-loop.mp3");
    expect(MockAudio.instances[0].volume).toBe(0.75);
    expect(MockAudio.instances[0].loop).toBe(true);
    expect(MockAudio.instances[0].paused).toBe(true); // not running
  });

  it("plays automatically if initialized with track and isRunning is true", () => {
    const config = { focusSoundTrack: "after-school-rain.mp3" };
    renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [true, config, null]
    );

    expect(MockAudio.instances.length).toBe(1);
    expect(MockAudio.instances[0].paused).toBe(false);
  });

  it("saves the track and volume adjustments to config via saveSubPath", () => {
    const config = { focusSoundTrack: null, focusSoundVolume: 0.5 };
    const saveSubPath = vi.fn();

    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, saveSubPath]
    );

    result.current.selectTrack("midnight-amber-room.mp3");
    expect(saveSubPath).toHaveBeenCalledWith("config", expect.objectContaining({
      focusSoundTrack: "midnight-amber-room.mp3"
    }));

    result.current.changeVolume(0.2);
    expect(saveSubPath).toHaveBeenCalledWith("config", expect.objectContaining({
      focusSoundVolume: 0.2
    }));
  });

  it("toggles track off if the same track is selected again", () => {
    const config = { focusSoundTrack: "after-school-rain.mp3" };
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, null]
    );

    expect(result.current.selectedTrack).toBe("after-school-rain.mp3");

    // Click it again
    result.current.selectTrack("after-school-rain.mp3");
    expect(result.current.selectedTrack).toBeNull();
  });

  it("pauses the previous audio instance immediately when switching tracks", () => {
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [true, {}, null]
    );

    result.current.selectTrack("after-school-rain.mp3");
    expect(MockAudio.instances.length).toBe(1);
    const rainAudio = MockAudio.instances[0];
    expect(rainAudio.paused).toBe(false);

    // Switch to another track
    result.current.selectTrack("midnight-amber-room.mp3");
    expect(MockAudio.instances.length).toBe(2);
    const jazzAudio = MockAudio.instances[1];

    expect(rainAudio.paused).toBe(true); // previous track is paused immediately
    expect(jazzAudio.paused).toBe(false); // new track starts playing
  });

  it("plays/pauses audio when timer running state changes", () => {
    const config = { focusSoundTrack: "dust-on-the-morning-keys.mp3" };
    const { rerender } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, null]
    );

    const audio = MockAudio.instances[0];
    expect(audio.paused).toBe(true);

    // Timer starts
    rerender([true, config, null]);
    expect(audio.paused).toBe(false);

    // Timer pauses
    rerender([false, config, null]);
    expect(audio.paused).toBe(true);
  });

  it("pauses and cleans up audio on unmount", () => {
    const config = { focusSoundTrack: "2-am-debug-loop.mp3" };
    const { unmount } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [true, config, null]
    );

    const audio = MockAudio.instances[0];
    expect(audio.paused).toBe(false);

    unmount();
    expect(audio.paused).toBe(true);
  });
});
