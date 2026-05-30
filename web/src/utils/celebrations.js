let keyframesInjected = false;

function injectKeyframes() {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes confetti-fall {
      0%   { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
      80%  { opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg) scale(0.5); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

export function playCompletionSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    };
    play(523.25, ctx.currentTime,        0.35); // C5
    play(659.25, ctx.currentTime + 0.12, 0.40); // E5
    play(783.99, ctx.currentTime + 0.24, 0.55); // G5
  } catch (_) {}
}

export function launchConfetti() {
  injectKeyframes();
  const colors = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#f97316"];
  for (let i = 0; i < 55; i++) {
    const el = document.createElement("div");
    const size = Math.random() * 8 + 4;
    el.style.cssText = [
      "position:fixed",
      `top:-12px`,
      `left:${Math.random() * 100}vw`,
      `width:${size}px`,
      `height:${size}px`,
      `background:${colors[Math.floor(Math.random() * colors.length)]}`,
      `border-radius:${Math.random() > 0.5 ? "50%" : "2px"}`,
      "z-index:9999",
      "pointer-events:none",
      `transform:rotate(${Math.random() * 360}deg)`,
      `animation:confetti-fall ${Math.random() * 1.2 + 0.9}s ease-in forwards`,
      `animation-delay:${Math.random() * 0.35}s`,
    ].join(";");
    document.body.appendChild(el);
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }
}

export function celebrate() {
  playCompletionSound();
  launchConfetti();
}
