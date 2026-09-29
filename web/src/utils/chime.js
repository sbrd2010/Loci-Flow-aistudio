// The focus chime (Q40.1): one soft tone at block end and at break end, at a
// fixed volume. Settings → Focus timer → Chimes turns it off; Sound Off does
// not (that is the background sound only).
export function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 659.25; // E5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
    osc.onended = () => ctx.close?.();
  } catch { /* no audio */ }
}

export const chimesOn = (config) => config?.focusChimes !== false;
