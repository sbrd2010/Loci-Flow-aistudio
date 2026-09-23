import React, { useState, useRef, useEffect, useCallback } from "react";
import { formatReminderLabel } from "../utils/reminders";
import { safeCopyToClipboard } from "../utils/clipboard";
import LinkifyText from "./LinkifyText";
import "../styles/taskRow.css";

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

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
  </svg>
);

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
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

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="13 6 19 12 13 18"/>
  </svg>
);

const ParkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8H3v13h18V8z"/>
    <path d="M1 3h22v5H1z"/>
    <path d="M10 12h4"/>
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
        background: hovered ? (danger ? "var(--coral-tint)" : "var(--panel)") : "transparent",
        border: "none", padding: "9px 12px",
        cursor: "pointer", textAlign: "left", fontSize: "13px", fontWeight: "500",
        color: color || "var(--ink)",
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

const ROADMAP_HORIZONS = [
  { key: "week",     label: "This Week" },
  { key: "month",    label: "Month" },
  { key: "quarter",  label: "Quarter" },
  { key: "halfyear", label: "6 Months" },
  { key: "office",   label: "Work" },
];

// A Today row (41a; Addendum AA): a 20px circle in a 44px tap area (tap it to
// mark done), a mono priority tag, a title that wraps and grows the row, and
// MUST / GOAL tags. Tapping the row opens its menu.
export default function TaskRow({ task, onToggleComplete, onPin, onDelete, onEdit, onMoveUp, onMoveDown, onMoveToHorizon, onPark, onBreakdown, onSubStepToggle, onDeleteSubStep, isBreakingDown, breakdownError, breakdownNoKey, onToggleMVD, dragHandleListeners, dragHandleAttributes, dragActivatorRef, interactionStyle = "classic", isGoal = false }) {
  const { title, concreteStep, priority, isCompleted, isNowFocus, subSteps, reminderAt, isMVD } = task;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showRoadmapOptions, setShowRoadmapOptions] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef(null);
  const copyTimeoutRef = useRef(null);

  useEffect(() => () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); }, []);

  useEffect(() => {
    if (!menuOpen) setShowRoadmapOptions(false);
  }, [menuOpen]);

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

  const hasActions = !isCompleted && (onEdit || onPin || onDelete || onBreakdown || onMoveToHorizon || onPark);
  const activeSubSteps = subSteps?.filter(s => !s.done) ?? [];
  const doneSubSteps = subSteps?.filter(s => s.done) ?? [];
  const hasSubSteps = subSteps && subSteps.length > 0;
  const isDragAnywhere = interactionStyle === "dragAnywhere" && !!dragHandleListeners;

  const setRowRef = useCallback(node => {
    menuRef.current = node;
    if (isDragAnywhere && dragActivatorRef) dragActivatorRef(node);
  }, [isDragAnywhere, dragActivatorRef]);

  return (
    <div
      className={`task-row ${isCompleted ? "completed" : ""}`}
      data-testid="task-row"
      ref={setRowRef}
      onClick={hasActions ? () => setMenuOpen(o => !o) : undefined}
      {...(isDragAnywhere ? {
        ...dragHandleListeners,
        tabIndex: dragHandleAttributes?.tabIndex,
        "aria-disabled": dragHandleAttributes?.["aria-disabled"],
        "aria-describedby": dragHandleAttributes?.["aria-describedby"],
      } : {})}
      style={{
        ...(menuOpen ? { zIndex: 400, position: "relative" } : {}),
        ...(hasActions ? { cursor: "pointer" } : {}),
        ...(isDragAnywhere ? { cursor: "grab" } : {}),
      }}
    >
      {/* Grip handle */}
      {dragHandleListeners && !isDragAnywhere && (
        <button
          {...dragHandleListeners}
          {...(dragHandleAttributes || {})}
          className="task-row-grip"
          onClick={e => e.stopPropagation()}
          aria-label="Drag to reorder"
          title="Drag to reorder"
        >
          <GripIcon />
        </button>
      )}

      {/* The circle: 20px, in a 44px tap area. */}
      <button
        type="button"
        className="checkbox-container"
        data-testid="task-checkbox"
        aria-label={isCompleted ? `Mark not done: ${title}` : `Mark done: ${title}`}
        aria-pressed={!!isCompleted}
        onClick={e => { e.stopPropagation(); onToggleComplete(task); }}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
      >
        <span className={`custom-checkbox ${isCompleted ? "checked" : ""}`}>
          {isCompleted && <CheckIcon />}
        </span>
      </button>

      {priority && (
        <span className="task-row-priority" aria-label={`Priority ${priority.replace(/\D/g, "")}`}>{priority}</span>
      )}

      <div className="task-middle">
        <div className="task-row-top">
          <span className="task-title-text"><LinkifyText text={title} /></span>
          {!isCompleted && (isNowFocus || isMVD || isGoal) && (
            <span className="task-row-tags">
              {isNowFocus && <span className="task-tag is-now" aria-label="Today's one thing">NOW</span>}
              {isMVD && <span className="task-tag is-must" aria-label="Must-do">MUST</span>}
              {isGoal && <span className="task-tag is-goal" aria-label="Goal task">GOAL</span>}
            </span>
          )}
        </div>
        {reminderAt && !isCompleted && (
          <span className={`task-row-meta${reminderAt < Date.now() ? " is-overdue" : ""}`}>
            Reminder · {formatReminderLabel(reminderAt)}{reminderAt < Date.now() ? " (overdue)" : ""}
          </span>
        )}

        {/* Sub-steps checklist */}
        {hasSubSteps && (
          <div className="task-substeps">
            {[...activeSubSteps, ...doneSubSteps].map(step => (
              <div key={step.id} className="task-substep">
                <div
                  className="task-substep-main"
                  onClick={e => { e.stopPropagation(); onSubStepToggle && onSubStepToggle(task, step.id); }}
                  onMouseDown={e => e.stopPropagation()}
                  onTouchStart={e => e.stopPropagation()}
                  style={{ cursor: onSubStepToggle ? "pointer" : "default" }}
                >
                  <span className={`task-substep-box${step.done ? " is-done" : ""}`}>
                    {step.done && <CheckIcon />}
                  </span>
                  <span className={`task-substep-text${step.done ? " is-done" : ""}`}>{step.text}</span>
                </div>
                {onDeleteSubStep && (
                  <button
                    className="task-substep-remove"
                    onClick={e => { e.stopPropagation(); onDeleteSubStep(task, step.id); }}
                    onMouseDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    title="Remove step"
                    aria-label="Remove step"
                  >×</button>
                )}
              </div>
            ))}
            <div className="task-row-meta">{doneSubSteps.length}/{subSteps.length} steps done</div>
          </div>
        )}

        {isBreakingDown && (
          <span className="task-row-meta">Breaking it down…</span>
        )}

        {breakdownNoKey && !isBreakingDown && (
          <span className="task-row-meta">Add an AI key in Settings to use this.</span>
        )}

        {breakdownError && !breakdownNoKey && !isBreakingDown && (
          <span className="task-row-meta is-overdue">
            Couldn't break this down.{" "}
            <button
              className="task-row-retry"
              onClick={e => { e.stopPropagation(); onBreakdown(task); }}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
            >Try again</button>
          </span>
        )}
      </div>

      {/* options dropdown — triggered by tapping the card body */}
      {menuOpen && (
        <div
          data-testid="task-options-menu"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          className="task-row-menu">
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
          <MenuItem
            testId="task-menu-copy"
            color={copied ? "var(--success)" : "var(--text-primary)"}
            onClick={() => {
              const text = concreteStep && concreteStep !== "Do first tiny step"
                ? `${title}\n${concreteStep}`
                : title;
              safeCopyToClipboard(text).then(ok => {
                if (ok) {
                  if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
                  setCopied(true);
                  copyTimeoutRef.current = setTimeout(() => {
                    setCopied(false);
                    setMenuOpen(false);
                    copyTimeoutRef.current = null;
                  }, 900);
                } else {
                  setMenuOpen(false);
                }
              });
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied!" : "Copy"}
          </MenuItem>
          {onMoveToHorizon && (
            <>
              <div style={{ height: "1px", margin: "5px 8px", background: "var(--border)", opacity: 0.5 }} />
              {!showRoadmapOptions ? (
                <MenuItem onClick={() => setShowRoadmapOptions(true)} color="var(--text-secondary)">
                  <ArrowRightIcon />
                  <span style={{ flex: 1 }}>Move to roadmap</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </MenuItem>
              ) : (
                <>
                  <div style={{ fontSize: "9px", fontWeight: "800", color: "var(--text-muted)", padding: "4px 12px 2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Move to roadmap
                  </div>
                  {ROADMAP_HORIZONS.map(({ key, label }) => (
                    <MenuItem key={key} onClick={() => { onMoveToHorizon(task, key); setMenuOpen(false); }} color="var(--text-secondary)">
                      <ArrowRightIcon /> {label}
                    </MenuItem>
                  ))}
                </>
              )}
            </>
          )}
          {onPark && (
            <MenuItem testId="task-menu-park" onClick={() => { onPark(task); setMenuOpen(false); }} color="var(--text-secondary)">
              <ParkIcon /> Park for later
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
      {isCompleted && onDelete && (
        <button
          className="task-row-delete"
          onClick={e => { e.stopPropagation(); onDelete(task); }}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          aria-label={`Delete: ${title}`}
          title="Delete"
        ><TrashIcon /></button>
      )}
      {isDragAnywhere && hasActions && (
        <button
          className="task-row-kebab-btn"
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          aria-label="Task options"
          aria-expanded={menuOpen}
          title="Task options"
        >⋮</button>
      )}
    </div>
  );
}
