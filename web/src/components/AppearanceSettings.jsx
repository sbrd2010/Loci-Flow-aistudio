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

// Screen 10c also draws a "Show momentum" switch. It is NOT built here: the
// momentum strip it would control does not exist yet, so the switch would have
// persisted a preference that nothing reads — a control that looks like it
// works and cannot. It belongs in the commit that builds the strip.

export default function AppearanceSettings({ theme, onThemeChange }) {
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

      {!isRedesignTheme && (
        <p className="appearance-other">
          You're on another theme. Evening and Paper are the two the redesign is
          drawn for — everything else still works, but only these two follow it.
        </p>
      )}
    </section>
  );
}
