// Live-synthesized binaural beat (replaces the old short looping WAV file).
// A 200Hz tone in the left ear and a 240Hz tone in the right ear produce a
// 40Hz binaural beat. Because it's generated continuously via the Web Audio
// API, it never repeats and works for any session length.

export const BINAURAL_TRACK_ID = "binaural-40hz";

// Pre-redesign saved track id (the now-deleted WAV file). Migrate it so
// users who had Binaural selected before this change keep their selection.
const LEGACY_BINAURAL_TRACK_ID = "binaural-40hz.wav";

export function migrateTrackId(trackId) {
  return trackId === LEGACY_BINAURAL_TRACK_ID ? BINAURAL_TRACK_ID : trackId;
}

const LEFT_HZ = 200;
const BEAT_HZ = 40;
const RIGHT_HZ = LEFT_HZ + BEAT_HZ;

// Two full-volume sine oscillators summed in stereo can clip / feel harsh,
// so binaural output is scaled down relative to the 0-1 volume slider.
const GAIN_SCALE = 0.25;

export function createBinauralBeatNode(initialVolume = 0.5) {
  const AudioCtx = typeof AudioContext !== "undefined"
    ? AudioContext
    : (typeof webkitAudioContext !== "undefined" ? webkitAudioContext : undefined);
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  const left = ctx.createOscillator();
  const right = ctx.createOscillator();
  const merger = ctx.createChannelMerger(2);
  const gain = ctx.createGain();

  left.type = "sine";
  right.type = "sine";
  left.frequency.value = LEFT_HZ;
  right.frequency.value = RIGHT_HZ;
  gain.gain.value = Math.max(0, Math.min(1, initialVolume)) * GAIN_SCALE;

  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  merger.connect(gain);
  gain.connect(ctx.destination);

  left.start();
  right.start();
  // Browsers may create a new AudioContext already running (e.g. inside a
  // user-gesture handler). Suspend immediately so a freshly selected track
  // stays silent until the hook explicitly calls play() for a running timer.
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
    // Fully releases the oscillators and AudioContext. pause() alone keeps
    // the context resumable for the isRunning play/pause toggle.
    dispose() {
      this.paused = true;
      left.stop();
      right.stop();
      return ctx.close();
    },
    get volume() {
      return gain.gain.value / GAIN_SCALE;
    },
    set volume(value) {
      gain.gain.value = Math.max(0, Math.min(1, value)) * GAIN_SCALE;
    }
  };
}
