import React from "react";

export default function BottomNav({ activeTab, onTabSelect }) {
  const tabs = [
    { id: "today", label: "Today", icon: "📋" },
    { id: "roadmap", label: "Roadmap", icon: "🗺️" },
    { id: "coach", label: "Coach", icon: "🎯" },
    { id: "settings", label: "Settings", icon: "⚙️" }
  ];

  return (
    <nav className="bottom-nav" role="navigation" aria-label="Main navigation">
      {tabs.map((tab) => (
        /* Fix #25: Use <button> instead of <div> for keyboard/ARIA accessibility */
        <button
          key={tab.id}
          className={`nav-item ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onTabSelect(tab.id)}
          aria-current={activeTab === tab.id ? "page" : undefined}
          aria-label={tab.label}
          type="button"
        >
          <span className="nav-item-icon" aria-hidden="true">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
