import React from "react";
import { IconTarget, IconCalendar, IconInbox, IconMessageCircle } from "./ui/icons";
import "../styles/shell.css";

// The four tabs (Addendum AA). Settings is not a tab: it is the gear in the
// header. The ids are the app's existing routes; only the labels changed.
export const TABS = [
  { id: "today",   label: "Today",    Icon: IconTarget },
  { id: "roadmap", label: "Plan",     Icon: IconCalendar },
  { id: "mindbox", label: "Mind Box", Icon: IconInbox },
  { id: "coach",   label: "Coach",    Icon: IconMessageCircle },
];

// Phones and tablets. From 1024px the same tabs sit in the header instead, and
// shell.css hides this bar, so exactly one "Main navigation" is ever visible.
export default function BottomNav({ activeTab, onTabSelect }) {
  return (
    <nav className="tab-bar" aria-label="Main navigation">
      {TABS.map(({ id, label, Icon }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            className={`tab-bar-item${isActive ? " is-active" : ""}`}
            onClick={() => onTabSelect(id)}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="tab-bar-pill"><Icon size={21} strokeWidth={isActive ? 2.2 : 1.8} /></span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
