import React, { useState, useRef, useCallback } from "react";
import { formatReminderLabel } from "../utils/reminders";
import LinkifyText from "./LinkifyText";
import { formatClock24, formatSpanCaps } from "../utils/dayMapPlan";
import { isEventTask } from "../utils/dayMapRoute";
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

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);

// Swipe distances (px): past SWIPE_DONE to the right marks done; to the left
// the row opens by SWIPE_REVEAL, the width of its two actions.
const SWIPE_DONE = 96;
const SWIPE_REVEAL = 176;
// Resting this long before moving makes it a long-press (reorder), not a swipe.
// It matches the TouchSensor's delay in TodayTab: a move any sooner cancels
// that pending reorder, so the swipe must take it or nothing would.
const SWIPE_LONG_PRESS_MS = 200;

export const ROADMAP_HORIZONS = [
  { key: "week",     label: "This Week" },
  { key: "month",    label: "Month" },
  { key: "quarter",  label: "Quarter" },
  { key: "halfyear", label: "6 Months" },
  { key: "office",   label: "Work" },
];

// A Today row (Q59, 70a): circle · title · how long. The 20px circle sits in
// a 44px tap area (tap it to mark done); the title wraps and grows the row,
// with one quiet line under it: "2 / 5 steps", MUST, GOAL, MIN, FROM
// YESTERDAY. A fixed time shows its span on the right instead (it isn't
// dragged). Tapping the row opens the task (50a–b), where its steps are; the
// list moves keyboard focus between rows (one tab stop, ↑/↓). On a laptop the
// grip shows on hover (70f), and a pin at the right: "Make the one thing · P"
// (50d); a row past the day's end offers Tomorrow · Park there (69e).
export default function TaskRow({ task, onToggleComplete, onDelete, onOpen, onMakeOneThing, tabStop = false, isTinted = false, onBreakdown, isBreakingDown, breakdownError, breakdownNoKey, dragHandleListeners, dragHandleAttributes, dragActivatorRef, interactionStyle = "classic", isGoal = false, isMin = false, fixedAt = null, minutes = null, overActions = null, fromTag = null, fromYesterday = false, onSwipeDone, onSwipeTomorrow, onPutOnFront }) {
  const { title, isCompleted, isNowFocus, subSteps, reminderAt, isMVD } = task;

  const hasActions = !isCompleted && !!onOpen;
  const stepsDone = subSteps?.filter(s => s.done).length ?? 0;
  const hasSubSteps = subSteps && subSteps.length > 0;
  const fixed = fixedAt != null && !isCompleted;
  const isDragAnywhere = interactionStyle === "dragAnywhere" && !!dragHandleListeners;
  // Swipe (touch only; 37c): right past a threshold marks done; left opens
  // "Tomorrow" and "Front" behind the row (50). The same actions are in the task
  // sheet, for screen readers and pointers. Only a clearly horizontal drag is
  // a swipe — anything else is left to scrolling and to drag-to-reorder
  // (whose long-press is cancelled by the movement).
  const canSwipe = !isCompleted && !!(onSwipeDone || onSwipeTomorrow || onPutOnFront);
  const [swipeX, setSwipeX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const swipeRef = useRef(null);
  const suppressClickRef = useRef(false);
  const onSwipeDown = (e) => {
    // One finger only: the swipe follows the pointer that began it.
    if (!canSwipe || e.pointerType !== "touch" || !e.isPrimary) return;
    // The grip is drag-to-reorder's; a gesture that starts on it is never a
    // swipe.
    if (e.target.closest?.(".task-row-grip")) return;
    swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, base: revealed ? -SWIPE_REVEAL : 0, active: false };
  };
  const onSwipeMove = (e) => {
    const sw = swipeRef.current;
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    if (!sw.active) {
      // Where the row itself starts a reorder (Drag anywhere), a finger that
      // rested first is that long-press (its touch sensor waits 200ms), not
      // a swipe. Elsewhere a hesitant swipe is still a swipe.
      if (isDragAnywhere && e.timeStamp - sw.t >= SWIPE_LONG_PRESS_MS) {
        swipeRef.current = null;
        return;
      }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        sw.active = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        // Count the move that crossed the line: a quick flick may send only
        // this one before it lifts.
      } else {
        if (Math.abs(dy) > 10) swipeRef.current = null;
        return;
      }
    }
    sw.last = dx;
    setSwipeX(Math.max(-SWIPE_REVEAL - 24, Math.min(SWIPE_DONE + 24, sw.base + dx)));
  };
  const onSwipeUp = (e) => {
    const sw = swipeRef.current;
    if (!sw || e.pointerId !== sw.id) return;
    swipeRef.current = null;
    if (!sw.active) return;
    // Where the finger lifted is the gesture's end (moves may be coalesced).
    sw.last = e.clientX - sw.x;
    // Only the click this pointerup may produce is swallowed; if it lands
    // elsewhere (or never comes), the next real tap must still open the task.
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 0);
    const end = sw.base + (sw.last || 0);
    if (end >= SWIPE_DONE && onSwipeDone) {
      setSwipeX(0);
      setRevealed(false);
      navigator.vibrate?.(10);
      onSwipeDone(task);
    } else if (end <= -SWIPE_REVEAL / 2 && (onSwipeTomorrow || onPutOnFront)) {
      setSwipeX(-SWIPE_REVEAL);
      setRevealed(true);
    } else {
      setSwipeX(0);
      setRevealed(false);
    }
  };
  // An interrupted gesture (the browser takes it over, a call comes in)
  // commits nothing: the row goes back to where it was.
  const onSwipeCancel = (e) => {
    const sw = swipeRef.current;
    if (!sw || e.pointerId !== sw.id) return;
    swipeRef.current = null;
    if (!sw?.active) return;
    setSwipeX(sw.base);
    setRevealed(sw.base !== 0);
  };
  const closeSwipe = () => { setSwipeX(0); setRevealed(false); };

  // The row is the keyboard's drag handle in both modes (Space picks it up):
  // the list is one tab stop (50b), so the grip is only for pointers.
  const setRowRef = useCallback(node => {
    if (dragActivatorRef) dragActivatorRef(node);
  }, [dragActivatorRef]);

  const row = (
    <div
      className={`task-row ${isCompleted ? "completed" : ""}${isTinted ? " is-tinted" : ""}${fixed ? " is-fixed" : ""}`}
      data-testid="task-row"
      data-task-uuid={task.uuid}
      ref={setRowRef}
      onClick={hasActions || canSwipe ? () => {
        // The click that ends a swipe is not a tap; a tap on an opened row
        // closes it.
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        if (revealed) { closeSwipe(); return; }
        if (hasActions) onOpen(task);
      } : undefined}
      {...(canSwipe ? { onPointerDown: onSwipeDown, onPointerMove: onSwipeMove, onPointerUp: onSwipeUp, onPointerCancel: onSwipeCancel } : {})}
      {...(dragHandleListeners ? {
        ...(isDragAnywhere ? dragHandleListeners : { onKeyDown: dragHandleListeners.onKeyDown }),
        "aria-disabled": dragHandleAttributes?.["aria-disabled"],
        "aria-describedby": dragHandleAttributes?.["aria-describedby"],
      } : {})}
      {...(hasActions ? { tabIndex: tabStop ? 0 : -1, "aria-label": `${title}${isMVD ? ", must-do" : ""}${isGoal ? ", goal task" : ""}. Enter to open.` } : {})}
      style={{
        ...(swipeX ? { transform: `translateX(${swipeX}px)`, transition: swipeRef.current ? "none" : undefined } : {}),
        ...(hasActions ? { cursor: "pointer" } : {}),
        ...(isDragAnywhere ? { cursor: "grab" } : {}),
      }}
    >
      {/* Grip handle: on hover only (70f); a fixed time isn't dragged. */}
      {dragHandleListeners && !isDragAnywhere && !fixed && (
        <button
          {...dragHandleListeners}
          {...(dragHandleAttributes || {})}
          className="task-row-grip"
          tabIndex={-1}
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
        tabIndex={hasActions ? -1 : undefined}
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

      <div className="task-middle">
        <span className="task-title-text"><LinkifyText text={title} /></span>
        {!isCompleted && (hasSubSteps || isNowFocus || isMVD || isGoal || isMin || fromTag || fromYesterday) && (
          <span className="task-row-tags">
            {hasSubSteps && <span className="task-row-steps">{stepsDone} / {subSteps.length} steps</span>}
            {isNowFocus && <span className="task-tag is-now" aria-label="Today's one thing">NOW</span>}
            {isMVD && <span className="task-tag is-must" aria-label="Must-do">MUST</span>}
            {isGoal && <span className="task-tag is-goal" aria-label="Goal task">GOAL</span>}
            {isMin && <span className="task-tag is-min" aria-label="Minimum day">MIN</span>}
            {/* Q44.5: moved here by a horizon review, for the day. */}
            {fromTag && <span className="task-tag is-from">{fromTag}</span>}
            {/* Q7: moved here from yesterday; the tag lasts the day. */}
            {fromYesterday && <span className="from-yesterday">FROM YESTERDAY</span>}
          </span>
        )}
        {reminderAt && !isCompleted && (
          <span className={`task-row-meta${reminderAt < Date.now() ? " is-overdue" : ""}`}>
            Reminder · {formatReminderLabel(reminderAt)}{reminderAt < Date.now() ? " (overdue)" : ""}
          </span>
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
              tabIndex={hasActions ? -1 : undefined}
              onClick={e => { e.stopPropagation(); onBreakdown(task); }}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
            >Try again</button>
          </span>
        )}
      </div>

      {/* Q1: a fixed time shows its span in --act; else how long it takes. */}
      {!isCompleted && (fixed || minutes != null) && (
        <span className={`task-row-dur${fixed ? " is-fixed" : ""}`}>
          {fixed ? `${formatClock24(fixedAt)}–${formatClock24(fixedAt + (minutes || 0))}` : formatSpanCaps(minutes)}
        </span>
      )}
      {/* 69e: past the day's end, Tomorrow · Park on hover (a laptop). */}
      {overActions && !isCompleted && (
        <span className="task-row-over-actions">
          <button type="button" tabIndex={-1} onClick={e => { e.stopPropagation(); overActions.onTomorrow(task); }} onMouseDown={e => e.stopPropagation()}>Tomorrow</button>
          <span aria-hidden="true">·</span>
          <button type="button" tabIndex={-1} onClick={e => { e.stopPropagation(); overActions.onPark(task); }} onMouseDown={e => e.stopPropagation()}>Park</button>
        </span>
      )}
      {onMakeOneThing && !isCompleted && !isNowFocus && !isEventTask(task) && (
        <button
          type="button"
          className="task-row-pin"
          tabIndex={-1}
          aria-label={`Make the one thing: ${title}`}
          title="Make the one thing · P"
          onClick={e => { e.stopPropagation(); onMakeOneThing(task); }}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <PinIcon /> <kbd className="wall-key" aria-hidden="true">P</kbd>
        </button>
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
    </div>
  );

  if (!canSwipe) return row;
  const shown = swipeX !== 0;
  return (
    <div className="task-swipe">
      {/* Behind the row: Done on the left (right swipe), Tomorrow and Front
          on the right (left swipe). Hidden from everyone until uncovered. */}
      <span className="task-swipe-done" aria-hidden="true" style={{ visibility: swipeX > 0 ? "visible" : "hidden" }}>Done</span>
      <span className="task-swipe-actions" style={{ visibility: shown && swipeX < 0 ? "visible" : "hidden" }}>
        {onSwipeTomorrow && (
          <button type="button" className="task-swipe-tomorrow" onClick={() => { closeSwipe(); onSwipeTomorrow(task); }}>Tomorrow</button>
        )}
        {onPutOnFront && (
          <button type="button" className="task-swipe-front" onClick={() => { closeSwipe(); onPutOnFront(task); }}>Front</button>
        )}
      </span>
      {row}
    </div>
  );
}
