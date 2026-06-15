// Live-synthesized rain ambience using the Web Audio API.
// Generates stereo white noise modulated by a slow LFO and shaped by a highpass filter.
// Because it is synthesized dynamically in the browser, it requires no audio file assets,
// loops seamlessly without audible repeats, and works offline.

export const RAIN_LIGHT_TRACK_ID = "rain-light";
export const RAIN_STEADY_TRACK_ID = "rain-steady";
export const RAIN_HEAVY_TRACK_ID = "rain-heavy";

export const RAIN_TRACK_IDS = new Set([
  RAIN_LIGHT_TRACK_ID,
  RAIN_STEADY_TRACK_ID,
  RAIN_HEAVY_TRACK_ID
]);

const PRESETS = {
  [RAIN_LIGHT_TRACK_ID]: {
    cutoff: 2200,
    lfoFreq: 0.08,
    lfoGain: 200,
    gainScale: 0.25
  },
  [RAIN_STEADY_TRACK_ID]: {
    cutoff: 1400,
    lfoFreq: 0.12,
    lfoGain: 250,
    gainScale: 0.45
  },
  [RAIN_HEAVY_TRACK_ID]: {
    cutoff: 700,
    lfoFreq: 0.15,
    lfoGain: 300,
    gainScale: 0.65
  }
};

export function createRainAmbienceNode(trackId, initialVolume = 0.5) {
  const preset = PRESETS[trackId] || PRESETS[RAIN_STEADY_TRACK_ID];

  const AudioCtx = typeof AudioContext !== "undefined"
    ? AudioContext
    : (typeof webkitAudioContext !== "undefined" ? webkitAudioContext : undefined);
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();

  // 1. Create a 2-second stereo buffer filled with white noise.
  // Using stereo creates a much wider, more immersive and premium ambient field.
  const sampleRate = ctx.sampleRate;
  const bufferSize = sampleRate * 2;
  const buffer = ctx.createBuffer(2, bufferSize, sampleRate);
  
  for (let channel = 0; channel < 2; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < bufferSize; i++) {
      channelData[i] = Math.random() * 2 - 1;
    }
  }

  // 2. Setup loop source
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  // 3. Filter - Highpass is critical to preserve the rain droplet "hiss"
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = preset.cutoff;

  // 4. LFO (Wind/intensity swells modulation)
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = preset.lfoFreq;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = preset.lfoGain;

  // 5. Main gain node
  const gain = ctx.createGain();
  const scale = preset.gainScale;
  gain.gain.value = Math.max(0, Math.min(1, initialVolume)) * scale;

  // 6. Connect LFO to filter frequency to modulate cutoff
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  // 7. Connect audio chain
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  // Start nodes
  lfo.start();
  source.start();

  // Suspend context immediately so it stays silent until explicitly played
  ctx.suspend();

  return {
    paused: true,
    play() {
      this.paused = false;
      return ctx.resume();
    },
    pause() {
      this.paused = true;
      return ctx.suspend();
    },
    dispose() {
      this.paused = true;
      try {
        source.stop();
      } catch (e) {
        // Source may not be started or already stopped
      }
      try {
        lfo.stop();
      } catch (e) {
        // Oscillator may not be started or already stopped
      }
      return ctx.close();
    },
    get volume() {
      return gain.gain.value / scale;
    },
    set volume(value) {
      gain.gain.value = Math.max(0, Math.min(1, value)) * scale;
    }
  };
}
