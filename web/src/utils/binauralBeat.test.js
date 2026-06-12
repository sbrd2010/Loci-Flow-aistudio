import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BINAURAL_TRACK_ID, createBinauralBeatNode } from "./binauralBeat";

class MockOscillator {
  constructor() {
    this.type = "";
    this.frequency = { value: 0 };
    this.startCalled = false;
    this.stopCalled = false;
  }
  connect() {}
  start() { this.startCalled = true; }
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

class MockAudioContext {
  constructor() {
    // Some browsers create a new AudioContext already running when
    // constructed inside a user-gesture handler (e.g. a click).
    this.state = "running";
    this.oscillators = [];
    MockAudioContext.instances.push(this);
  }
  createOscillator() {
    const osc = new MockOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() { return new MockGainNode(); }
  createChannelMerger() { return new MockChannelMerger(); }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
}
MockAudioContext.instances = [];

describe("createBinauralBeatNode", () => {
  beforeEach(() => {
    MockAudioContext.instances = [];
    globalThis.AudioContext = MockAudioContext;
  });

  afterEach(() => {
    delete globalThis.AudioContext;
  });

  it("exports a track id that no longer points at an audio file", () => {
    expect(BINAURAL_TRACK_ID).toBe("binaural-40hz");
  });

  it("returns null when AudioContext is unavailable", () => {
    delete globalThis.AudioContext;
    expect(createBinauralBeatNode(0.5)).toBeNull();
  });

  it("creates a 200Hz/240Hz oscillator pair (40Hz beat) and starts them", () => {
    const node = createBinauralBeatNode(0.5);
    const ctx = MockAudioContext.instances[0];

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0].frequency.value).toBe(200);
    expect(ctx.oscillators[1].frequency.value).toBe(240);
    expect(ctx.oscillators[0].startCalled).toBe(true);
    expect(ctx.oscillators[1].startCalled).toBe(true);
    expect(node.paused).toBe(true);
  });

  it("starts suspended even if the AudioContext begins in a running state", () => {
    const node = createBinauralBeatNode(0.5);
    const ctx = MockAudioContext.instances[0];

    expect(ctx.state).toBe("suspended");
    expect(node.paused).toBe(true);
  });

  it("scales volume down to avoid clipping from the summed oscillators", () => {
    const node = createBinauralBeatNode(1);
    expect(node.volume).toBeCloseTo(1);

    node.volume = 0.5;
    expect(node.volume).toBeCloseTo(0.5);
  });

  it("play() resumes the context and pause() suspends it, toggling paused", async () => {
    const node = createBinauralBeatNode(0.5);
    const ctx = MockAudioContext.instances[0];

    await node.play();
    expect(ctx.state).toBe("running");
    expect(node.paused).toBe(false);

    await node.pause();
    expect(ctx.state).toBe("suspended");
    expect(node.paused).toBe(true);
  });

  it("dispose() stops both oscillators and closes the context", () => {
    const node = createBinauralBeatNode(0.5);
    const ctx = MockAudioContext.instances[0];

    node.dispose();

    expect(ctx.oscillators[0].stopCalled).toBe(true);
    expect(ctx.oscillators[1].stopCalled).toBe(true);
    expect(ctx.state).toBe("closed");
    expect(node.paused).toBe(true);
  });
});
