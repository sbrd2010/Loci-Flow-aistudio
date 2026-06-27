import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { shouldReflowPastRoute } from "../utils/dayMapRoute";
import { useTodayStr } from "../hooks/useTodayStr";
import LinkifyText from "./LinkifyText";
import "../styles/dayMap.css";
import "../styles/dayMapPlanning.css";
import "../styles/dayMapTimeline.css";

const TRANSITION_BUFFER = 5;
const DURATION_OPTIONS = [15, 25, 45, 60, 90, 120, 180, 240, 360];
const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
const PRIORITY_LINE_COLORS = { P1: '#f43f5e', P2: '#f59e0b', P3: '#14b8a6', P4: 'rgba(255,255,255,0.20)' };
const PERIOD_LABELS = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

function getTaskId(task) { return String(task.uuid || task.id); }
function normalizePriority(p) { return String(p || "P3").toUpperCase(); }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function roundToQuarter(m) { return Math.ceil(m / 15) * 15; }

function currentDayMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function getPeriodForMinutes(m) {
  const n = ((m % 1440) + 1440) % 1440;
  if (n < 720) return "morning";
  if (n < 1020) return "afternoon";
  if (n < 1260) return "evening";
  return "night";
}

function getEstimate(task) {
  const raw = Number(task.dayMapDurationMinutes || task.timeEstimateMinutes || task.estimateMinutes || 25);
  return clamp(Number.isFinite(raw) ? raw : 25, 10, 360);
}

function formatClock(minutes) {
  const n = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(n / 60);
  const min = n % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

function formatDuration(m) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function formatClockHM(minutes) {
  const n = ((minutes % 1440) + 1440) % 1440;
  const h12 = Math.floor(n / 60) % 12 || 12;
  const min = n % 60;
  return `${h12}:${String(min).padStart(2, "0")}`;
}

function formatClockAMPM(minutes) {
  const n = ((minutes % 1440) + 1440) % 1440;
  return Math.floor(n / 60) >= 12 ? "PM" : "AM";
}

function sortByPriorityAndOrder(a, b) {
  const pa = PRIORITY_RANK[normalizePriority(a.priority)] || 3;
  const pb = PRIORITY_RANK[normalizePriority(b.priority)] || 3;
  return pa !== pb ? pa - pb : (a.orderIndex ?? 9999) - (b.orderIndex ?? 9999);
}

function removeScheduleFields(task) {
  const { dayMapDate, dayMapPeriod, dayMapStartMinutes, dayMapDurationMinutes, dayMapOrder, ...rest } = task;
  return { ...rest, lastUpdated: Date.now() };
}

// Single-pass reflow: assign sequential start times from anchor through the ordered queue.
// Period is derived from calculated start time — never stored independently.
function reflowRoute(orderedTasks, anchorMinutes, todayStr) {
  let cursor = roundToQuarter(anchorMinutes);
  return orderedTasks.map((task, index) => {
    const duration = getEstimate(task);
    const start = cursor;
    cursor = start + duration + TRANSITION_BUFFER;
    return {
      ...task,
      dayMapStartMinutes: start,
      dayMapDurationMinutes: duration,
      dayMapPeriod: getPeriodForMinutes(start),
      dayMapOrder: index,
      dayMapDate: todayStr,
      lastUpdated: Date.now(),
    };
  });
}

function applyReflow(allTasks, reflowed) {
  const map = new Map(reflowed.map(t => [getTaskId(t), t]));
  return allTasks.map(t => map.has(getTaskId(t)) ? map.get(getTaskId(t)) : t);
}

function PriorityBadge({ priority }) {
  const p = normalizePriority(priority);
  return <span className={`day-map-priority ${p.toLowerCase()}`}>{p}</span>;
}

function SummaryCard({ placed, total, totalDuration, anchorMinutes }) {
  const nowMins = currentDayMinutes();
  const isOnTrack = placed > 0 && anchorMinutes <= nowMins + 45;
  const statusText = placed === 0 ? "Plan ahead" : isOnTrack ? "On Track" : "Not started";

  return (
    <div className="dm-summary-card">
      <div className="dm-summary-stat">
        <div className="dm-summary-key">Tasks</div>
        <div className="dm-summary-primary">{placed} / {total}</div>
        <div className="dm-summary-unit">placed</div>
      </div>
      <div className="dm-summary-sep" />
      <div className="dm-summary-stat">
        <div className="dm-summary-key">Planned</div>
        <div className="dm-summary-primary">{totalDuration > 0 ? formatDuration(totalDuration) : "—"}</div>
        <div className="dm-summary-unit">focus time</div>
      </div>
      <div className="dm-summary-sep" />
      <div className="dm-summary-stat">
        <div className="dm-summary-key">Status</div>
        <div className={`dm-summary-primary${placed > 0 && isOnTrack ? " dm-status-good" : " dm-status-neutral"}`}>{statusText}</div>
        {placed > 0 && isOnTrack && <div className="dm-summary-unit"><span className="dm-status-dot" />live</div>}
      </div>
    </div>
  );
}

function TimelineStop({ task, isFirst, isExpanded, onToggle, onRemove, onDurationChange, onStartFocus }) {
  const taskId = getTaskId(task);
  const {
    attributes, listeners, setActivatorNodeRef,
    setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: taskId, data: { taskId } });

  const duration = getEstimate(task);
  const start = Number(task.dayMapStartMinutes ?? 0);
  const p = normalizePriority(task.priority);
  const pClass = p.toLowerCase();
  const isNow = isFirst && start <= currentDayMinutes() + 15;
  const lineColor = PRIORITY_LINE_COLORS[p] || PRIORITY_LINE_COLORS.P4;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="dm-stop">
      <div className="dm-stop-time">
        <span className="dm-time-hm">{formatClockHM(start)}</span>
        <span className="dm-time-ampm">{formatClockAMPM(start)}</span>
      </div>

      <div className="dm-stop-spine">
        <div className="dm-tl-segment" style={{ background: lineColor }} aria-hidden="true" />
        {isNow && <div className="dm-now-badge-route">▶ NOW</div>}
        {isNow && <div className="dm-node-now-ring" style={{ borderColor: lineColor }} />}
        <div className={`dm-stop-node dm-node-${pClass}${isFirst ? " dm-node-now" : ""}`} />
      </div>

      <div className={`dm-card dm-card-${pClass}${isDragging ? " is-dragging" : ""}${isNow ? " dm-card-is-now" : ""}`}>
        <div className="dm-card-row">
          <div
            ref={setActivatorNodeRef}
            className="dm-card-main"
            tabIndex={attributes.tabIndex}
            aria-disabled={attributes["aria-disabled"]}
            aria-describedby={attributes["aria-describedby"]}
            {...listeners}
          >
            <div className="dm-card-body">
              <span className="dm-card-title"><LinkifyText text={task.title} /></span>
              {task.concreteStep && <span className="dm-card-step"><LinkifyText text={task.concreteStep} /></span>}
            </div>
            <div className="dm-card-right">
              <PriorityBadge priority={task.priority} />
              <span className="dm-card-dur">{formatDuration(duration)}</span>
            </div>
            <button
              type="button"
              className={`dm-btn-menu${isExpanded ? " is-open" : ""}`}
              onClick={onToggle}
              onPointerDown={e => e.stopPropagation()}
              aria-expanded={isExpanded}
              aria-label="Card options"
            >
              ⋮
            </button>
          </div>

          {isFirst && (
            <div className="dm-focus-row">
              <button
                type="button"
                className="dm-focus-btn"
                onClick={onStartFocus}
                onPointerDown={e => e.stopPropagation()}
              >
                Start Focus →
              </button>
            </div>
          )}
        </div>

        {isExpanded && (
          <div className="dm-edit-panel" onPointerDown={e => e.stopPropagation()}>
            <div className="dm-edit-row">
              <label className="dm-edit-label">
                Duration
                <select
                  value={duration}
                  onChange={e => onDurationChange(taskId, Number(e.target.value))}
                >
                  {DURATION_OPTIONS.map(m => (
                    <option key={m} value={m}>{formatDuration(m)}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="dm-btn-icon dm-btn-remove" onClick={() => onRemove(taskId)} aria-label="Remove from route">×</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnchorControl({ anchorMinutes, onChangeAnchor, onAutoFill, onClear, canAutoFill, canClear }) {
  const [actualNow, setActualNow] = useState(currentDayMinutes);
  useEffect(() => {
    const id = setInterval(() => setActualNow(currentDayMinutes()), 30_000);
    return () => clearInterval(id);
  }, []);

  const nextQuarter = Math.ceil(actualNow / 15) * 15;

  const options = [actualNow];
  for (let m = nextQuarter; m <= actualNow + 600 && m < 1440; m += 15) {
    if (m !== actualNow) options.push(m);
  }
  if (!options.includes(anchorMinutes) && anchorMinutes > actualNow) {
    options.push(anchorMinutes);
    options.sort((a, b) => a - b);
  }

  return (
    <div className="day-map-anchor-bar">
      <span className="day-map-anchor-label">Starting from</span>
      <select
        className="day-map-anchor-select"
        value={anchorMinutes}
        onChange={e => onChangeAnchor(Number(e.target.value))}
        aria-label="Route start time"
      >
        {options.map(m => (
          <option key={m} value={m}>
            {formatClock(m)}{m === actualNow ? " (now)" : ""}
          </option>
        ))}
      </select>
      <div className="day-map-anchor-actions">
        <button type="button" className="day-map-action-btn" onClick={onAutoFill} disabled={!canAutoFill}>Auto-fill</button>
        <button type="button" className="day-map-action-btn day-map-action-btn-clear" onClick={onClear} disabled={!canClear}>Clear</button>
      </div>
    </div>
  );
}

function AvailableStrip({ tasks, isOpen, onToggle, onAdd }) {
  return (
    <div className="day-map-available-strip">
      <button type="button" className="day-map-strip-header" onClick={onToggle}>
        <span>Unscheduled · {tasks.length}</span>
        <span className="day-map-strip-chevron" aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div className="day-map-chip-row" role="group" aria-label="Unscheduled today tasks">
          {tasks.length ? tasks.map(t => (
            <button
              key={getTaskId(t)}
              type="button"
              className="day-map-task-chip"
              onClick={() => onAdd(getTaskId(t))}
            >
              <span className={`day-map-priority ${normalizePriority(t.priority).toLowerCase()}`}>
                {normalizePriority(t.priority)}
              </span>
              <span className="day-map-chip-title">{t.title}</span>
              <span className="day-map-chip-duration">{formatDuration(getEstimate(t))}</span>
            </button>
          )) : (
            <p className="day-map-all-set">All tasks in the route ✓</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function DayMapPage({ payload, savePayload, onClose, onStartFocus, onAddTask, flushNow = () => {} }) {
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [stripOpen, setStripOpen] = useState(true);

  const todayStr = useTodayStr();
  const tasks = payload?.tasks || [];
  const config = payload?.config || {};

  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const staleRouteReflowKeyRef = useRef(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const activeTodayTasks = useMemo(() => (
    tasks
      .filter(t => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted && !t.isParked)
      .sort(sortByPriorityAndOrder)
  ), [tasks]);

  // Include old-format tasks (dayMapPeriod set but no dayMapOrder) for backward compat
  const scheduledTasks = useMemo(() => (
    activeTodayTasks
      .filter(t => t.dayMapDate === todayStr && (t.dayMapOrder != null || !!t.dayMapPeriod))
      .sort((a, b) => {
        const oa = a.dayMapOrder ?? Infinity;
        const ob = b.dayMapOrder ?? Infinity;
        if (oa !== ob) return oa - ob;
        return (a.dayMapStartMinutes ?? 0) - (b.dayMapStartMinutes ?? 0);
      })
  ), [activeTodayTasks, todayStr]);

  const unscheduledTasks = useMemo(() => (
    activeTodayTasks.filter(t => t.dayMapDate !== todayStr || (t.dayMapOrder == null && !t.dayMapPeriod))
  ), [activeTodayTasks, todayStr]);

  // Anchor: config-persisted → inferred from first scheduled task → current time
  // Clamp to now so a stored past value never produces a past start time.
  const anchorMinutes = useMemo(() => {
    const now = currentDayMinutes();
    if (config.dayMapDate === todayStr && config.dayMapAnchorMinutes != null) {
      return Math.max(now, Number(config.dayMapAnchorMinutes));
    }
    if (scheduledTasks.length > 0 && scheduledTasks[0].dayMapStartMinutes != null) {
      return Math.max(now, Number(scheduledTasks[0].dayMapStartMinutes));
    }
    return now;
  }, [config.dayMapDate, config.dayMapAnchorMinutes, scheduledTasks, todayStr]);

  const totalDuration = scheduledTasks.reduce((sum, t) => sum + getEstimate(t), 0);
  const sortableIds = scheduledTasks.map(getTaskId);

  const endTime = useMemo(() => {
    if (!scheduledTasks.length) return anchorMinutes;
    const last = scheduledTasks[scheduledTasks.length - 1];
    return Number(last.dayMapStartMinutes ?? 0) + getEstimate(last);
  }, [scheduledTasks, anchorMinutes]);

  const latestTasks = () => payloadRef.current?.tasks || [];

  // Reflow ordered tasks from anchor and save everything in one atomic payload write
  const applyAndSave = (orderedScheduled, anchor, configPatch = null) => {
    const reflowed = reflowRoute(orderedScheduled, anchor, todayStr);
    const p = payloadRef.current;
    const nextTasks = applyReflow(latestTasks(), reflowed);
    const update = { ...p, tasks: nextTasks, timestamp: Date.now() };
    if (configPatch) {
      update.config = { ...(p?.config || {}), ...configPatch, lastUpdated: Date.now() };
    }
    savePayload(update);
  };

  useEffect(() => {
    if (!shouldReflowPastRoute(scheduledTasks, anchorMinutes)) return;
    const key = `${todayStr}:${anchorMinutes}:${scheduledTasks.map(t => `${getTaskId(t)}:${t.dayMapStartMinutes}`).join("|")}`;
    if (staleRouteReflowKeyRef.current === key) return;
    staleRouteReflowKeyRef.current = key;
    applyAndSave(scheduledTasks, anchorMinutes, { dayMapDate: todayStr, dayMapAnchorMinutes: anchorMinutes });
  }, [scheduledTasks, anchorMinutes, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAnchor = (minutes) => {
    applyAndSave(scheduledTasks, minutes, { dayMapDate: todayStr, dayMapAnchorMinutes: minutes });
  };

  const addToRoute = (taskId) => {
    const task = latestTasks().find(t => getTaskId(t) === taskId);
    if (!task) return;
    applyAndSave([...scheduledTasks, task], anchorMinutes);
  };

  const removeFromRoute = (taskId) => {
    const newScheduled = scheduledTasks.filter(t => getTaskId(t) !== taskId);
    const reflowed = reflowRoute(newScheduled, anchorMinutes, todayStr);
    const p = payloadRef.current;
    const nextTasks = latestTasks().map(t => {
      if (getTaskId(t) === taskId) return removeScheduleFields(t);
      const updated = reflowed.find(r => getTaskId(r) === getTaskId(t));
      return updated || t;
    });
    savePayload({ ...p, tasks: nextTasks, timestamp: Date.now() });
    if (expandedTaskId === taskId) setExpandedTaskId(null);
  };

  // DayMap's duration edit takes preference over the task's own estimate —
  // also update timeEstimateMinutes so Today and Focus mode (which read
  // that field, not dayMapDurationMinutes) pick up the same value.
  const changeDuration = (taskId, duration) => {
    const newScheduled = scheduledTasks.map(t =>
      getTaskId(t) === taskId ? { ...t, dayMapDurationMinutes: duration, timeEstimateMinutes: duration } : t
    );
    applyAndSave(newScheduled, anchorMinutes);
  };

  const autoFill = () => {
    if (!unscheduledTasks.length) return;
    const newScheduled = [...scheduledTasks, ...unscheduledTasks.sort(sortByPriorityAndOrder)];
    applyAndSave(newScheduled, anchorMinutes);
    setStripOpen(false);
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

  const startFocus = (taskId) => {
    const now = Date.now();
    const p = payloadRef.current;
    const nextTasks = latestTasks().map(t => {
      const shouldFocus = getTaskId(t) === taskId;
      if (t.isNowFocus === shouldFocus) return t;
      return { ...t, isNowFocus: shouldFocus, lastUpdated: now };
    });
    savePayload({ ...p, tasks: nextTasks, timestamp: Date.now() });
    flushNow();
    onStartFocus ? onStartFocus() : onClose();
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = scheduledTasks.findIndex(t => getTaskId(t) === active.id);
    const newIndex = scheduledTasks.findIndex(t => getTaskId(t) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    applyAndSave(arrayMove([...scheduledTasks], oldIndex, newIndex), anchorMinutes);
  };

  const routeItems = useMemo(() => {
    const items = [];
    let lastPeriod = null;
    scheduledTasks.forEach((task, index) => {
      const period = getPeriodForMinutes(Number(task.dayMapStartMinutes ?? 0));
      if (period !== lastPeriod) {
        items.push({ type: "divider", id: `div-${period}-${index}`, label: PERIOD_LABELS[period] || period });
        lastPeriod = period;
      }
      items.push({ type: "task", id: getTaskId(task), task, index });
    });
    return items;
  }, [scheduledTasks]);

  return (
    <div className="day-map-page">
      <div className="day-map-topbar">
        <div className="day-map-title">
          <h1 className="day-map-title-option-b">
            <span className="dm-word-day">Day</span>{" "}
            <span className="dm-word-map">Map</span>
          </h1>
        </div>
        <button type="button" className="day-map-back" aria-label="Back" onClick={() => { flushNow(); onClose(); }}>↩<span className="day-map-back-word"> Back</span></button>
      </div>

      {activeTodayTasks.length === 0 ? (
        <section className="day-map-empty-state">
          <h2>No Today tasks yet</h2>
          <p>Add a Today task first, then map it into your day.</p>
          <button type="button" className="day-map-primary" onClick={onAddTask}>Add Today task</button>
        </section>
      ) : (
        <>
          <SummaryCard
            placed={scheduledTasks.length}
            total={activeTodayTasks.length}
            totalDuration={totalDuration}
            anchorMinutes={anchorMinutes}
          />

          <AnchorControl
            anchorMinutes={anchorMinutes}
            onChangeAnchor={setAnchor}
            onAutoFill={autoFill}
            onClear={clearRoute}
            canAutoFill={unscheduledTasks.length > 0}
            canClear={scheduledTasks.length > 0}
          />

          <AvailableStrip
            tasks={unscheduledTasks}
            isOpen={stripOpen}
            onToggle={() => setStripOpen(o => !o)}
            onAdd={addToRoute}
          />

          {scheduledTasks.length === 0 ? (
            <p className="day-map-route-empty">No tasks in route yet — tap a task above or use Auto-fill.</p>
          ) : (
            <div className="dm-timeline">
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                  {routeItems.map(item =>
                    item.type === "divider" ? (
                      <div key={item.id} className="dm-period-row">
                        <div className="dm-period-spine-line" aria-hidden="true" />
                        <span className="dm-period-label">{item.label}</span>
                      </div>
                    ) : (
                      <TimelineStop
                        key={item.id}
                        task={item.task}
                        isFirst={item.index === 0}
                        isExpanded={expandedTaskId === item.id}
                        onToggle={() => setExpandedTaskId(expandedTaskId === item.id ? null : item.id)}
                        onRemove={removeFromRoute}
                        onDurationChange={changeDuration}
                        onStartFocus={() => startFocus(item.id)}
                      />
                    )
                  )}
                </SortableContext>
              </DndContext>
              <div className="dm-stop dm-stop-end">
                <div className="dm-stop-time">
                  <span className="dm-time-hm">{formatClockHM(endTime)}</span>
                  <span className="dm-time-ampm">{formatClockAMPM(endTime)}</span>
                </div>
                <div className="dm-stop-spine">
                  <div className="dm-stop-node dm-node-end" />
                </div>
                <div className="dm-end-label">End of route</div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
