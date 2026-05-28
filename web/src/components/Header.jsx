import React from "react";
import ThemeSwitcher from "./ThemeSwitcher";

export default function Header({ email, onSwitchUser, onGoHome, theme, onThemeChange }) {
  // Truncate email if too long
  const truncatedEmail = email && email.length > 18 
    ? `${email.substring(0, 15)}...` 
    : email;

  return (
    <header className="app-header">
      <div className="app-brand" onClick={onGoHome} style={{ cursor: "pointer" }}>
        <span>🧠 Loci</span>
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
