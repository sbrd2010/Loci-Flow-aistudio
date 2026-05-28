import React from "react";

export default function BottomNav({ activeTab, onTabSelect }) {
  const tabs = [
    { id: "today", label: "Today", icon: "📋" },
    { id: "roadmap", label: "Roadmap", icon: "🗺️" },
    { id: "coach", label: "Coach", icon: "🎯" },
    { id: "mentor", label: "Mentor", icon: "🧠" }
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`nav-item ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onTabSelect(tab.id)}
        >
          <span className="nav-item-icon">{tab.icon}</span>
          <span>{tab.label}</span>
        </div>
      ))}
    </nav>
  );
}
