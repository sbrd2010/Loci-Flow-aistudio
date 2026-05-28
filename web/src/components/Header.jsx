import React from "react";

export default function Header({ email, onSwitchUser, onGoHome }) {
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
