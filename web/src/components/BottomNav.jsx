import React from "react";

const TodayIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/>
    <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2"/>
    <circle cx="12" cy="12" r="2" fill="currentColor"/>
  </svg>
);

const RoadmapIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2"/>
    <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="2"/>
    <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2"/>
    <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2"/>
    <line x1="7" y1="13" x2="11" y2="13" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="7" y1="17" x2="11" y2="17" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="13" y1="13" x2="17" y2="13" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="13" y1="17" x2="17" y2="17" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const MindBoxIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 5.25A3.25 3.25 0 0 0 5.8 8.4 3.15 3.15 0 0 0 4 11.25c0 1.16.62 2.18 1.55 2.74A3.25 3.25 0 0 0 9 18.25h.5"/>
    <path d="M14.5 5.25a3.25 3.25 0 0 1 3.7 3.15A3.15 3.15 0 0 1 20 11.25c0 1.16-.62 2.18-1.55 2.74A3.25 3.25 0 0 1 15 18.25h-.5"/>
    <path d="M9.5 5.25v13"/>
    <path d="M14.5 5.25v13"/>
    <path d="M8.2 9.1c.7-.55 1.58-.72 2.35-.45"/>
    <path d="M15.8 9.1c-.7-.55-1.58-.72-2.35-.45"/>
    <path d="M7.85 13.1c.82.25 1.72.12 2.4-.34"/>
    <path d="M16.15 13.1c-.82.25-1.72.12-2.4-.34"/>
  </svg>
);

const CoachIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="2"/>
    <path d="M10 6.5c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M12 12.01v0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M5 20c0-3.31 3.13-6 7-6s7 2.69 7 6" fill="none" stroke="currentColor" strokeWidth="2"/>
  </svg>
);

const SettingsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
  </svg>
);

const TABS = [
  { id: "today",    label: "Today",    Icon: TodayIcon,    color: "var(--accent)" },
  { id: "roadmap",  label: "Roadmap",  Icon: RoadmapIcon,  color: "var(--success)" },
  { id: "mindbox",  label: "Mind Box", Icon: MindBoxIcon,  color: "var(--accent-secondary)" },
  { id: "coach",    label: "AI Coach", Icon: CoachIcon,    color: "var(--p1-text)" },
  { id: "settings", label: "Settings", Icon: SettingsIcon, color: "var(--warning)" },
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
                color: isActive ? color : "var(--text-secondary)",
                background: isActive ? "var(--accent-light)" : "transparent",
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
