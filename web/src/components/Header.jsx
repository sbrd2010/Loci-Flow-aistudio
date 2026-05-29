import React from "react";
import ThemeSwitcher from "./ThemeSwitcher";

export default function Header({ email, onSwitchUser, onGoHome, theme, onThemeChange }) {
  const truncatedEmail = email && email.length > 18
    ? `${email.substring(0, 15)}...`
    : email;

  // Two-letter initials from email local part (e.g. rohan.das@ → "RD")
  const initials = email
    ? email.split("@")[0].split(/[._\-+]/).filter(Boolean).map(p => p[0].toUpperCase()).slice(0, 2).join("")
    : "?";

  return (
    <header className="app-header">
      <div
        className="app-brand"
        onClick={onGoHome}
        style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "26px" }}>🧠</span>
          <span style={{ fontSize: "24px", fontWeight: "900", fontFamily: "var(--font-display)" }}>Loci</span>
        </div>
        <span className="header-subtitle">Your daily focus companion.</span>
      </div>
      <div className="header-right">
        <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
        {/* Full email badge — hidden on narrow phones via CSS */}
        <span className="user-badge header-email-badge" title={email}>
          {truncatedEmail}
        </span>
        {/* Initials circle — shown only on narrow phones via CSS */}
        <span className="user-badge header-initials-badge" title={email}>
          {initials}
        </span>
        <button className="switch-btn" onClick={onSwitchUser}>
          Switch
        </button>
      </div>
    </header>
  );
}
