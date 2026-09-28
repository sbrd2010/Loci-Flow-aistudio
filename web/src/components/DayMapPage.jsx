import React, { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dayProgress, formatClock24, formatSpan, moveToTomorrow, restoreSchedule } from "../utils/dayMapPlan";
import { mergeWindowSpans } from "../utils/focusWindows";
import { isDeferred } from "../utils/deferral";
import {
  DURATION_OPTIONS, applyReflow, currentDayMinutes, getEstimate, getTaskId,
  normalizePriority, reflowRoute, removeScheduleFields, useDayRoute,
} from "../hooks/useDayRoute";
import DayClockBar from "./DayClockBar";
import LinkifyText from "./LinkifyText";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import { IconChevronLeft, IconPlus, IconX } from "./ui/icons";
import "../styles/dayMap.css";

// Day map (50e–f, 52d–e). Today's tasks laid end to end from a start time,
// as a flat list: the time each starts, the task, how long. The day ends when
// the focus time left runs out: a red DAY ENDS line, and what starts after it
// is listed under WON'T FIT TODAY. "Move N to tomorrow" puts those at the top
// of tomorrow's route (nothing is deleted), with Undo. Above the route:
// From · Auto-fill · Clear route; the route never builds itself. Tasks not on
// it wait in Unscheduled — a card on the right (laptop), a bar that opens a
// sheet (phone) — and "+" adds one to the end of the route.

function RouteStop({ task, isNow, isOver, isGoal, isExpanded, onToggle, onRemove, onDurationChange, onStartFocus }) {
  const taskId = getTaskId(task);
  const {
    attributes, listeners, setActivatorNodeRef,
    setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: taskId, data: { taskId } });

  const duration = getEstimate(task);
  const start = Number(task.dayMapStartMinutes ?? 0);
  const p = normalizePriority(task.priority);
  const subSteps = task.subSteps || [];
  const orderedSubSteps = [...subSteps.filter(s => !s.done), ...subSteps.filter(s => s.done)];
  // Brief §6: each block reads "09:00 to 10:15, Acme CV".
  const label = `${isNow ? "Now" : formatClock24(start)} to ${formatClock24(start + duration)}, ${task.title}, Priority ${p.slice(1)}`
    + (isGoal ? ", goal task" : "") + (isOver ? ", after the day ends" : "");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
    zIndex: isDragging ? 5 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`dm-stop${isNow ? " is-now" : ""}${isOver ? " is-over" : ""}${isDragging ? " is-dragging" : ""}`}
      data-task-uuid={taskId}
    >
      <div
        ref={setActivatorNodeRef}
        className="dm-main"
        aria-label={label}
        aria-expanded={isExpanded}
        tabIndex={attributes.tabIndex}
        role={attributes.role}
        aria-roledescription={attributes["aria-roledescription"]}
        aria-describedby={attributes["aria-describedby"]}
        onClick={onToggle}
        {...listeners}
        // Space picks the stop up (the drag's key); Enter opens it, as a
        // row does in Today's list.
        onKeyDown={e => {
          // (While it is held, onToggle ignores it: Enter drops it instead.)
          if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onToggle(); return; }
          listeners?.onKeyDown?.(e);
        }}
      >
        <span className="dm-time">{isNow ? "NOW" : formatClock24(start)}</span>
        <span className="dm-title">
          <LinkifyText text={task.title} />
          {isGoal && <span className="task-tag is-goal">GOAL</span>}
        </span>
        <span className="dm-dur">{formatSpan(duration)}</span>
      </div>
      {isNow && (
        <button type="button" className="dm-start" onClick={onStartFocus} onPointerDown={e => e.stopPropagation()}>
          Start focus
        </button>
      )}

      {isExpanded && (
        <div className="dm-panel" onPointerDown={e => e.stopPropagation()}>
          {task.concreteStep && <p className="dm-step"><LinkifyText text={task.concreteStep} /></p>}
          {subSteps.length > 0 && (
            <ul className="dm-substeps">
              {orderedSubSteps.map(step => (
                <li
                  key={step.id}
                  className={`dm-substep${step.done ? " is-done" : ""}`}
                  aria-label={`${step.done ? "Completed" : "Not completed"}: ${step.text}`}
                >
                  <span className="dm-substep-check" aria-hidden="true" />
                  <span className="dm-substep-text">{step.text}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="dm-panel-row">
            <label className="dm-field">
              Duration
              <select value={duration} onChange={e => onDurationChange(taskId, Number(e.target.value))}>
                {DURATION_OPTIONS.map(m => <option key={m} value={m}>{formatSpan(m)}</option>)}
              </select>
            </label>
            <button type="button" className="dm-remove" onClick={() => onRemove(taskId)}>
              <IconX size={16} /> Remove from route
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// An Unscheduled task (52e): its title, how long, and a 40px "+" that adds it
// to the end of the route. On a laptop it can also be dragged into the route.
function PoolRow({ task, onAdd, draggable = false }) {
  const taskId = getTaskId(task);
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `pool:${taskId}`, disabled: !draggable });
  return (
    <li ref={setNodeRef} className={`dm-pool-row${isDragging ? " is-dragging" : ""}`} {...(draggable ? listeners : {})}>
      <span className="dm-pool-title">{task.title}</span>
      <span className="dm-dur">{formatSpan(getEstimate(task))}</span>
      <button
        type="button"
        className="dm-pool-add"
        aria-label={`Add to route: ${task.title}`}
        onClick={() => onAdd(taskId)}
        onPointerDown={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        // Its own keys (Space, Enter) press it; they never start the row's drag.
        onKeyDown={e => { if (e.key === " " || e.key === "Enter") e.stopPropagation(); }}
      >
        <IconPlus size={18} />
      </button>
    </li>
  );
}

// The end of the route takes a dropped task, even when the route is empty.
function RouteDrop({ children }) {
  const { setNodeRef, isOver } = useDroppable({ id: "route-end" });
  return <div ref={setNodeRef} className={`dm-route-wrap${isOver ? " is-drop" : ""}`}>{children}</div>;
}

function StartControl({ anchorMinutes, onChangeAnchor, windows }) {
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const [actualNow, setActualNow] = useState(() => currentDayMinutes(windows));
  useEffect(() => {
    const id = setInterval(() => setActualNow(currentDayMinutes(windowsRef.current)), 30_000);
    return () => clearInterval(id);
  }, []);

  // Start times run to the end of the day: midnight, or later when the last
  // window runs past it.
  const dayEnd = Math.max(1440, ...mergeWindowSpans(windows).map(([, end]) => end));
  const options = [actualNow];
  for (let m = Math.ceil(actualNow / 15) * 15; m <= actualNow + 600 && m < dayEnd; m += 15) {
    if (m !== actualNow) options.push(m);
  }
  if (!options.includes(anchorMinutes) && anchorMinutes > actualNow) {
    options.push(anchorMinutes);
    options.sort((a, b) => a - b);
  }

  return (
    <label className="dm-from">
      <span className="dm-from-label">From</span>
      <select
        className="dm-from-select"
        value={anchorMinutes}
        onChange={e => onChangeAnchor(Number(e.target.value))}
        aria-label="Route start time"
      >
        {options.map(m => (
          <option key={m} value={m}>{formatClock24(m)}{m === actualNow ? " (now)" : ""}</option>
        ))}
      </select>
    </label>
  );
}

export default function DayMapPage({ payload, savePayload, savePayloadAsync, onClose, onStartFocus, onAddTask, onHelpChoose, dayClock, flushNow = () => {}, backLabel = "Today" }) {
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  // One Undo toast: { message, before, at } — before is what to put back.
  const [undo, setUndo] = useState(null);
  // Phone (52d): Unscheduled is a bar that opens this sheet.
  const [poolOpen, setPoolOpen] = useState(false);
  const [dragTitle, setDragTitle] = useState(null);
  // The phone's bar and action sit right on the nav, whatever its height.
  const [navHeight, setNavHeight] = useState(0);
  useEffect(() => {
    const nav = document.querySelector(".tab-bar");
    if (!nav || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setNavHeight(nav.getBoundingClientRect().height));
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  const {
    tasks, windows, todayStr, tomorrowStr, payloadRef,
    activeTodayTasks, scheduledTasks, tomorrowTasks, unscheduledTasks,
    anchorMinutes, plan, isGoal, sortableIds, latestTasks, applyAndSave,
  } = useDayRoute({ payload, savePayload });

  // A drag ends in a click on the row it dropped; that click must not open it.
  const draggingRef = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    // One stop per ↑/↓; Space picks up and drops, Enter drops (it opens a
    // stop when nothing is held).
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    })
  );

  const setAnchor = (minutes) => {
    applyAndSave(scheduledTasks, minutes, { dayMapDate: todayStr, dayMapAnchorMinutes: minutes });
  };

  const addToRoute = (taskId) => {
    const task = latestTasks().find(t => getTaskId(t) === taskId);
    if (!task) return;
    applyAndSave([...scheduledTasks, task], anchorMinutes);
  };

  const removeFromRoute = (taskId) => {
    const reflowed = reflowRoute(scheduledTasks.filter(t => getTaskId(t) !== taskId), anchorMinutes, todayStr);
    const p = payloadRef.current;
    const nextTasks = latestTasks().map(t => {
      if (getTaskId(t) === taskId) return removeScheduleFields(t);
      return reflowed.find(r => getTaskId(r) === getTaskId(t)) || t;
    });
    savePayload({ ...p, tasks: nextTasks, timestamp: Date.now() });
    if (expandedTaskId === taskId) setExpandedTaskId(null);
  };

  // The duration edit also updates timeEstimateMinutes, so Today and Focus
  // (which read that field) pick up the same value.
  const changeDuration = (taskId, duration) => {
    applyAndSave(scheduledTasks.map(t =>
      getTaskId(t) === taskId ? { ...t, dayMapDurationMinutes: duration, timeEstimateMinutes: duration } : t
    ), anchorMinutes);
  };

  // 52d: Auto-fill fills from Today's list order — what moved from
  // yesterday first, then the list as it stands.
  const autoFill = () => {
    if (!unscheduledTasks.length) return;
    const fromYesterday = (t) => t.deferredUntil === todayStr;
    const inListOrder = [...unscheduledTasks].sort((a, b) => (fromYesterday(b) - fromYesterday(a)) || ((a.orderIndex ?? 0) - (b.orderIndex ?? 0)));
    applyAndSave([...scheduledTasks, ...inListOrder], anchorMinutes);
  };

  // 52: Clear route has Undo, no confirm.
  const clearRoute = () => {
    const p = payloadRef.current;
    const before = latestTasks().filter(t => t.dayMapDate === todayStr);
    if (!before.length) return;
    savePayload({
      ...p,
      tasks: latestTasks().map(t => t.dayMapDate === todayStr ? removeScheduleFields(t) : t),
      timestamp: Date.now(),
    });
    setExpandedTaskId(null);
    setUndo({ kind: "clear", message: "Route cleared", before, at: Date.now() });
  };

  // The pinned task is what you are doing now, and may have a focus session
  // open that only Today can close properly — so it is never moved from here.
  const movable = plan.wontFit.filter(t => !t.isNowFocus);
  const moveOverToTomorrow = () => {
    const ids = movable.map(getTaskId);
    if (!ids.length) return;
    const { tasks: nextTasks, before } = moveToTomorrow(latestTasks(), ids, tomorrowStr);
    savePayload({ ...payloadRef.current, tasks: nextTasks, timestamp: Date.now() });
    setExpandedTaskId(null);
    setUndo({ message: `${ids.length} ${ids.length === 1 ? "task" : "tasks"} moved to tomorrow`, before, at: Date.now() });
  };

  // Undo puts the tasks back, then times the whole route again: the route may
  // have changed since (a task added after Clear route, say), and restored
  // stops must not share an order or a start time with it.
  const handleUndo = () => {
    if (!undo) return;
    const restored = restoreSchedule(latestTasks(), undo.before);
    const put = new Set(undo.before.map(getTaskId));
    const onRoute = restored.filter(t => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted && !t.isParked
      && t.dayMapDate === todayStr && !isDeferred(t, todayStr) && (t.dayMapOrder != null || !!t.dayMapPeriod));
    const byOrder = (a, b) => ((a.dayMapOrder ?? Infinity) - (b.dayMapOrder ?? Infinity))
      || (put.has(getTaskId(b)) - put.has(getTaskId(a)))
      || ((a.dayMapStartMinutes ?? 0) - (b.dayMapStartMinutes ?? 0));
    // After Clear route, what was added since goes after what comes back.
    const route = undo.kind === "clear"
      ? [...onRoute.filter(t => put.has(getTaskId(t))).sort(byOrder), ...onRoute.filter(t => !put.has(getTaskId(t))).sort(byOrder)]
      : [...onRoute].sort(byOrder);
    savePayload({ ...payloadRef.current, tasks: applyReflow(restored, reflowRoute(route, anchorMinutes, todayStr)), timestamp: Date.now() });
    setUndo(null);
  };

  const startFocus = (taskId) => {
    const now = Date.now();
    const p = payloadRef.current;
    const nextTasks = latestTasks().map(t => {
      const shouldFocus = getTaskId(t) === taskId;
      if (t.isNowFocus === shouldFocus) return t;
      return { ...t, isNowFocus: shouldFocus, lastUpdated: now };
    });
    // Navigation stays immediate; the pin's confirmed-write promise goes to
    // onStartFocus so the activity ledger waits for the pin to reach RTDB.
    const pinPromise = typeof savePayloadAsync === "function"
      ? savePayloadAsync({ ...p, tasks: nextTasks, timestamp: Date.now() })
      : (savePayload({ ...p, tasks: nextTasks, timestamp: Date.now() }), Promise.resolve());
    flushNow();
    onStartFocus ? onStartFocus(pinPromise) : onClose();
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    // From Unscheduled (52e): in before the stop it was dropped on, or at the end.
    if (String(active.id).startsWith("pool:")) {
      const task = latestTasks().find(t => getTaskId(t) === String(active.id).slice(5));
      if (!task) return;
      const at = scheduledTasks.findIndex(t => getTaskId(t) === over.id);
      const next = [...scheduledTasks];
      next.splice(at === -1 ? next.length : at, 0, task);
      applyAndSave(next, anchorMinutes);
      return;
    }
    const oldIndex = scheduledTasks.findIndex(t => getTaskId(t) === active.id);
    const newIndex = scheduledTasks.findIndex(t => getTaskId(t) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    applyAndSave(arrayMove([...scheduledTasks], oldIndex, newIndex), anchorMinutes);
  };

  const n = plan.wontFit.length;
  const isOver = n > 0;
  const dayEndLabel = formatClock24(plan.dayEnd);
  const nowMins = currentDayMinutes(windows);

  // The route (50f): the stops, the DAY ENDS line where it falls, then what
  // won't fit today.
  const fitting = isOver ? scheduledTasks.slice(0, plan.overIndex) : scheduledTasks;
  const lastFitting = fitting[fitting.length - 1];
  const free = lastFitting ? plan.dayEnd - (Number(lastFitting.dayMapStartMinutes) + getEstimate(lastFitting)) : 0;
  const wontFitMinutes = plan.wontFit.reduce((sum, t) => sum + getEstimate(t), 0);
  const dayEndText = `DAY ENDS ${dayEndLabel}`
    + (free > 0 ? ` · ${formatSpan(free)} FREE` : "")
    + (plan.runsPast ? ` · ${formatClock24(plan.runsPast.task.dayMapStartMinutes)} RUNS ${formatSpan(plan.runsPast.by)} PAST` : "");
  const renderStop = (task, index) => {
    const id = getTaskId(task);
    const start = Number(task.dayMapStartMinutes ?? 0);
    return (
      <RouteStop
        key={id}
        task={task}
        isNow={index === 0 && start <= nowMins + 15}
        isOver={plan.overIndex !== -1 && index >= plan.overIndex}
        isGoal={isGoal(task)}
        isExpanded={expandedTaskId === id}
        onToggle={() => { if (!draggingRef.current) setExpandedTaskId(expandedTaskId === id ? null : id); }}
        onRemove={removeFromRoute}
        onDurationChange={changeDuration}
        onStartFocus={() => startFocus(id)}
      />
    );
  };
  const poolRows = (
    <ul className="dm-pool-list">
      {unscheduledTasks.map(t => <PoolRow key={getTaskId(t)} task={t} onAdd={addToRoute} draggable />)}
    </ul>
  );

  // The day clock (50e–f): how much of the day has passed, and where it ends.
  const progress = dayProgress(new Date(), windows);
  const close = () => { flushNow(); onClose(); };
  // The phone's sheet closes back to its bar.
  const closePool = () => {
    setPoolOpen(false);
    requestAnimationFrame(() => document.querySelector(".dm-pool-bar")?.focus());
  };
  // Its last task added, the sheet has nothing left: it closes, and focus
  // goes to the first stop (the bar is disabled with nothing to add).
  useEffect(() => {
    if (!poolOpen || unscheduledTasks.length > 0) return;
    setPoolOpen(false);
    requestAnimationFrame(() => document.querySelector(".dm-route .dm-main")?.focus());
  }, [poolOpen, unscheduledTasks.length]);
  // The sheet is the phone's and tablet's: crossing into the laptop layout
  // (a tablet turned, a window widened) closes it rather than hiding it.
  useEffect(() => {
    if (!poolOpen) return undefined;
    const close = () => {
      if (window.innerWidth < 1024) return;
      // Focus in the sheet goes to what takes its place: the card's first +.
      // (The laptop's CSS hides the sheet first, and a hidden element loses
      // focus to the page, so focus on the page counts as the sheet's.)
      const el = document.activeElement;
      const hadFocus = !el || el === document.body || !!el.closest(".dm-pool-sheet");
      setPoolOpen(false);
      if (hadFocus) requestAnimationFrame(() => (document.querySelector(".dm-pool .dm-pool-add") || document.querySelector(".dm-route .dm-main"))?.focus());
    };
    close();
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [poolOpen]);
  const poolOpenRef = useRef(poolOpen);
  poolOpenRef.current = poolOpen;
  // "+" in the sheet takes its row away; focus goes to the next row's "+".
  const addFromSheet = (taskId) => {
    const buttons = [...document.querySelectorAll(".dm-pool-sheet .dm-pool-add")];
    const i = buttons.findIndex(b => b === document.activeElement);
    addToRoute(taskId);
    requestAnimationFrame(() => {
      const left = [...document.querySelectorAll(".dm-pool-sheet .dm-pool-add")];
      (left[Math.min(Math.max(i, 0), left.length - 1)] || document.querySelector(".dm-pool-sheet .dm-sheet-close"))?.focus();
    });
  };
  // Esc goes back (50e–f), unless a dialog or a field is taking it.
  const closeRef = useRef(close);
  closeRef.current = close;
  const closePoolRef = useRef(closePool);
  closePoolRef.current = closePool;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (poolOpenRef.current) { closePoolRef.current(); return; }
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const undoText = undo ? undo.message : "";

  return (
    <div className="day-map-page">
      {/* 50e–f: Back (Esc), the title, and a day clock — time left, when the
          day ends, how much of it has passed. */}
      <div className="dm-head">
        <button type="button" className="dm-back" onClick={close} aria-label={`Back to ${backLabel}`}>
          <IconChevronLeft size={22} />
          <span className="dm-back-label">{backLabel}</span>
          <kbd className="wall-key dm-back-key" aria-hidden="true">Esc</kbd>
        </button>
        <h1 className="dm-heading">Day map</h1>
        {dayClock && <span className="dm-date">{dayClock.date}</span>}
        {progress && (
          <div className="dm-dayclock">
            <div className="dm-dayclock-top">
              <span className="dm-dayclock-left">{dayClock?.left ? `${dayClock.left} left` : "The day is over"}</span>
              <span className="dm-dayclock-ends"> · ends {formatClock24(progress.end)}</span>
              {scheduledTasks.length > 0 && (
                <span className={`dm-dayclock-plan${plan.overBy > 0 ? " is-over" : ""}`}>
                  {formatSpan(plan.planned)} planned{plan.overBy > 0 ? ` · ${formatSpan(plan.overBy)} over` : ""}
                </span>
              )}
              {dayClock && <span className="dm-dayclock-date" aria-hidden="true">{dayClock.date}</span>}
            </div>
            <DayClockBar progress={progress} />
          </div>
        )}
      </div>

      {activeTodayTasks.length === tomorrowTasks.length ? (
        <section className="dm-empty">
          {tomorrowTasks.length > 0 ? (
            <>
              <h2>Nothing left for today</h2>
              <p>{tomorrowTasks.length} {tomorrowTasks.length === 1 ? "task starts" : "tasks start"} tomorrow. Add one for today if there's room.</p>
            </>
          ) : (
            <>
              <h2>Nothing on Today yet</h2>
              <p>Add a task to Today, then lay it out on the day.</p>
            </>
          )}
          <button type="button" className="dm-btn-filled" onClick={onAddTask}>Add a Today task</button>
        </section>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={({ active }) => {
            draggingRef.current = true;
            const id = String(active.id);
            if (id.startsWith("pool:")) setDragTitle(unscheduledTasks.find(t => getTaskId(t) === id.slice(5))?.title || null);
          }}
          onDragEnd={(e) => { setTimeout(() => { draggingRef.current = false; }, 0); setDragTitle(null); handleDragEnd(e); }}
          onDragCancel={() => { setTimeout(() => { draggingRef.current = false; }, 0); setDragTitle(null); }}
        >
          <div className="dm-layout">
            {/* 52d–e: From · Auto-fill · Clear route, as text, above the route. */}
            <div className="dm-controls">
              <StartControl anchorMinutes={anchorMinutes} onChangeAnchor={setAnchor} windows={windows} />
              <button type="button" className="dm-text-btn" onClick={autoFill} disabled={!unscheduledTasks.length}>Auto-fill</button>
              <button type="button" className="dm-text-btn" onClick={clearRoute} disabled={!scheduledTasks.length}>Clear route</button>
            </div>

            <RouteDrop>
              {scheduledTasks.length === 0 ? (
                <p className="dm-route-empty">Nothing on the route yet. Add a task from Unscheduled, or use Auto-fill.</p>
              ) : (
                <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                  <ol className="dm-route" aria-label="Today's route">
                    {fitting.map((t, i) => renderStop(t, i))}
                    <li className="dm-dayend" aria-label={`Day ends at ${dayEndLabel}`}>
                      <span className="dm-dayend-label">{dayEndText}</span>
                    </li>
                    {isOver && (
                      <li className="dm-wontfit">WON’T FIT TODAY · {formatSpan(wontFitMinutes)}</li>
                    )}
                    {plan.wontFit.map((t, i) => renderStop(t, plan.overIndex + i))}
                  </ol>
                </SortableContext>
              )}
              {tomorrowTasks.length > 0 && (
                <p className="dm-tomorrow-note">{tomorrowTasks.length} {tomorrowTasks.length === 1 ? "task now starts" : "tasks now start"} tomorrow.</p>
              )}
              {(isOver || plan.overBy > 0) && onHelpChoose && (
                <button type="button" className="dm-text-btn is-alert dm-help" onClick={onHelpChoose}>Help me choose</button>
              )}
            </RouteDrop>

            {/* The action, then the pool: a card on a laptop (52e); on a
                phone a bar above the action that opens a sheet (52d). */}
            <div className="dm-side" style={navHeight ? { "--dm-nav-h": `${navHeight}px` } : undefined}>
              {movable.length > 0 && (
                <button type="button" className="dm-move" onClick={moveOverToTomorrow}>Move {movable.length} to tomorrow</button>
              )}
              <section className="dm-pool" aria-labelledby="dm-pool-title">
                <div className="dm-pool-head">
                  <h2 className="dm-pool-name" id="dm-pool-title">Unscheduled <span className="dm-pool-count">{unscheduledTasks.length}</span></h2>
                  {unscheduledTasks.length > 0 && <span className="dm-pool-hint" aria-hidden="true">+ OR DRAG IN</span>}
                </div>
                {unscheduledTasks.length > 0
                  ? poolRows
                  : <p className="dm-pool-empty">All of today’s tasks are on the route.</p>}
              </section>
              <button
                type="button"
                className="dm-pool-bar"
                aria-haspopup="dialog"
                aria-expanded={poolOpen}
                onClick={() => setPoolOpen(true)}
                disabled={!unscheduledTasks.length}
              >
                <span className="dm-pool-name">Unscheduled <span className="dm-pool-count">{unscheduledTasks.length}</span></span>
                {unscheduledTasks.length > 0 && <span className="dm-pool-bar-add">Add to route</span>}
              </button>
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {dragTitle ? <div className="dm-drag-ghost">{dragTitle}</div> : null}
          </DragOverlay>
        </DndContext>
      )}

      {poolOpen && (
        <>
          <div className="dm-sheet-scrim" onClick={closePool} aria-hidden="true" />
          <div
            className="dm-pool-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Unscheduled"
            onKeyDown={e => {
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePool(); return; }
              // Modal: Tab and Shift+Tab stay among the sheet's buttons.
              if (e.key !== "Tab") return;
              const items = [...e.currentTarget.querySelectorAll("button:enabled")];
              if (!items.length) return;
              const i = items.indexOf(document.activeElement);
              const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
              e.preventDefault();
              items[next].focus();
            }}
          >
            <div className="dm-pool-head">
              <h2 className="dm-pool-name">Unscheduled <span className="dm-pool-count">{unscheduledTasks.length}</span></h2>
              <button type="button" className="dm-sheet-close" onClick={closePool} aria-label="Close" autoFocus>
                <IconX size={20} />
              </button>
            </div>
            <ul className="dm-pool-list">
              {unscheduledTasks.map(t => <PoolRow key={getTaskId(t)} task={t} onAdd={addFromSheet} />)}
            </ul>
          </div>
        </>
      )}

      <UndoAnnouncer message={undoText} />
      {undo && <UndoToast key={undo.at} message={undoText} onUndo={handleUndo} onClose={() => setUndo(null)} />}
    </div>
  );
}
