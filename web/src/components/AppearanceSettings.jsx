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

export default function AppearanceSettings({ theme, onThemeChange, config = {}, saveConfigPatch }) {
  // The design's momentum strip is "days moved, never a streak you can break",
  // and it is toggleable. Default on: it is the reason to open the app
  // tomorrow, so hiding it by default would defeat the point.
  const showMomentum = config.showMomentum !== false;
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

      <div className="appearance-row">
        <div className="appearance-row-text">
          <div className="appearance-label">Show momentum</div>
          <div className="appearance-note">Days moved. Never a streak you can break</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showMomentum}
          aria-label="Show momentum"
          className={`appearance-toggle${showMomentum ? " is-on" : ""}`}
          onClick={() => saveConfigPatch?.({ showMomentum: !showMomentum })}
        >
          <span className="appearance-knob" />
        </button>
      </div>
    </section>
  );
}
