import React from "react";
import "../styles/appearance.css";

// Settings › Appearance. Theme is Light / Dark / Auto (turn 44b); Auto
// follows the device's dark-mode setting (turn 49) — see utils/theme.js.
//
// Rows follow screen 9's shape: a label, an explanation underneath saying what
// it actually changes, and the control on the right. No icons, no cards.

const THEME_OPTIONS = [
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
  { id: "auto", name: "Auto" },
];

// Screen 10c's "Show momentum" switch is built here now that the strip it
// controls exists. It was deliberately left out until then: a switch that
// persists a preference nothing reads is a control that looks like it works
// and cannot.

export default function AppearanceSettings({ theme, onThemeChange, momentumEnabled = true, onMomentumChange }) {
  return (
    <section className="appearance">
      <div className="appearance-kicker">APPEARANCE</div>

      <div className="appearance-row">
        <div className="appearance-row-text">
          <div className="appearance-label">Theme</div>
        </div>
      </div>

      <div className="appearance-themes" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map(t => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme === t.id}
            className={`appearance-theme${theme === t.id ? " is-active" : ""}`}
            onClick={() => onThemeChange?.(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div className="appearance-theme-note">Auto follows your device’s dark mode.</div>

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
    </section>
  );
}
