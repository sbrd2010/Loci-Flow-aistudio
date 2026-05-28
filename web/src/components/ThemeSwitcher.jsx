import React, { useState, useEffect } from "react";

const THEMES = [
  { id: "glassy",    label: "Dark Glass",  emoji: "🔮", desc: "Deep navy glassmorphism" },
  { id: "coral",     label: "Warm Coral",  emoji: "🌅", desc: "Terracotta light" },
  { id: "teal",      label: "Executive",   emoji: "🌿", desc: "Corporate teal" },
  { id: "sage",      label: "Zen Sage",    emoji: "🍃", desc: "Soft sage green" },
  { id: "polymer",   label: "Research",    emoji: "🔬", desc: "Warm cream lab" },
  { id: "editorial", label: "Editorial",   emoji: "📰", desc: "Black & white serif" },
];

export default function ThemeSwitcher({ theme, onThemeChange }) {
  const [open, setOpen] = useState(false);
  const current = THEMES.find(t => t.id === theme) || THEMES[0];

  // Close dropdown on scroll or touch-scroll so it doesn't stay pinned on mobile
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("touchmove", close, { passive: true });
    return () => {
      window.removeEventListener("scroll", close);
      window.removeEventListener("touchmove", close);
    };
  }, [open]);

  return (
    <div className="theme-switcher">
      <button className="theme-btn" onClick={() => setOpen(!open)} title="Switch theme">
        {current.emoji}
      </button>
      {open && (
        <>
          <div className="theme-backdrop" onClick={() => setOpen(false)} />
          <div className="theme-dropdown">
            <div className="theme-dropdown-title">App Theme</div>
            {THEMES.map(t => (
              <button
                key={t.id}
                className={`theme-option${t.id === theme ? " active" : ""}`}
                onClick={() => { onThemeChange(t.id); setOpen(false); }}
              >
                <span className="theme-option-emoji">{t.emoji}</span>
                <div className="theme-option-text">
                  <span className="theme-option-label">{t.label}</span>
                  <span className="theme-option-desc">{t.desc}</span>
                </div>
                {t.id === theme && <span className="theme-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
