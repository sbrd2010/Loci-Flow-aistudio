import { getCtx } from "./chime";

// 75e (try-out 43): soft tones, off by default (Settings › Appearance ›
// Sounds). Hiding Today's list is a falling two-note sine, showing it a
// rising one; finishing a task a three-note rise, with a short buzz on
// phones that have one. Quiet (gain 0.05), ~90ms a note, no files.
export const uiSoundsOn = (config) => config?.uiSounds === true;

function notes(freqs, step = 0.09) {
  const c = getCtx();
  if (!c) return;
  const ring = () => {
    try {
      const t0 = c.currentTime + 0.01;
      freqs.forEach((f, i) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        const at = t0 + i * step;
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + step + 0.04);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(at);
        osc.stop(at + step + 0.05);
      });
    } catch { /* no audio */ }
  };
  if (c.state === "suspended") c.resume?.().then(ring, () => {});
  else ring();
}

export const playListTone = (shown) => notes(shown ? [523.25, 659.25] : [659.25, 523.25]);

export function playDoneTone() {
  notes([523.25, 659.25, 783.99]);
  try { globalThis.navigator?.vibrate?.(10); } catch { /* no vibration */ }
}
