import React, { useState, useRef, useEffect } from "react";
import { formatReminderLabel } from "../utils/reminders";

const menuItemStyle = (color) => ({
  display: "flex", alignItems: "center", gap: "10px", width: "100%",
  background: "none", border: "none", padding: "11px 16px",
  cursor: "pointer", textAlign: "left", fontSize: "13px", fontWeight: "600",
  color
});

export default function TaskRow({ task, onToggleComplete, onPin, onDelete, onEdit, onMoveUp, onMoveDown, onBreakdown, onSubStepToggle, isBreakingDown }) {
  const { title, concreteStep, priority, isCompleted, isNowFocus, subSteps, reminderAt } = task;
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
              <div
                key={step.id}
                onClick={() => onSubStepToggle && onSubStepToggle(task, step.id)}
                style={{ display: "flex", alignItems: "center", gap: "8px", cursor: onSubStepToggle ? "pointer" : "default", padding: "3px 0" }}
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
              background: "var(--bg-secondary)", border: "1.5px solid var(--border)",
              cursor: "pointer", fontSize: "16px", fontWeight: "900",
              color: "var(--text-secondary)", lineHeight: 1,
              padding: "5px 9px", borderRadius: "8px",
              minWidth: "34px", minHeight: "34px",
              display: "flex", alignItems: "center", justifyContent: "center",
              letterSpacing: "0.05em"
            }}
          >•••</button>
          {menuOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 300,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "12px", boxShadow: "var(--shadow-lg)",
              minWidth: "178px", overflow: "hidden"
            }}>
              {onPin && (
                <button onClick={() => { onPin(task); setMenuOpen(false); }} style={menuItemStyle(isNowFocus ? "var(--warning)" : "var(--text-primary)")}>
                  {isNowFocus ? "📍 Unpin Focus" : "📌 Pin to Focus"}
                </button>
              )}
              {onBreakdown && !isBreakingDown && (
                <button onClick={() => { onBreakdown(task); setMenuOpen(false); }} style={menuItemStyle("var(--accent)")}>
                  ✨ Break it down
                </button>
              )}
              {onEdit && (
                <button data-testid="task-menu-edit" onClick={() => { onEdit(task); setMenuOpen(false); }} style={menuItemStyle("var(--text-primary)")}>
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
