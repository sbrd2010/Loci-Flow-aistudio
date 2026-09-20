import React from "react";
import "../styles/appearance.css";

// Settings › Appearance — screen 10c.
//
// "Named themes in Settings, not a 'dark mode' toggle — because the names are
// what make Auto legible." Until this existed, Evening and Paper were two rows
// in a thirteen-item emoji dropdown, which is the opposite of that: a choice
// about how you work, presented as a skin.
//
// Rows follow screen 9's shape: a label, an explanation underneath saying what
// it actually changes, and the control on the right. No icons, no cards.

export const REDESIGN_THEMES = [
  { id: "evening", name: "Evening", blurb: "Black and gold" },
  { id: "paper", name: "Paper", blurb: "Warm and light" },
];

// Screen 10c's "Show momentum" switch is built here now that the strip it
// controls exists. It was deliberately left out until then: a switch that
// persists a preference nothing reads is a control that looks like it works
// and cannot.

export default function AppearanceSettings({ theme, onThemeChange, momentumEnabled = true, onMomentumChange }) {
  const isRedesignTheme = REDESIGN_THEMES.some(t => t.id === theme);

  return (
    <section className="appearance">
      <div className="appearance-kicker">APPEARANCE</div>

      <div className="appearance-row">
        <div className="appearance-row-text">
          <div className="appearance-label">Theme</div>
          <div className="appearance-note">Same app, two grounds</div>
        </div>
      </div>

      <div className="appearance-themes" role="radiogroup" aria-label="Theme">
        {REDESIGN_THEMES.map(t => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme === t.id}
            className={`appearance-theme${theme === t.id ? " is-active" : ""}`}
            onClick={() => onThemeChange?.(t.id)}
          >
            <span className="appearance-theme-name">{t.name}</span>
            <span className="appearance-theme-blurb">{t.blurb}</span>
          </button>
        ))}
      </div>

      <div
        className="appearance-row appearance-row--switch"
        role="switch"
        aria-checked={momentumEnabled}
        tabIndex={0}
        onClick={() => onMomentumChange?.(!momentumEnabled)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMomentumChange?.(!momentumEnabled); }
        }}
      >
        <div className="appearance-row-text">
          <div className="appearance-label">Show momentum</div>
          <div className="appearance-note">
            Five bars under Today, one per day you moved something. Off hides
            it at any count.
          </div>
        </div>
        <input type="checkbox" className="pill-toggle" checked={momentumEnabled} readOnly tabIndex={-1} />
      </div>

      {!isRedesignTheme && (
        <p className="appearance-other">
          You're on another theme. Evening and Paper are the two the redesign is
          drawn for — everything else still works, but only these two follow it.
        </p>
      )}
    </section>
  );
}
