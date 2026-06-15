import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useFocusAudio } from "./useFocusAudio";
import { BINAURAL_TRACK_ID } from "../utils/binauralBeat";
import { getCategoryKeyForTrack } from "../utils/soundLibrary";

// Mock global Audio
class MockAudio {
  constructor(src) {
    this.src = src;
    this.loop = false;
    this.volume = 1.0;
    this.preload = "";
    this.paused = true;
    this._listeners = {};
    MockAudio.instances.push(this);
  }

  addEventListener(event, handler) {
    (this._listeners[event] ||= []).push(handler);
  }

  removeEventListener(event, handler) {
    this._listeners[event] = (this._listeners[event] || []).filter(h => h !== handler);
  }

  dispatchEvent(eventName) {
    (this._listeners[eventName] || []).forEach(handler => handler());
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

// Mock global AudioContext (binaural beat & rain ambience)
class MockOscillator {
  constructor() {
    this.frequency = { value: 0 };
    this.type = "";
    this.stopCalled = false;
  }
  connect() {}
  start() {}
  stop() { this.stopCalled = true; }
}

class MockGainNode {
  constructor() {
    this.gain = { value: 1 };
  }
  connect() {}
}

class MockChannelMerger {
  connect() {}
}

class MockAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this._data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel) {
    return this._data[channel];
  }
}

class MockAudioBufferSourceNode {
  constructor() {
    this.buffer = null;
    this.loop = false;
    this.stopCalled = false;
  }
  connect() {}
  start() {}
  stop() { this.stopCalled = true; }
}

class MockBiquadFilterNode {
  constructor() {
    this.type = "";
    this.frequency = { value: 0 };
  }
  connect() {}
}

class MockAudioContext {
  constructor() {
    // Some browsers create a new AudioContext already running when
    // constructed inside a user-gesture handler (e.g. a click).
    this.state = "running";
    this.oscillators = [];
    this.sources = [];
    this.filters = [];
    this.sampleRate = 44100;
    MockAudioContext.instances.push(this);
  }
  createOscillator() {
    const osc = new MockOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() { return new MockGainNode(); }
  createChannelMerger() { return new MockChannelMerger(); }
  createBuffer(channels, length, rate) {
    return new MockAudioBuffer(channels, length, rate);
  }
  createBufferSource() {
    const src = new MockAudioBufferSourceNode();
    this.sources.push(src);
    return src;
  }
  createBiquadFilter() {
    const filter = new MockBiquadFilterNode();
    this.filters.push(filter);
    return filter;
  }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
}
MockAudioContext.instances = [];

globalThis.AudioContext = MockAudioContext;

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
    MockAudioContext.instances = [];
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
    const config = { focusSoundTrack: "gentle-midday-rain.mp3" };
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
    const config = { focusSoundTrack: "gentle-midday-rain.mp3" };
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, null]
    );

    expect(result.current.selectedTrack).toBe("gentle-midday-rain.mp3");

    // Click it again
    result.current.selectTrack("gentle-midday-rain.mp3");
    expect(result.current.selectedTrack).toBeNull();
  });

  it("pauses the previous audio instance immediately when switching tracks", () => {
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [true, {}, null]
    );

    result.current.selectTrack("gentle-midday-rain.mp3");
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

  it("preserves the new volume when a track is selected immediately after a volume change", () => {
    const config = { focusSoundTrack: "gentle-midday-rain.mp3", focusSoundVolume: 0.5 };
    const saveSubPath = vi.fn();
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, saveSubPath]
    );

    result.current.changeVolume(0.8);
    // Parent config prop has not re-rendered yet with the new volume.
    result.current.selectTrack("midnight-amber-room.mp3");

    expect(saveSubPath).toHaveBeenLastCalledWith("config", expect.objectContaining({
      focusSoundTrack: "midnight-amber-room.mp3",
      focusSoundVolume: 0.8
    }));
  });

  it("preserves the new track when volume is changed immediately after selecting a track", () => {
    const config = { focusSoundTrack: "gentle-midday-rain.mp3", focusSoundVolume: 0.5 };
    const saveSubPath = vi.fn();
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, saveSubPath]
    );

    result.current.selectTrack("midnight-amber-room.mp3");
    // Parent config prop has not re-rendered yet with the new track.
    result.current.changeVolume(0.8);

    expect(saveSubPath).toHaveBeenLastCalledWith("config", expect.objectContaining({
      focusSoundTrack: "midnight-amber-room.mp3",
      focusSoundVolume: 0.8
    }));
  });

  it("resets track and volume to defaults when config no longer has sound fields", () => {
    const config = { focusSoundTrack: "gentle-midday-rain.mp3", focusSoundVolume: 0.8 };
    const { result, rerender } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, null]
    );

    expect(result.current.selectedTrack).toBe("gentle-midday-rain.mp3");
    expect(result.current.volume).toBe(0.8);

    // New account/config with no saved sound prefs
    rerender([false, {}, null]);

    expect(result.current.selectedTrack).toBeNull();
    expect(result.current.volume).toBe(0.5);
  });

  it("creates a binaural beat node (not an Audio element) for the binaural track", () => {
    const config = { focusSoundTrack: BINAURAL_TRACK_ID, focusSoundVolume: 0.6 };
    renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [true, config, null]
    );

    expect(MockAudio.instances.length).toBe(0);
    expect(MockAudioContext.instances.length).toBe(1);

    const ctx = MockAudioContext.instances[0];
    expect(ctx.oscillators[0].frequency.value).toBe(200);
    expect(ctx.oscillators[1].frequency.value).toBe(240);
    expect(ctx.state).toBe("running"); // isRunning true on init
  });

  it("resumes/suspends the binaural beat when timer running state changes", () => {
    const config = { focusSoundTrack: BINAURAL_TRACK_ID };
    const { rerender } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, null]
    );

    const ctx = MockAudioContext.instances[0];
    expect(ctx.state).toBe("suspended");

    rerender([true, config, null]);
    expect(ctx.state).toBe("running");

    rerender([false, config, null]);
    expect(ctx.state).toBe("suspended");
  });

  it("disposes the binaural context when switching to a different track", () => {
    const config = { focusSoundTrack: BINAURAL_TRACK_ID };
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [true, config, null]
    );

    const ctx = MockAudioContext.instances[0];

    result.current.selectTrack("gentle-midday-rain.mp3");

    expect(ctx.oscillators[0].stopCalled).toBe(true);
    expect(ctx.oscillators[1].stopCalled).toBe(true);
    expect(ctx.state).toBe("closed");
    expect(MockAudio.instances.length).toBe(1);
  });

  it("disposes the binaural context on unmount", () => {
    const config = { focusSoundTrack: BINAURAL_TRACK_ID };
    const { unmount } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [true, config, null]
    );

    const ctx = MockAudioContext.instances[0];

    unmount();

    expect(ctx.oscillators[0].stopCalled).toBe(true);
    expect(ctx.state).toBe("closed");
  });

  describe("sound variation categories (rain/lofi/jazz/piano)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("selectCategory picks a variation from the category and saves it", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);

      const saveSubPath = vi.fn();
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [false, {}, saveSubPath]
      );

      result.current.selectCategory("rain");

      expect(result.current.selectedTrack).toBe("gentle-midday-rain.mp3");
      expect(saveSubPath).toHaveBeenCalledWith("config", expect.objectContaining({
        focusSoundTrack: "gentle-midday-rain.mp3"
      }));
    });

    it("selectCategory toggles the category off if it is already active", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);

      const config = { focusSoundTrack: "gentle-midday-rain.mp3" };
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [false, config, null]
      );

      result.current.selectCategory("rain");
      expect(result.current.selectedTrack).toBeNull();
    });

    it("creates an Audio element pointing at the jsDelivr CDN for a CDN variation track", () => {
      const config = { focusSoundTrack: "sounds/lofi/first-coffee-thoughts.mp3" };
      renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [false, config, null]
      );

      expect(MockAudio.instances.length).toBe(1);
      expect(MockAudio.instances[0].src).toBe(
        "https://cdn.jsdelivr.net/gh/sbrd2010/Loci-flow-sounds@main/sounds/lofi/first-coffee-thoughts.mp3"
      );
    });

    it("reshuffleTrack switches to a different variation in the same category", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);

      const config = { focusSoundTrack: "gentle-midday-rain.mp3" };
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [false, config, null]
      );

      result.current.reshuffleTrack();

      expect(result.current.selectedTrack).not.toBe("gentle-midday-rain.mp3");
      expect(result.current.selectedTrack.includes("rain")).toBe(true);
    });

    it("reshuffleTrack does nothing when no ambient category is selected", () => {
      const config = { focusSoundTrack: BINAURAL_TRACK_ID };
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [true, config, null]
      );

      result.current.reshuffleTrack();
      expect(result.current.selectedTrack).toBe(BINAURAL_TRACK_ID);
    });
  });

  describe("trackLoadState", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("is 'idle' when no track is selected", () => {
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [false, {}, null]
      );

      expect(result.current.trackLoadState).toBe("idle");
    });

    it("is 'ready' immediately for the binaural beat (no buffering needed)", () => {
      const config = { focusSoundTrack: BINAURAL_TRACK_ID };
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [true, config, null]
      );

      expect(result.current.trackLoadState).toBe("ready");
    });

    it("sets preload='auto' and starts as 'loading' for an ambient track, then 'ready' once it can play", () => {
      const config = { focusSoundTrack: "sounds/lofi/first-coffee-thoughts.mp3" };
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [true, config, null]
      );

      const audio = MockAudio.instances[0];
      expect(audio.preload).toBe("auto");
      expect(result.current.trackLoadState).toBe("loading");

      audio.dispatchEvent("canplay");
      expect(result.current.trackLoadState).toBe("ready");
    });

    it("sets trackLoadState to 'error' if the bundled local track fails to load", () => {
      const config = { focusSoundTrack: "2-am-debug-loop.mp3" };
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [true, config, null]
      );

      const audio = MockAudio.instances[0];
      audio.dispatchEvent("error");
      expect(result.current.trackLoadState).toBe("error");
    });

    it("falls back to the category's bundled local track when a CDN variation fails to load", () => {
      const config = { focusSoundTrack: "sounds/lofi/first-coffee-thoughts.mp3" };
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [true, config, null]
      );

      const cdnAudio = MockAudio.instances[0];
      cdnAudio.dispatchEvent("error");

      expect(result.current.selectedTrack).toBe("2-am-debug-loop.mp3");
      expect(result.current.trackLoadState).not.toBe("error");
      expect(MockAudio.instances.length).toBe(2);
      expect(MockAudio.instances[1].src).toBe("/sounds/2-am-debug-loop.mp3");
      expect(cdnAudio.paused).toBe(true);
      expect(MockAudio.instances[1].paused).toBe(false);
    });

    it("goes back to 'loading' when reshuffling to a new variation", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);

      const config = { focusSoundTrack: "sounds/lofi/first-coffee-thoughts.mp3" };
      const { result } = renderHook(
        (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
        [true, config, null]
      );

      MockAudio.instances[0].dispatchEvent("canplay");
      expect(result.current.trackLoadState).toBe("ready");

      result.current.reshuffleTrack();
      expect(result.current.trackLoadState).toBe("loading");
    });
  });

  describe("stale track ID migrations", () => {
    it("migrates synthesized rain presets and old rain files to gentle-midday-rain.mp3", () => {
      const legacyTracks = [
        "rain-light",
        "rain-steady",
        "rain-heavy",
        "after-school-rain.mp3",
        "sounds/rain/amber-sidewalks.mp3",
        "sounds/rain/sidewalk-puddles.mp3",
        "sounds/rain/blossoms-on-the-pavement.mp3",
        "sounds/rain/petals-after-rain.mp3",
        "sounds/rain/amber-windowpane.mp3",
        "sounds/rain/storm-over-side-streets.mp3",
        "sounds/rain/bloom-between-showers.mp3"
      ];

      legacyTracks.forEach(trackId => {
        const config = { focusSoundTrack: trackId };
        const { result } = renderHook(
          (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
          [false, config, null]
        );

        // Check that it migrates to gentle-midday-rain.mp3 on load
        expect(result.current.selectedTrack).toBe("gentle-midday-rain.mp3");

        // Verify that getCategoryKeyForTrack resolves it to "rain"
        const categoryKey = getCategoryKeyForTrack(result.current.selectedTrack);
        expect(categoryKey).toBe("rain");
      });
    });
  });

  it("migrates a config saved with the old binaural-40hz.wav track id to the synthesized track", () => {
    const config = { focusSoundTrack: "binaural-40hz.wav" };
    const { result } = renderHook(
      (isRunning, config, saveSubPath) => useFocusAudio(isRunning, config, saveSubPath),
      [false, config, null]
    );

    expect(result.current.selectedTrack).toBe(BINAURAL_TRACK_ID);
    expect(MockAudio.instances.length).toBe(0);
    expect(MockAudioContext.instances.length).toBe(1);
  });
});
