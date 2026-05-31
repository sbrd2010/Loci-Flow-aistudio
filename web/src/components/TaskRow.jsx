import React, { useState, useRef, useEffect } from "react";
import { formatReminderLabel } from "../utils/reminders";

const menuItemStyle = (color) => ({
  display: "flex", alignItems: "center", gap: "10px", width: "100%",
  background: "none", border: "none", padding: "10px 16px",
  cursor: "pointer", textAlign: "left", fontSize: "13px", fontWeight: "600",
  color, transition: "background 0.1s",
  borderRadius: "0"
});

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

export default function TaskRow({ task, onToggleComplete, onPin, onDelete, onEdit, onMoveUp, onMoveDown, onBreakdown, onSubStepToggle, onDeleteSubStep, isBreakingDown, onToggleMVD }) {
  const { title, concreteStep, priority, isCompleted, isNowFocus, subSteps, reminderAt, isMVD } = task;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [menuOpen]);

  const hasActions = !isCompleted && (onEdit || onPin || onMoveUp || onMoveDown || onDelete || onBreakdown);
  const activeSubSteps = subSteps?.filter(s => !s.done) ?? [];
  const doneSubSteps = subSteps?.filter(s => s.done) ?? [];
  const hasSubSteps = subSteps && subSteps.length > 0;

  return (
    <div className={`task-row ${isCompleted ? "completed" : ""}`} data-testid="task-row" style={menuOpen ? { zIndex: 400, position: "relative" } : undefined}>
      {/* Checkbox */}
      <div className="checkbox-container" data-testid="task-checkbox" onClick={() => onToggleComplete(task)}>
        <div className={`custom-checkbox ${isCompleted ? "checked" : ""}`}>
          {isCompleted && <span className="checkmark">✓</span>}
        </div>
      </div>

      {/* Task content */}
      <div className="task-middle">
        <div className="task-row-top">
          <span className={`priority-badge ${priority.toLowerCase()}`}>{priority}</span>
          {isNowFocus && !isCompleted && (
            <span style={{ fontSize: "9px", fontWeight: "800", color: "var(--warning)", background: "rgba(245,158,11,0.12)", padding: "2px 6px", borderRadius: "4px" }}>FOCUS</span>
          )}
          {isMVD && !isCompleted && (
            <span style={{ fontSize: "9px", fontWeight: "800", color: "var(--accent)", background: "var(--accent-ring, rgba(99,102,241,0.10))", padding: "2px 6px", borderRadius: "4px" }}>⭐ MUST-DO</span>
          )}
          <span className="task-title-text" title={title}>{title}</span>
        </div>
        {concreteStep && (
          <span className="task-step-text">⚡ {concreteStep}</span>
        )}
        {reminderAt && !isCompleted && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            fontSize: "10px", fontWeight: "700",
            color: reminderAt < Date.now() ? "var(--danger)" : "var(--accent)",
            background: reminderAt < Date.now() ? "rgba(248,113,113,0.1)" : "var(--accent-ring, rgba(99,102,241,0.08))",
            padding: "2px 7px", borderRadius: "4px", marginTop: "3px"
          }}>
            🔔 {formatReminderLabel(reminderAt)}{reminderAt < Date.now() ? " (overdue)" : ""}
          </span>
        )}

        {/* Sub-steps checklist */}
        {hasSubSteps && (
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "5px" }}>
            {[...activeSubSteps, ...doneSubSteps].map(step => (
              <div key={step.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0" }}>
                <div
                  onClick={() => onSubStepToggle && onSubStepToggle(task, step.id)}
                  style={{ display: "flex", alignItems: "center", gap: "8px", cursor: onSubStepToggle ? "pointer" : "default", flex: 1, minWidth: 0 }}
                >
                  <div style={{
                    width: "14px", height: "14px", borderRadius: "3px", flexShrink: 0,
                    border: step.done ? "none" : "1.5px solid var(--border)",
                    background: step.done ? "var(--success)" : "var(--bg-secondary)",
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>
                    {step.done && <span style={{ color: "#fff", fontSize: "9px", fontWeight: "800", lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{
                    fontSize: "12px", fontWeight: "500", lineHeight: "1.3",
                    color: step.done ? "var(--text-muted)" : "var(--text-secondary)",
                    textDecoration: step.done ? "line-through" : "none"
                  }}>{step.text}</span>
                </div>
                {onDeleteSubStep && (
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteSubStep(task, step.id); }}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "var(--text-muted)", padding: "0 2px", lineHeight: 1, flexShrink: 0, opacity: 0.55 }}
                    title="Remove step"
                    aria-label="Remove step"
                  >×</button>
                )}
              </div>
            ))}
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
              {doneSubSteps.length}/{subSteps.length} steps done
            </div>
          </div>
        )}

        {/* Breakdown loading indicator */}
        {isBreakingDown && (
          <span style={{ fontSize: "11px", color: "var(--accent)", fontStyle: "italic", marginTop: "6px", display: "block" }}>
            ✨ Breaking it down…
          </span>
        )}
      </div>

      {/* ⋮ menu for active tasks */}
      {hasActions ? (
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Task options"
            data-testid="task-menu-btn"
            style={{
              background: menuOpen ? "var(--bg-secondary)" : "transparent",
              border: `1.5px solid ${menuOpen ? "var(--border)" : "transparent"}`,
              cursor: "pointer", fontSize: "18px", fontWeight: "400",
              color: "var(--text-muted)", lineHeight: 1,
              padding: "4px 7px", borderRadius: "8px",
              minWidth: "30px", minHeight: "30px",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s", letterSpacing: 0
            }}
          >⋮</button>
          {menuOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 300,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "14px", boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)",
              minWidth: "188px", overflow: "hidden",
              backdropFilter: "blur(12px)"
            }}>
              {onPin && (
                <button onClick={() => { onPin(task); setMenuOpen(false); }} style={menuItemStyle(isNowFocus ? "var(--warning)" : "var(--text-primary)")}>
                  {isNowFocus ? "📍 Unpin Focus" : "📌 Pin to Focus"}
                </button>
              )}
              {onToggleMVD && (
                <button onClick={() => { onToggleMVD(task); setMenuOpen(false); }} style={menuItemStyle(isMVD ? "var(--text-muted)" : "var(--accent)")}>
                  {isMVD ? "✕ Remove must-do" : "⭐ Mark as must-do"}
                </button>
              )}
              {onBreakdown && !isBreakingDown && (
                <button onClick={() => { onBreakdown(task); setMenuOpen(false); }} style={menuItemStyle("var(--accent)")}>
                  ✨ Break it down
                </button>
              )}
              {onEdit && (
                <button data-testid="task-menu-edit" onClick={() => { onEdit(task); setMenuOpen(false); }} style={{ ...menuItemStyle("var(--text-primary)"), gap: "9px" }}>
                  <PencilIcon /> Edit task
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
                <button data-testid="task-menu-delete" onClick={() => { onDelete(task); setMenuOpen(false); }} style={menuItemStyle("var(--danger)")}>
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
