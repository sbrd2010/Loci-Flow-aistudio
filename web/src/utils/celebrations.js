import { playDoneTone } from "./uiSounds";

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

// 75e (try-out 43): the finish tone follows Settings › Sounds (off by
// default) and is the soft one; the confetti stays.
export function celebrate({ sound = false } = {}) {
  if (sound) playDoneTone();
  launchConfetti();
}
