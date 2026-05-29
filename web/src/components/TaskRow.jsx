import React, { useState, useRef, useEffect } from "react";

const menuItemStyle = (color) => ({
  display: "flex", alignItems: "center", gap: "10px", width: "100%",
  background: "none", border: "none", padding: "11px 16px",
  cursor: "pointer", textAlign: "left", fontSize: "13px", fontWeight: "600",
  color
});

export default function TaskRow({ task, onToggleComplete, onPin, onDelete, onEdit, onMoveUp, onMoveDown }) {
  const { title, concreteStep, priority, isCompleted, isNowFocus } = task;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const hasActions = !isCompleted && (onEdit || onPin || onMoveUp || onMoveDown || onDelete);

  return (
    <div className={`task-row ${isCompleted ? "completed" : ""}`}>
      {/* Checkbox */}
      <div className="checkbox-container" onClick={() => onToggleComplete(task)}>
        <div className={`custom-checkbox ${isCompleted ? "checked" : ""}`}>
          {isCompleted && <span className="checkmark">✓</span>}
        </div>
      </div>

      {/* Task content — takes all available space */}
      <div className="task-middle">
        <div className="task-row-top">
          <span className={`priority-badge ${priority.toLowerCase()}`}>{priority}</span>
          {isNowFocus && !isCompleted && (
            <span style={{ fontSize: "9px", fontWeight: "800", color: "var(--warning)", background: "rgba(245,158,11,0.12)", padding: "2px 6px", borderRadius: "4px" }}>FOCUS</span>
          )}
          <span className="task-title-text" title={title}>{title}</span>
        </div>
        {concreteStep && (
          <span className="task-step-text">⚡ {concreteStep}</span>
        )}
      </div>

      {/* ⋮ menu for active tasks */}
      {hasActions ? (
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Task options"
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "20px", color: "var(--text-muted)", lineHeight: 1,
              padding: "8px 4px", borderRadius: "6px",
              minWidth: "32px", minHeight: "44px",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}
          >⋮</button>
          {menuOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 300,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "12px", boxShadow: "var(--shadow-lg)",
              minWidth: "168px", overflow: "hidden"
            }}>
              {onPin && (
                <button onClick={() => { onPin(task); setMenuOpen(false); }} style={menuItemStyle(isNowFocus ? "var(--warning)" : "var(--text-primary)")}>
                  {isNowFocus ? "📍 Unpin Focus" : "📌 Pin to Focus"}
                </button>
              )}
              {onEdit && (
                <button onClick={() => { onEdit(task); setMenuOpen(false); }} style={menuItemStyle("var(--text-primary)")}>
                  ✏ Edit task
                </button>
              )}
              {(onMoveUp || onMoveDown) && <div style={{ height: "1px", background: "var(--border)" }} />}
              {onMoveUp && (
                <button onClick={() => { onMoveUp(task); setMenuOpen(false); }} style={menuItemStyle("var(--text-secondary)")}>
                  ↑ Move up
                </button>
              )}
              {onMoveDown && (
                <button onClick={() => { onMoveDown(task); setMenuOpen(false); }} style={menuItemStyle("var(--text-secondary)")}>
                  ↓ Move down
                </button>
              )}
              {onDelete && <div style={{ height: "1px", background: "var(--border)" }} />}
              {onDelete && (
                <button onClick={() => { onDelete(task); setMenuOpen(false); }} style={menuItemStyle("var(--danger)")}>
                  🗑 Delete
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Completed tasks: single delete button */
        isCompleted && onDelete && (
          <button
            className="action-btn action-btn-delete"
            onClick={() => onDelete(task)}
            title="Delete"
          >🗑</button>
        )
      )}
    </div>
  );
}
