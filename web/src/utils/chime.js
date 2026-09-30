// The focus chime (Q40.1): one soft tone at block end and at break end, at a
// fixed volume. Settings → Focus timer → Chimes turns it off; Sound Off does
// not (that is the background sound only).
//
// One audio context, reused, and unlocked by the first tap or key: mobile
// Safari keeps a context made outside a user gesture suspended, so a chime
// at 0:00 would be silent — and a suspended context never ends its tone, so
// one made per chime would never be closed (Codex review of #433).
let ctx = null;

function getCtx() {
  if (ctx) return ctx;
  const Ctx = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!Ctx) return null;
  try { ctx = new Ctx(); } catch { ctx = null; }
  return ctx;
}

// Called once: the first pointer or key press makes (or wakes) the context.
export function armChime() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  const unlock = () => {
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
    try { getCtx()?.resume?.(); } catch { /* no audio */ }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

export function playChime() {
  const c = getCtx();
  if (!c) return;
  const ring = () => {
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = 659.25; // E5
      gain.gain.setValueAtTime(0.12, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.2);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + 1.2);
    } catch { /* no audio */ }
  };
  if (c.state === "suspended") c.resume?.().then(ring, () => {});
  else ring();
}

export const chimesOn = (config) => config?.focusChimes !== false;
