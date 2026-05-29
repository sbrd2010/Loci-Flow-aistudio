import React from "react";
import ThemeSwitcher from "./ThemeSwitcher";

export default function Header({ userName, onGoHome, theme, onThemeChange }) {
  // Show first name, fall back to first two letters of whatever was given
  const firstName = userName ? userName.split(" ")[0] : "";
  const display = firstName || "Me";

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
        <span className="user-badge" style={{ fontWeight: "700" }}>
          {display}
        </span>
      </div>
    </header>
  );
}
