import React, { useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dayProgress, formatClock24, formatSpan, moveToTomorrow, restoreSchedule } from "../utils/dayMapPlan";
import { mergeWindowSpans } from "../utils/focusWindows";
import {
  DURATION_OPTIONS, PERIOD_LABELS, currentDayMinutes, getEstimate, getPeriodForMinutes, getTaskId,
  normalizePriority, reflowRoute, removeScheduleFields, sortByPriorityAndOrder, useDayRoute,
} from "../hooks/useDayRoute";
import DayClockBar from "./DayClockBar";
import LinkifyText from "./LinkifyText";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import { IconChevronLeft, IconEllipsisVertical, IconX } from "./ui/icons";
import "../styles/dayMap.css";

// Day map (Addendum Y5; 33a laptop, 33d tablet, 34c phone, 37d after a move).
// Today's tasks laid end to end from a start time on a rail. The day ends
// when the focus time left runs out: a red DAY ENDS line, and every stop that
// starts after it is dimmed on a dashed rail. "Move N to tomorrow" puts those
// at the top of tomorrow's route (nothing is deleted), with Undo.

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
  const doneSubStepsCount = subSteps.filter(s => s.done).length;
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
      <span className="dm-time">{isNow ? "NOW" : formatClock24(start)}</span>
      <span className="dm-rail" aria-hidden="true"><span className="dm-node" /></span>
      <div className="dm-body">
        <div className="dm-row">
          <div
            ref={setActivatorNodeRef}
            className="dm-main"
            aria-label={label}
            tabIndex={attributes.tabIndex}
            role={attributes.role}
            aria-roledescription={attributes["aria-roledescription"]}
            aria-describedby={attributes["aria-describedby"]}
            onClick={onToggle}
            {...listeners}
          >
            <span className="dm-title-col">
              <span className="dm-title"><LinkifyText text={task.title} /></span>
              {task.concreteStep && <span className="dm-step"><LinkifyText text={task.concreteStep} /></span>}
              {subSteps.length > 0 && <span className="dm-steps-count">{doneSubStepsCount}/{subSteps.length} steps done</span>}
            </span>
            <span className="dm-meta">
              {isGoal && <span className="task-tag is-goal">GOAL</span>}
              <span className="dm-p">{p}</span>
              <span className="dm-dur">{formatSpan(duration)}</span>
            </span>
          </div>
          <button
            type="button"
            className="dm-options"
            onClick={onToggle}
            onPointerDown={e => e.stopPropagation()}
            aria-expanded={isExpanded}
            aria-label={`Options: ${task.title}`}
          >
            <IconEllipsisVertical size={18} />
          </button>
        </div>

        {isNow && (
          <button type="button" className="dm-start" onClick={onStartFocus} onPointerDown={e => e.stopPropagation()}>
            Start focus
          </button>
        )}

        {isExpanded && (
          <div className="dm-panel" onPointerDown={e => e.stopPropagation()}>
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
      </div>
    </li>
  );
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
  const [undo, setUndo] = useState(null);

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
    useSensor(KeyboardSensor)
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

  const autoFill = () => {
    if (!unscheduledTasks.length) return;
    applyAndSave([...scheduledTasks, ...[...unscheduledTasks].sort(sortByPriorityAndOrder)], anchorMinutes);
  };

  const clearRoute = () => {
    const p = payloadRef.current;
    savePayload({
      ...p,
      tasks: latestTasks().map(t => t.dayMapDate === todayStr ? removeScheduleFields(t) : t),
      timestamp: Date.now(),
    });
    setExpandedTaskId(null);
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
    setUndo({ before, count: ids.length, at: Date.now() });
  };

  const handleUndo = () => {
    if (!undo) return;
    savePayload({ ...payloadRef.current, tasks: restoreSchedule(latestTasks(), undo.before), timestamp: Date.now() });
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
    const oldIndex = scheduledTasks.findIndex(t => getTaskId(t) === active.id);
    const newIndex = scheduledTasks.findIndex(t => getTaskId(t) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    applyAndSave(arrayMove([...scheduledTasks], oldIndex, newIndex), anchorMinutes);
  };

  const n = plan.wontFit.length;
  const isOver = n > 0;
  const dayEndLabel = formatClock24(plan.dayEnd);
  const nowMins = currentDayMinutes(windows);

  // The rail: period labels, the stops, and the DAY ENDS line where it falls.
  const routeItems = [];
  let lastPeriod = null;
  scheduledTasks.forEach((task, index) => {
    if (index === plan.overIndex) routeItems.push({ type: "dayend", id: "dayend" });
    const period = getPeriodForMinutes(Number(task.dayMapStartMinutes ?? 0));
    if (period !== lastPeriod) {
      routeItems.push({ type: "period", id: `period-${period}-${index}`, label: PERIOD_LABELS[period], over: plan.overIndex !== -1 && index >= plan.overIndex });
      lastPeriod = period;
    }
    routeItems.push({ type: "task", id: getTaskId(task), task, index });
  });

  // The day clock (50e–f): how much of the day has passed, and where it ends.
  const progress = dayProgress(new Date(), windows);
  const close = () => { flushNow(); onClose(); };
  // Esc goes back (50e–f), unless a dialog or a field is taking it.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const undoText = undo ? `${undo.count} ${undo.count === 1 ? "task" : "tasks"} moved to tomorrow` : "";

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
        <div className="dm-layout">
          <div className="dm-controls">
            <StartControl anchorMinutes={anchorMinutes} onChangeAnchor={setAnchor} windows={windows} />
            <button type="button" className="dm-btn-outline" onClick={autoFill} disabled={!unscheduledTasks.length}>Auto-fill</button>
            <button type="button" className="dm-link" onClick={clearRoute} disabled={!scheduledTasks.length}>Clear route</button>
          </div>

          {scheduledTasks.length > 0 && (
            isOver ? (
              <section className="dm-status is-over" aria-label="Day plan">
                <p className="dm-status-line">
                  <span>{formatSpan(plan.planned)} planned in {formatSpan(plan.dayLeft)}</span>
                  <span className="dm-status-over">+{formatSpan(plan.overBy)}</span>
                </p>
                <p className="dm-status-detail">
                  <strong>
                    {n} {n === 1 ? "task won't" : "tasks won't"} fit before {dayEndLabel}.
                    {plan.runsPast && <> The {formatClock24(plan.runsPast.task.dayMapStartMinutes)} task runs {formatSpan(plan.runsPast.by)} past.</>}
                  </strong>
                  <span>Nothing is deleted. Moved tasks go to the top of tomorrow.</span>
                </p>
                <div className="dm-status-actions">
                  <button type="button" className="dm-btn-alert" onClick={moveOverToTomorrow} disabled={!movable.length}>Move {movable.length} to tomorrow</button>
                  {onHelpChoose && <button type="button" className="dm-link is-alert" onClick={onHelpChoose}>Help me choose</button>}
                </div>
              </section>
            ) : plan.overBy > 0 ? (
              // Everything starts in time, but the last stop runs past the end.
              <section className="dm-status is-over" aria-label="Day plan">
                <p className="dm-status-line">
                  <span>{formatSpan(plan.planned)} planned in {formatSpan(plan.dayLeft)}</span>
                  <span className="dm-status-over">+{formatSpan(plan.overBy)}</span>
                </p>
                <p className="dm-status-note">
                  The {formatClock24(plan.runsPast.task.dayMapStartMinutes)} task runs {formatSpan(plan.runsPast.by)} past {dayEndLabel}.
                </p>
                {onHelpChoose && (
                  <div className="dm-status-actions">
                    <button type="button" className="dm-link is-alert" onClick={onHelpChoose}>Help me choose</button>
                  </div>
                )}
              </section>
            ) : (
              <section className="dm-status" aria-label="Day plan">
                <p className="dm-status-line">
                  <span>Route fits the day</span>
                  <span className="dm-status-figures">{formatSpan(plan.planned)} / {formatSpan(plan.dayLeft)}</span>
                </p>
              </section>
            )
          )}

          <div className="dm-route-wrap">
            {scheduledTasks.length === 0 ? (
              <p className="dm-route-empty">Nothing on the route yet. Add a task below, or use Auto-fill.</p>
            ) : (
              <DndContext
                sensors={sensors}
                onDragStart={() => { draggingRef.current = true; }}
                onDragEnd={(e) => { setTimeout(() => { draggingRef.current = false; }, 0); handleDragEnd(e); }}
                onDragCancel={() => { setTimeout(() => { draggingRef.current = false; }, 0); }}
              >
                <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                  <ol className="dm-route" aria-label="Today's route">
                    {routeItems.map(item => {
                      if (item.type === "period") {
                        return <li key={item.id} className={`dm-period${item.over ? " is-over" : ""}`}><span>{item.label}</span></li>;
                      }
                      if (item.type === "dayend") {
                        return (
                          <li key={item.id} className="dm-dayend">
                            <span className="dm-time">{dayEndLabel}</span>
                            <span className="dm-rail" aria-hidden="true"><span className="dm-node" /></span>
                            <span className="dm-dayend-label">Day ends · {n} won't fit</span>
                          </li>
                        );
                      }
                      const start = Number(item.task.dayMapStartMinutes ?? 0);
                      return (
                        <RouteStop
                          key={item.id}
                          task={item.task}
                          isNow={item.index === 0 && start <= nowMins + 15}
                          isOver={plan.overIndex !== -1 && item.index >= plan.overIndex}
                          isGoal={isGoal(item.task)}
                          isExpanded={expandedTaskId === item.id}
                          onToggle={() => { if (!draggingRef.current) setExpandedTaskId(expandedTaskId === item.id ? null : item.id); }}
                          onRemove={removeFromRoute}
                          onDurationChange={changeDuration}
                          onStartFocus={() => startFocus(item.id)}
                        />
                      );
                    })}
                    {!isOver && (
                      <li className="dm-end">
                        <span className="dm-time">{dayEndLabel}</span>
                        <span className="dm-end-label">
                          Day ends.{tomorrowTasks.length > 0 && ` ${tomorrowTasks.length} ${tomorrowTasks.length === 1 ? "task now starts" : "tasks now start"} tomorrow.`}
                        </span>
                      </li>
                    )}
                  </ol>
                </SortableContext>
              </DndContext>
            )}
          </div>

          <section className="dm-unscheduled" aria-label="Unscheduled">
            <h2 className="dm-unscheduled-head">
              Unscheduled · {unscheduledTasks.length}
              {unscheduledTasks.length === 0 && <span> — all tasks are on the route.</span>}
            </h2>
            {unscheduledTasks.length > 0 && (
              <ul className="dm-unscheduled-list">
                {unscheduledTasks.map(t => (
                  <li key={getTaskId(t)}>
                    <button type="button" className="dm-add" onClick={() => addToRoute(getTaskId(t))} aria-label={`Add to route: ${t.title}`}>
                      <span className="dm-p">{normalizePriority(t.priority)}</span>
                      <span className="dm-add-title">{t.title}</span>
                      <span className="dm-dur">{formatSpan(getEstimate(t))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <UndoAnnouncer message={undoText} />
      {undo && <UndoToast key={undo.at} message={undoText} onUndo={handleUndo} onClose={() => setUndo(null)} />}
    </div>
  );
}
