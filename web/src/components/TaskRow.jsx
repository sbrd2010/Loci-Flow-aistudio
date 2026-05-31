import React, { useState, useRef, useEffect } from "react";
import { formatReminderLabel } from "../utils/reminders";

const GripIcon = () => (
  <svg width="10" height="15" viewBox="0 0 10 15" fill="currentColor">
    <circle cx="3" cy="2.5" r="1.5"/>
    <circle cx="3" cy="7.5" r="1.5"/>
    <circle cx="3" cy="12.5" r="1.5"/>
    <circle cx="7" cy="2.5" r="1.5"/>
    <circle cx="7" cy="7.5" r="1.5"/>
    <circle cx="7" cy="12.5" r="1.5"/>
  </svg>
);

const MoreVertIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="2.2"/>
    <circle cx="12" cy="12" r="2.2"/>
    <circle cx="12" cy="19" r="2.2"/>
  </svg>
);

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
  </svg>
);

const PinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="17" x2="12" y2="22"/>
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
  </svg>
);

const UnpinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="2" x2="22" y2="22"/>
    <line x1="12" y1="17" x2="12" y2="22"/>
    <path d="M9.586 4H15v2.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 11.24V17"/>
    <path d="M5 17h9"/>
  </svg>
);

const StarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const StarOffIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" opacity="0.4"/>
    <line x1="2" y1="2" x2="22" y2="22"/>
  </svg>
);

const BoltIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);

const ArrowUpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5"/>
    <polyline points="5 12 12 5 19 12"/>
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <polyline points="19 12 12 19 5 12"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);

function MenuItem({ onClick, color, danger, testId, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={() => setHovered(true)}
      onTouchEnd={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: "10px", width: "100%",
        background: hovered
          ? (danger ? "rgba(248,113,113,0.10)" : "rgba(255,255,255,0.06)")
          : "transparent",
        border: "none", padding: "9px 12px",
        cursor: "pointer", textAlign: "left", fontSize: "13px", fontWeight: "500",
        color: color || "var(--text-primary)",
        transition: "background 0.12s",
        borderRadius: "9px",
        fontFamily: "var(--font-sans)",
        letterSpacing: "0.01em",
        lineHeight: "1.2"
      }}
    >
      {children}
    </button>
  );
}

export default function TaskRow({ task, onToggleComplete, onPin, onDelete, onEdit, onMoveUp, onMoveDown, onBreakdown, onSubStepToggle, onDeleteSubStep, isBreakingDown, onToggleMVD, dragHandleListeners, dragHandleAttributes }) {
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
    <div
      className={`task-row ${isCompleted ? "completed" : ""}`}
      data-testid="task-row"
      style={{
        ...(menuOpen ? { zIndex: 400, position: "relative" } : {}),
      }}
    >
      {/* Grip handle */}
      {dragHandleListeners && (
        <button
          {...dragHandleListeners}
          {...(dragHandleAttributes || {})}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          style={{
            background: "none", border: "none",
            cursor: "grab",
            flexShrink: 0,
            color: "var(--text-muted)",
            opacity: 0.35,
            padding: "4px 6px",
            display: "flex", alignItems: "center", justifyContent: "center",
            touchAction: "none",
          }}
        >
          <GripIcon />
        </button>
      )}

      {/* Checkbox */}
      <div className="checkbox-container" data-testid="task-checkbox" onClick={e => { e.stopPropagation(); onToggleComplete(task); }}>
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

        {isBreakingDown && (
          <span style={{ fontSize: "11px", color: "var(--accent)", fontStyle: "italic", marginTop: "6px", display: "block" }}>
            ✨ Breaking it down…
          </span>
        )}
      </div>

      {/* ⋮ context menu */}
      {hasActions ? (
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Task options"
            data-testid="task-menu-btn"
            style={{
              background: menuOpen ? "rgba(255,255,255,0.08)" : "transparent",
              border: `1px solid ${menuOpen ? "var(--border)" : "transparent"}`,
              cursor: "pointer",
              color: menuOpen ? "var(--text-primary)" : "var(--text-muted)",
              opacity: menuOpen ? 1 : 0.45,
              padding: "5px 7px", borderRadius: "8px",
              minWidth: "30px", minHeight: "30px",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s"
            }}
          >
            <MoreVertIcon />
          </button>

          {menuOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 300,
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.18)",
              minWidth: "200px",
              padding: "6px",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)"
            }}>
              {onPin && (
                <MenuItem onClick={() => { onPin(task); setMenuOpen(false); }} color={isNowFocus ? "var(--warning)" : "var(--text-primary)"}>
                  {isNowFocus ? <UnpinIcon /> : <PinIcon />}
                  {isNowFocus ? "Unpin from Focus" : "Pin to Focus"}
                </MenuItem>
              )}
              {onToggleMVD && (
                <MenuItem onClick={() => { onToggleMVD(task); setMenuOpen(false); }} color={isMVD ? "var(--text-muted)" : "var(--accent)"}>
                  {isMVD ? <StarOffIcon /> : <StarIcon />}
                  {isMVD ? "Remove must-do" : "Mark as must-do"}
                </MenuItem>
              )}
              {onBreakdown && !isBreakingDown && (
                <MenuItem onClick={() => { onBreakdown(task); setMenuOpen(false); }} color="var(--accent)">
                  <BoltIcon /> Break it down
                </MenuItem>
              )}
              {onEdit && (
                <MenuItem testId="task-menu-edit" onClick={() => { onEdit(task); setMenuOpen(false); }}>
                  <PencilIcon /> Edit task
                </MenuItem>
              )}
              {(onMoveUp || onMoveDown) && (
                <div style={{ height: "1px", margin: "5px 8px", background: "var(--border)", opacity: 0.5 }} />
              )}
              {onMoveUp && (
                <MenuItem onClick={() => { onMoveUp(task); setMenuOpen(false); }} color="var(--text-secondary)">
                  <ArrowUpIcon /> Move up
                </MenuItem>
              )}
              {onMoveDown && (
                <MenuItem onClick={() => { onMoveDown(task); setMenuOpen(false); }} color="var(--text-secondary)">
                  <ArrowDownIcon /> Move down
                </MenuItem>
              )}
              {onDelete && (
                <>
                  <div style={{ height: "1px", margin: "5px 8px", background: "var(--border)", opacity: 0.5 }} />
                  <MenuItem testId="task-menu-delete" danger onClick={() => { onDelete(task); setMenuOpen(false); }} color="var(--danger)">
                    <TrashIcon /> Delete
                  </MenuItem>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
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
