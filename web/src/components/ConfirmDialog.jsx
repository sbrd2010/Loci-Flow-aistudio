import React from "react";

export default function ConfirmDialog({ message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, danger = false }) {
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 9000, display: "flex", alignItems: "center",
      justifyContent: "center", padding: "24px"
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: "24px",
        maxWidth: "320px", width: "100%",
        boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", gap: "16px"
      }}>
        <p style={{ fontSize: "14px", color: "var(--text-primary)", lineHeight: "1.65", whiteSpace: "pre-line", margin: 0 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn btn-cancel" onClick={onCancel} style={{ flex: 1, fontSize: "13px" }}>
            {cancelLabel}
          </button>
          <button className="btn" onClick={onConfirm}
            style={{ flex: 1, fontSize: "13px", ...(danger ? { background: "var(--danger)", color: "#fff" } : {}) }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
