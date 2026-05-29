import React from "react";
import ThemeSwitcher from "./ThemeSwitcher";

export default function Header({ email, onSwitchUser, onGoHome, theme, onThemeChange }) {
  // Truncate email if too long
  const truncatedEmail = email && email.length > 18 
    ? `${email.substring(0, 15)}...` 
    : email;

  return (
    <header className="app-header">
      <div className="app-brand" onClick={onGoHome} style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "26px" }}>🧠</span>
          <span style={{ fontSize: "24px", fontWeight: "900", fontFamily: "var(--font-display)" }}>Loci</span>
        </div>
        <span style={{ fontSize: "10px", fontWeight: "500", color: "var(--text-muted)", letterSpacing: "0.03em", marginLeft: "2px", lineHeight: "1" }}>Your daily focus companion.</span>
      </div>
      <div className="header-right">
        <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
        <span className="user-badge" title={email}>
          {truncatedEmail}
        </span>
        <button className="switch-btn" onClick={onSwitchUser}>
          Switch
        </button>
      </div>
    </header>
  );
}
