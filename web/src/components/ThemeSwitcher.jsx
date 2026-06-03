import React, { useState, useEffect } from "react";

const THEMES = [
  { id: "glassy",    label: "Dark Glass",  emoji: "🔮", desc: "Deep navy glassmorphism" },
  { id: "coral",     label: "Warm Coral",  emoji: "🌅", desc: "Terracotta light" },
  { id: "teal",      label: "Executive",   emoji: "🌿", desc: "Corporate teal" },
  { id: "polymer",   label: "Research",    emoji: "🔬", desc: "Warm cream lab" },
  { id: "editorial", label: "Editorial",   emoji: "📰", desc: "Black & white serif" },
  { id: "midnight-neon", label: "Midnight Neon", emoji: "⚡", desc: "Electric cyan on pure black" },
  { id: "solar-ember",   label: "Solar Ember",   emoji: "🔥", desc: "Warm amber, terracotta light" },
  { id: "arctic-frost",  label: "Arctic Frost",  emoji: "❄️", desc: "Cool blue, clinical clarity" },
  { id: "regal-amethyst",   label: "Regal Amethyst", emoji: "💜", desc: "Deep purple glassmorphism" },
  { id: "option-a-amie",    label: "Amie Glass",     emoji: "🌸", desc: "Translucent soft glassy pastel" },
  { id: "option-c-zen",     label: "Zen Canvas",     emoji: "🕊️", desc: "Elegant serif, warm cream" },
  { id: "option-d-bento",   label: "Bento Grid",     emoji: "🍱", desc: "iOS compartmental, amber focus" },
  { id: "option-e-slate",   label: "Slate Notebook", emoji: "📓", desc: "Notion-minimal dark notebook" },
];

export default function ThemeSwitcher({ theme, onThemeChange }) {
  const [open, setOpen] = useState(false);
  const current = THEMES.find(t => t.id === theme) || THEMES[0];

  // Close on page scroll or on touchmove OUTSIDE the dropdown.
  // Without the inside-check, scrolling the theme list itself would close it on mobile.
  useEffect(() => {
    if (!open) return;
    const closeOnScroll = () => setOpen(false);
    const closeOnTouchMove = (e) => {
      if (e.target && e.target.closest && e.target.closest(".theme-dropdown")) return;
      setOpen(false);
    };
    window.addEventListener("scroll", closeOnScroll, { passive: true });
    window.addEventListener("touchmove", closeOnTouchMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", closeOnScroll);
      window.removeEventListener("touchmove", closeOnTouchMove);
    };
  }, [open]);

  return (
    <div className="theme-switcher">
      <button className="theme-btn" onClick={() => setOpen(!open)} title="Switch theme">
        <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0px" }}>
          <span style={{ fontSize: "16px", lineHeight: "1" }}>{current.emoji}</span>
          <span style={{ fontSize: "8px", fontWeight: "700", letterSpacing: "0.04em", color: "var(--text-muted)", textTransform: "uppercase" }}>Theme</span>
        </span>
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
