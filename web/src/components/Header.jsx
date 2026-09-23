import React from "react";
import { TABS } from "./BottomNav";
import { IconSettings } from "./ui/icons";
import "../styles/shell.css";

// The header on every screen (turns 37, 41): the wordmark, the tabs on a
// laptop, the day's date and time left, and the Settings gear. On phones and
// tablets Settings has no tab, so the gear hides while you are in it and a tab
// takes you back; on a laptop it stays, marked as the current page.
export default function Header({ activeTab, onTabSelect, onGoHome, dayClock }) {
  const inSettings = activeTab === "settings";
  return (
    <header className={`shell-header${inSettings ? " is-settings" : ""}`}>
      <button type="button" className="shell-wordmark" onClick={onGoHome}>Loci</button>

      <nav className="shell-tabs" aria-label="Main navigation">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              className={`shell-tab${isActive ? " is-active" : ""}`}
              onClick={() => onTabSelect(id)}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={18} />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="shell-end">
        <span className="shell-clock">
          {dayClock.date}
          {dayClock.left && <> · <span className="shell-clock-left">{dayClock.left}</span> LEFT</>}
        </span>
        <button
          type="button"
          className={`shell-gear${inSettings ? " is-active" : ""}`}
          onClick={() => onTabSelect("settings")}
          aria-label="Settings"
          aria-current={inSettings ? "page" : undefined}
        >
          <IconSettings size={21} />
        </button>
      </div>
    </header>
  );
}
