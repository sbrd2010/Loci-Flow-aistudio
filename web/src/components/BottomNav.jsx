import React from "react";

const HomeIcon = ({ filled }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
  </svg>
);

const PlanIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
  </svg>
);

const CoachIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-3 10H7v-2h10v2zm0-3H7V7h10v2z"/>
  </svg>
);

const SettingsIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
  </svg>
);

const TABS = [
  { id: "today",    label: "Home",     Icon: HomeIcon,     color: "#3b82f6" },
  { id: "roadmap",  label: "Plan",     Icon: PlanIcon,     color: "#10b981" },
  { id: "coach",    label: "AI Coach", Icon: CoachIcon,    color: "#8b5cf6" },
  { id: "settings", label: "Settings", Icon: SettingsIcon, color: "#f59e0b" },
];

export default function BottomNav({ activeTab, onTabSelect }) {
  return (
    <nav className="bottom-nav" role="navigation" aria-label="Main navigation">
      {TABS.map(({ id, label, Icon, color }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            className={`nav-item ${isActive ? "active" : ""}`}
            onClick={() => onTabSelect(id)}
            aria-current={isActive ? "page" : undefined}
            aria-label={label}
            type="button"
          >
            <span
              className="nav-item-icon"
              aria-hidden="true"
              style={{
                color: color,
                background: isActive ? `${color}22` : "transparent",
                transform: isActive ? "scale(1.08)" : "scale(1)",
              }}
            >
              <Icon />
            </span>
            <span style={{ color: isActive ? color : "var(--text-secondary)", fontWeight: isActive ? 700 : 600 }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
