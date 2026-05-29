import React, { useEffect } from "react";

export default function RescueMode({ task, onDismiss, onAccept }) {
  // Disable background scroll when active
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const action = task
    ? task.concreteStep || `Open your notes and write: "${task.title.substring(0, 40)}"`
    : "Open your task list. Pick ONE task. Start it.";

  const taskTitle = task ? task.title : "Your next task";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000",
      zIndex: 9999, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', system-ui, sans-serif", padding: "24px",
      userSelect: "none"
    }}>
      {/* Corner brackets — visual urgency */}
      {["top-left","top-right","bottom-left","bottom-right"].map(pos => (
        <div key={pos} style={{
          position: "absolute",
          top: pos.includes("top") ? 24 : "auto",
          bottom: pos.includes("bottom") ? 24 : "auto",
          left: pos.includes("left") ? 24 : "auto",
          right: pos.includes("right") ? 24 : "auto",
          width: 32, height: 32,
          borderTop: pos.includes("top") ? "3px solid rgba(255,255,255,0.2)" : "none",
          borderBottom: pos.includes("bottom") ? "3px solid rgba(255,255,255,0.2)" : "none",
          borderLeft: pos.includes("left") ? "3px solid rgba(255,255,255,0.2)" : "none",
          borderRight: pos.includes("right") ? "3px solid rgba(255,255,255,0.2)" : "none",
        }} />
      ))}

      {/* Warning badge */}
      <div style={{
        background: "#fecb00", color: "#000", padding: "4px 14px",
        fontSize: "10px", fontWeight: "800", letterSpacing: "0.12em",
        textTransform: "uppercase", marginBottom: "32px", borderRadius: "2px"
      }}>
        ⚠ Rescue Mode Active
      </div>

      {/* Main directive */}
      <div style={{ textAlign: "center", marginBottom: "40px", maxWidth: "520px" }}>
        <p style={{
          fontSize: "13px", fontWeight: "700", color: "rgba(255,255,255,0.4)",
          letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "16px"
        }}>
          Just do this one thing:
        </p>
        <h1 style={{
          fontSize: "clamp(28px, 6vw, 48px)", fontWeight: "900",
          color: "#ffffff", lineHeight: "1.15", marginBottom: "12px"
        }}>
          {action}
        </h1>
        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)" }}>
          Task: {taskTitle}
        </p>
      </div>

      {/* Accept button */}
      <button
        onClick={onAccept}
        style={{
          width: "100%", maxWidth: "400px", height: "72px",
          background: "#ff5545", color: "#ffffff",
          fontSize: "18px", fontWeight: "900", letterSpacing: "0.04em",
          textTransform: "uppercase", border: "none", cursor: "pointer",
          borderRadius: "4px", marginBottom: "16px",
          animation: "rescue-pulse 1.5s infinite ease-in-out",
          transition: "transform 0.1s"
        }}
        onMouseDown={e => e.currentTarget.style.transform = "scale(0.97)"}
        onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
      >
        Accept &amp; Start Now
      </button>

      {/* Dismiss link */}
      <button
        onClick={onDismiss}
        style={{
          background: "none", border: "none", color: "rgba(255,255,255,0.25)",
          fontSize: "12px", cursor: "pointer", letterSpacing: "0.06em",
          textTransform: "uppercase"
        }}
      >
        Not now — exit rescue mode
      </button>

      <style>{`
        @keyframes rescue-pulse {
          0%, 100% { box-shadow: 0 0 0px #ff5545; }
          50% { box-shadow: 0 0 30px rgba(255, 85, 69, 0.7); }
        }
      `}</style>
    </div>
  );
}
