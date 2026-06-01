import React, { useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "../styles/dayMap.css";
import "../styles/dayMapPlanning.css";

const PERIOD_TEMPLATES = [
  { id: "morning", label: "Morning", start: 5 * 60, end: 12 * 60 },
  { id: "afternoon", label: "Afternoon", start: 12 * 60, end: 17 * 60 },
  { id: "evening", label: "Evening", start: 17 * 60, end: 21 * 60 },
  { id: "night", label: "Night", start: 21 * 60, end: 29 * 60 },
];

const DEFAULT_DAY_START_HOUR = 8;
const DEFAULT_DAY_END_HOUR = 26;
const START_HOUR_OPTIONS = [5, 6, 7, 8, 9, 10, 11, 12];
const END_HOUR_OPTIONS = [21, 22, 23, 24, 25, 26, 27, 28, 29];
const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
const DURATION_OPTIONS = [15, 25, 45, 60, 120, 240, 360];
const SCHEDULED_ID_PREFIX = "scheduled-";

function toLocalDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTaskId(task) {
  return String(task.uuid || task.id);
}

function normalizePriority(priority) {
  return String(priority || "P3").toUpperCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundToQuarter(minutes) {
  return Math.ceil(minutes / 15) * 15;
}

function currentDayMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// When the current time falls inside a period, don't schedule in the past —
// start from the next quarter-hour at or after now.
function effectivePeriodStart(period) {
  const now = currentDayMinutes();
  if (now > period.start && now < period.end) {
    return roundToQuarter(now);
  }
  return period.start;
}

function getEstimate(task) {
  const raw = Number(task.dayMapDurationMinutes || task.timeEstimateMinutes || task.estimateMinutes || 25);
  return clamp(Number.isFinite(raw) ? raw : 25, 10, 360);
}

function formatClock(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatShortClock(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12} ${suffix}`;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function getConfigHour(config, key, fallback, min, max) {
  const raw = Number(config?.[key]);
  return Number.isFinite(raw) ? clamp(raw, min, max) : fallback;
}

function buildPeriods(dayStartHour, dayEndHour) {
  const windowStart = dayStartHour * 60;
  const windowEnd = Math.max(dayEndHour * 60, windowStart + 60);
  return PERIOD_TEMPLATES.map((period) => {
    const start = Math.max(period.start, windowStart);
    const end = Math.min(period.end, windowEnd);
    return end > start ? { ...period, start, end } : null;
  }).filter(Boolean);
}

function sortByPriorityAndOrder(a, b) {
  const pa = PRIORITY_RANK[normalizePriority(a.priority)] || 3;
  const pb = PRIORITY_RANK[normalizePriority(b.priority)] || 3;
  if (pa !== pb) return pa - pb;
  return (a.orderIndex ?? 9999) - (b.orderIndex ?? 9999);
}

function sortByDayMapTime(period) {
  return (a, b) => {
    const diff = Number(a.dayMapStartMinutes ?? period.start) - Number(b.dayMapStartMinutes ?? period.start);
    return diff !== 0 ? diff : sortByPriorityAndOrder(a, b);
  };
}

function buildSlotOptions(period) {
  const slots = [];
  for (let minutes = period.start; minutes <= period.end - 15; minutes += 15) {
    slots.push(minutes);
  }
  return slots;
}

function taskIsScheduledToday(task, todayStr) {
  return task.dayMapDate === todayStr && !!task.dayMapPeriod;
}

function removeScheduleFields(task) {
  const { dayMapDate, dayMapPeriod, dayMapStartMinutes, dayMapDurationMinutes, dayMapOrder, ...rest } = task;
  return { ...rest, lastUpdated: Date.now() };
}

function getPreferredPeriods(task) {
  const priority = normalizePriority(task.priority);
  if (task.isMVD || priority === "P1") return ["morning", "afternoon", "evening", "night"];
  if (priority === "P2") return ["afternoon", "morning", "evening", "night"];
  if (priority === "P4") return ["evening", "morning", "afternoon", "night"];
  return ["afternoon", "evening", "morning", "night"];
}

function DraggableTaskChip({ task, selected, onSelect }) {
  const taskId = getTaskId(task);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `available-${taskId}`,
    data: { taskId, source: "available" },
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 999 : undefined }
    : { opacity: isDragging ? 0.5 : 1 };

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`day-map-task-chip${selected ? " selected" : ""}`}
      style={style}
      onClick={() => onSelect(taskId)}
      {...attributes}
      {...listeners}
    >
      <span className={`day-map-priority ${normalizePriority(task.priority).toLowerCase()}`}>
        {normalizePriority(task.priority)}
      </span>
      <span className="day-map-chip-title">{task.title}</span>
      <span className="day-map-chip-duration">{formatDuration(getEstimate(task))}</span>
    </button>
  );
}

function DroppablePeriod({ period, isActive, children }) {
  const { isOver, setNodeRef } = useDroppable({
    id: period.id,
    data: { periodId: period.id, source: "period" },
  });
  return (
    <section
      ref={setNodeRef}
      className={`day-map-period${isOver ? " is-over" : ""}${isActive ? " has-selection" : ""}`}
    >
      {children}
    </section>
  );
}

function SortableCompactTaskRow({ task, period, isExpanded, onToggle, onStartChange, onDurationChange, onPeriodChange, onRemove, periods }) {
  const taskId = getTaskId(task);
  const sortableId = `${SCHEDULED_ID_PREFIX}${taskId}`;
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    data: { taskId, periodId: period.id, source: "scheduled" },
  });

  const prio = normalizePriority(task.priority);
  const duration = getEstimate(task);
  const start = Number(task.dayMapStartMinutes ?? period.start);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`day-map-compact-wrap${isExpanded ? " expanded" : ""}${isDragging ? " is-dragging" : ""}`}
    >
      <div className="day-map-compact-row">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="day-map-drag-handle"
          aria-label={`Reorder ${task.title}`}
          {...attributes}
          {...listeners}
        >
          <span aria-hidden="true">::</span>
        </button>
        <button
          type="button"
          className="day-map-compact-main"
          onClick={onToggle}
          aria-expanded={isExpanded}
        >
          <span className={`day-map-priority ${prio.toLowerCase()}`}>{prio}</span>
          <span className="day-map-compact-title">{task.title}</span>
          <span className="day-map-compact-time">{formatClock(start)} · {formatDuration(duration)}</span>
        </button>
        <button
          type="button"
          className="day-map-remove-btn"
          onClick={() => onRemove(taskId)}
          aria-label="Remove from Day Map"
        >
          ×
        </button>
      </div>

      {isExpanded && (
        <div className="day-map-edit-panel">
          <div className="day-map-edit-grid">
            <label>
              Start
              <select
                value={start}
                onChange={(e) => onStartChange(taskId, Number(e.target.value))}
                aria-label="Start time"
              >
                {buildSlotOptions(period).map((slot) => (
                  <option key={slot} value={slot}>{formatClock(slot)}</option>
                ))}
              </select>
            </label>
            <label>
              Duration
              <select
                value={duration}
                onChange={(e) => onDurationChange(taskId, Number(e.target.value))}
                aria-label="Duration"
              >
                {DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>{formatDuration(m)}</option>
                ))}
              </select>
            </label>
            <label>
              Period
              <select
                value={period.id}
                onChange={(e) => onPeriodChange(taskId, e.target.value)}
                aria-label="Time period"
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function AvailableStrip({ tasks, selectedTaskId, onSelect, isOpen, onToggle }) {
  return (
    <div className="day-map-available-strip">
      <button type="button" className="day-map-strip-header" onClick={onToggle}>
        <span>Unscheduled · {tasks.length}</span>
        <span className="day-map-strip-chevron" aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div className="day-map-chip-row" role="group" aria-label="Available Today tasks">
          {tasks.length ? tasks.map((t) => (
            <DraggableTaskChip
              key={getTaskId(t)}
              task={t}
              selected={getTaskId(t) === selectedTaskId}
              onSelect={onSelect}
            />
          )) : (
            <p className="day-map-all-set">All tasks placed ✓</p>
          )}
        </div>
      )}
    </div>
  );
}

function PlanningWindowControls({ dayStartHour, dayEndHour, onChange }) {
  return (
    <div className="day-map-window-controls" aria-label="Planning window">
      <label className="day-map-window-control">
        <span>Start</span>
        <select
          value={dayStartHour}
          onChange={(e) => onChange(Number(e.target.value), dayEndHour)}
          aria-label="Planning start time"
        >
          {START_HOUR_OPTIONS.map((hour) => (
            <option key={hour} value={hour}>{formatClock(hour * 60)}</option>
          ))}
        </select>
      </label>
      <label className="day-map-window-control">
        <span>Until</span>
        <select
          value={dayEndHour}
          onChange={(e) => onChange(dayStartHour, Number(e.target.value))}
          aria-label="Planning end time"
        >
          {END_HOUR_OPTIONS.map((hour) => (
            <option key={hour} value={hour}>{formatClock(hour * 60)}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function PeriodSection({
  period, periods, tasks, selectedTask, expandedTaskId, onExpandTask,
  onPlace, onStartChange, onDurationChange, onPeriodChange, onRemove,
}) {
  const capacity = period.end - period.start;
  const planned = tasks.reduce((sum, t) => sum + getEstimate(t), 0);
  const load = capacity ? Math.round((planned / capacity) * 100) : 0;
  const isOverbooked = load > 100;
  const sortableItems = tasks.map((t) => `${SCHEDULED_ID_PREFIX}${getTaskId(t)}`);

  return (
    <DroppablePeriod period={period} isActive={!!selectedTask}>
      <div className="day-map-period-head">
        <div>
          <h2>{period.label}</h2>
          <span className="day-map-period-range">
            {formatShortClock(period.start)} – {formatShortClock(period.end)}
          </span>
        </div>
        {planned > 0 && (
          <span className={`day-map-load-pill${isOverbooked ? " over" : ""}`}>
            {formatDuration(planned)}
          </span>
        )}
      </div>

      {planned > 0 && (
        <div className="day-map-period-meter" aria-hidden="true">
          <span style={{ width: `${Math.min(load, 100)}%` }} />
        </div>
      )}

      <div className="day-map-task-stack">
        {tasks.length ? (
          <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
            {tasks.map((t) => (
              <SortableCompactTaskRow
                key={getTaskId(t)}
                task={t}
                period={period}
                periods={periods}
                isExpanded={expandedTaskId === getTaskId(t)}
                onToggle={() => onExpandTask(expandedTaskId === getTaskId(t) ? null : getTaskId(t))}
                onStartChange={onStartChange}
                onDurationChange={onDurationChange}
                onPeriodChange={onPeriodChange}
                onRemove={onRemove}
              />
            ))}
          </SortableContext>
        ) : (
          <div className="day-map-empty-slot">
            <span>Open slot</span>
            <small>{formatDuration(capacity)} available</small>
          </div>
        )}
      </div>

      {selectedTask && (
        <button type="button" className="day-map-place-btn" onClick={() => onPlace(period.id)}>
          Place here — {selectedTask.title.length > 24 ? `${selectedTask.title.slice(0, 24)}…` : selectedTask.title}
        </button>
      )}
    </DroppablePeriod>
  );
}

export default function DayMapPage({ payload, savePayload, onClose, onAddTask }) {
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [stripOpen, setStripOpen] = useState(true);
  const todayStr = toLocalDateStr(new Date());
  const tasks = payload?.tasks || [];
  const config = payload?.config || {};
  const dayStartHour = getConfigHour(config, "dayStartHour", DEFAULT_DAY_START_HOUR, 5, 12);
  const dayEndHour = getConfigHour(config, "dayEndHour", DEFAULT_DAY_END_HOUR, 21, 29);
  const periods = useMemo(() => buildPeriods(dayStartHour, dayEndHour), [dayStartHour, dayEndHour]);
  const periodById = useMemo(() => Object.fromEntries(periods.map((p) => [p.id, p])), [periods]);

  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const activeTodayTasks = useMemo(() => (
    tasks
      .filter((t) => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted && !t.isParked)
      .sort(sortByPriorityAndOrder)
  ), [tasks]);

  const scheduledByPeriod = useMemo(() => {
    const grouped = Object.fromEntries(periods.map((p) => [p.id, []]));
    activeTodayTasks.forEach((t) => {
      if (!taskIsScheduledToday(t, todayStr)) return;
      if (grouped[t.dayMapPeriod]) grouped[t.dayMapPeriod].push(t);
    });
    periods.forEach((p) => {
      grouped[p.id].sort(sortByDayMapTime(p));
    });
    return grouped;
  }, [activeTodayTasks, periods, todayStr]);

  const unscheduledTasks = useMemo(() => (
    activeTodayTasks.filter((t) => !taskIsScheduledToday(t, todayStr) || !periodById[t.dayMapPeriod])
  ), [activeTodayTasks, periodById, todayStr]);

  const selectedTask = activeTodayTasks.find((t) => getTaskId(t) === selectedTaskId) || null;
  const plannedMinutes = activeTodayTasks.reduce((sum, t) => (
    taskIsScheduledToday(t, todayStr) && periodById[t.dayMapPeriod] ? sum + getEstimate(t) : sum
  ), 0);
  const totalCapacity = periods.reduce((sum, p) => sum + (p.end - p.start), 0);
  const scheduledCount = activeTodayTasks.length - unscheduledTasks.length;

  const saveTasks = (nextTasks) => {
    const p = payloadRef.current;
    savePayload({ ...p, tasks: nextTasks, timestamp: Date.now() });
  };

  const saveConfig = (nextConfig) => {
    const p = payloadRef.current;
    savePayload({
      ...p,
      config: { ...(p?.config || {}), ...nextConfig, lastUpdated: Date.now() },
      timestamp: Date.now(),
    });
  };

  const latestTasks = () => payloadRef.current?.tasks || [];

  const getPeriodTasksFrom = (sourceTasks, periodId) => (
    sourceTasks
      .filter((t) => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted && !t.isParked)
      .filter((t) => taskIsScheduledToday(t, todayStr) && t.dayMapPeriod === periodId)
      .sort(sortByDayMapTime(periodById[periodId] || periods[0]))
  );

  const buildPeriodUpdates = (periodId, orderedTasks, now = Date.now()) => {
    const period = periodById[periodId];
    if (!period) return new Map();
    const updates = new Map();
    let cursor = effectivePeriodStart(period);
    orderedTasks.forEach((task, index) => {
      const duration = getEstimate(task);
      const start = roundToQuarter(cursor);
      updates.set(getTaskId(task), {
        dayMapDate: todayStr,
        dayMapPeriod: periodId,
        dayMapStartMinutes: start,
        dayMapDurationMinutes: duration,
        dayMapOrder: index,
        lastUpdated: now,
      });
      cursor = start + duration + 10;
    });
    return updates;
  };

  const applyUpdates = (currentTasks, updates) => (
    currentTasks.map((task) => {
      const update = updates.get(getTaskId(task));
      return update ? { ...task, ...update } : task;
    })
  );

  const nextSlotForPeriod = (periodId) => {
    const period = periodById[periodId] || periods[0];
    const scheduled = scheduledByPeriod[periodId] || [];
    const cursor = scheduled.reduce((max, t) => {
      const start = Number(t.dayMapStartMinutes ?? period.start);
      return Math.max(max, start + getEstimate(t) + 10);
    }, period.start);
    return roundToQuarter(Math.max(period.start, cursor));
  };

  const scheduleTask = (taskId, periodId, startOverride = null) => {
    const currentTasks = latestTasks();
    const task = currentTasks.find((t) => getTaskId(t) === taskId);
    const period = periodById[periodId];
    if (!task || !period) return;
    const duration = getEstimate(task);
    const start = startOverride ?? nextSlotForPeriod(periodId);
    saveTasks(currentTasks.map((t) =>
      getTaskId(t) === taskId
        ? { ...t, dayMapDate: todayStr, dayMapPeriod: periodId, dayMapStartMinutes: start, dayMapDurationMinutes: duration, lastUpdated: Date.now() }
        : t
    ));
    setSelectedTaskId(null);
  };

  const handleChipSelect = (taskId) => {
    setSelectedTaskId((cur) => cur === taskId ? null : taskId);
    setExpandedTaskId(null);
  };

  const changePlanningWindow = (startHour, endHour) => {
    const nextStart = clamp(startHour, 5, 12);
    const nextEnd = clamp(endHour, 21, 29);
    saveConfig({ dayStartHour: nextStart, dayEndHour: Math.max(nextEnd, nextStart + 1) });
  };

  const changeStart = (taskId, startMinutes) => {
    saveTasks(latestTasks().map((t) => getTaskId(t) === taskId ? { ...t, dayMapStartMinutes: startMinutes, lastUpdated: Date.now() } : t));
  };

  const changeDuration = (taskId, duration) => {
    saveTasks(latestTasks().map((t) => getTaskId(t) === taskId ? { ...t, dayMapDurationMinutes: duration, lastUpdated: Date.now() } : t));
  };

  const changePeriod = (taskId, newPeriodId) => {
    const currentTasks = latestTasks();
    const task = currentTasks.find((t) => getTaskId(t) === taskId);
    if (!task || !periodById[newPeriodId]) return;
    const newStart = nextSlotForPeriod(newPeriodId);
    saveTasks(currentTasks.map((t) =>
      getTaskId(t) === taskId
        ? { ...t, dayMapPeriod: newPeriodId, dayMapStartMinutes: newStart, lastUpdated: Date.now() }
        : t
    ));
    setExpandedTaskId(null);
  };

  const removeFromMap = (taskId) => {
    saveTasks(latestTasks().map((t) => getTaskId(t) === taskId ? removeScheduleFields(t) : t));
    if (expandedTaskId === taskId) setExpandedTaskId(null);
  };

  const clearMap = () => {
    saveTasks(latestTasks().map((t) => taskIsScheduledToday(t, todayStr) ? removeScheduleFields(t) : t));
    setSelectedTaskId(null);
    setExpandedTaskId(null);
  };

  const choosePeriodForTask = (task, cursors) => {
    const duration = getEstimate(task);
    const preferredIds = getPreferredPeriods(task).filter((id) => periodById[id]);
    const allIds = periods.map((p) => p.id);
    return preferredIds.find((id) => cursors[id] + duration <= periodById[id].end)
      || allIds.find((id) => cursors[id] + duration <= periodById[id].end)
      || [...preferredIds, ...allIds][0];
  };

  const placeTasksByPriority = (tasksToPlace, seedScheduled = scheduledByPeriod) => {
    const cursors = {};
    const orderCounters = {};
    periods.forEach((p) => {
      const scheduled = seedScheduled[p.id] || [];
      cursors[p.id] = scheduled.reduce((max, t) => {
        const start = Number(t.dayMapStartMinutes ?? p.start);
        return Math.max(max, start + getEstimate(t) + 10);
      }, effectivePeriodStart(p));
      orderCounters[p.id] = scheduled.length;
    });

    const now = Date.now();
    const placements = new Map();
    [...tasksToPlace].sort(sortByPriorityAndOrder).forEach((task) => {
      const periodId = choosePeriodForTask(task, cursors);
      if (!periodId) return;
      const duration = getEstimate(task);
      const start = roundToQuarter(cursors[periodId]);
      cursors[periodId] = start + duration + 10;
      placements.set(getTaskId(task), {
        dayMapDate: todayStr,
        dayMapPeriod: periodId,
        dayMapStartMinutes: start,
        dayMapDurationMinutes: duration,
        dayMapOrder: orderCounters[periodId] || 0,
        lastUpdated: now,
      });
      orderCounters[periodId] = (orderCounters[periodId] || 0) + 1;
    });
    return placements;
  };

  const autoFillGaps = () => {
    if (!unscheduledTasks.length) return;
    const placements = placeTasksByPriority(unscheduledTasks);
    saveTasks(applyUpdates(latestTasks(), placements));
    setSelectedTaskId(null);
    setExpandedTaskId(null);
  };

  const rebuildDay = () => {
    if (!activeTodayTasks.length) return;
    const emptyScheduled = Object.fromEntries(periods.map((p) => [p.id, []]));
    const placements = placeTasksByPriority(activeTodayTasks, emptyScheduled);
    saveTasks(applyUpdates(latestTasks(), placements));
    setSelectedTaskId(null);
    setExpandedTaskId(null);
  };

  const getDropTarget = (over) => {
    if (!over?.id) return null;
    const overId = String(over.id);
    if (periodById[overId]) {
      return { periodId: overId, index: (scheduledByPeriod[overId] || []).length };
    }
    if (overId.startsWith(SCHEDULED_ID_PREFIX)) {
      const overTaskId = overId.slice(SCHEDULED_ID_PREFIX.length);
      for (const period of periods) {
        const list = scheduledByPeriod[period.id] || [];
        const index = list.findIndex((task) => getTaskId(task) === overTaskId);
        if (index !== -1) return { periodId: period.id, index };
      }
    }
    return null;
  };

  const moveTaskToTarget = (taskId, targetPeriodId, targetIndex, sourcePeriodId = null) => {
    const currentTasks = latestTasks();
    const movingTask = currentTasks.find((t) => getTaskId(t) === taskId);
    if (!movingTask || !periodById[targetPeriodId]) return;

    const periodLists = Object.fromEntries(periods.map((period) => [
      period.id,
      getPeriodTasksFrom(currentTasks, period.id).filter((task) => getTaskId(task) !== taskId),
    ]));
    const destination = periodLists[targetPeriodId] || [];
    const insertIndex = clamp(targetIndex ?? destination.length, 0, destination.length);
    periodLists[targetPeriodId] = [
      ...destination.slice(0, insertIndex),
      movingTask,
      ...destination.slice(insertIndex),
    ];

    const affectedPeriods = new Set([sourcePeriodId, targetPeriodId].filter(Boolean));
    const now = Date.now();
    const updates = new Map();
    affectedPeriods.forEach((periodId) => {
      buildPeriodUpdates(periodId, periodLists[periodId] || [], now).forEach((value, key) => updates.set(key, value));
    });
    saveTasks(applyUpdates(currentTasks, updates));
    setSelectedTaskId(null);
    setExpandedTaskId(null);
  };

  const handleDragEnd = ({ active, over }) => {
    const taskId = active?.data?.current?.taskId;
    const target = getDropTarget(over);
    if (!taskId || !target) return;
    moveTaskToTarget(taskId, target.periodId, target.index, active?.data?.current?.periodId || null);
  };

  return (
    <div className="day-map-page">
      <div className="day-map-topbar">
        <button type="button" className="day-map-back" onClick={onClose}>Back</button>
        <div className="day-map-title">
          <span>Today</span>
          <h1>Day Map</h1>
        </div>
        <div className="day-map-stats">
          <span>{scheduledCount}/{activeTodayTasks.length} placed</span>
          {plannedMinutes > 0 && <span>{formatDuration(plannedMinutes)} planned</span>}
        </div>
      </div>

      {activeTodayTasks.length === 0 ? (
        <section className="day-map-empty-state">
          <h2>No Today tasks yet</h2>
          <p>Add a Today task first, then map it into your day.</p>
          <button type="button" className="day-map-primary" onClick={onAddTask}>Add Today task</button>
        </section>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <section className="day-map-overview day-map-planning-overview">
            <div className="day-map-load-line">
              <div>
                <strong>{formatDuration(Math.max(totalCapacity - plannedMinutes, 0))}</strong>
                <span>open space today</span>
              </div>
              <div className="day-map-load-track" aria-hidden="true">
                <span style={{ width: `${Math.min((plannedMinutes / Math.max(totalCapacity, 1)) * 100, 100)}%` }} />
              </div>
            </div>
            <PlanningWindowControls
              dayStartHour={dayStartHour}
              dayEndHour={dayEndHour}
              onChange={changePlanningWindow}
            />
            <div className="day-map-actions">
              <button type="button" onClick={autoFillGaps} disabled={!unscheduledTasks.length}>Auto-fill</button>
              <button type="button" className="day-map-rebuild-btn" onClick={rebuildDay} disabled={!activeTodayTasks.length}>Rebuild day</button>
              <button type="button" onClick={clearMap} disabled={!scheduledCount}>Clear</button>
            </div>
          </section>

          <AvailableStrip
            tasks={unscheduledTasks}
            selectedTaskId={selectedTaskId}
            onSelect={handleChipSelect}
            isOpen={stripOpen}
            onToggle={() => setStripOpen((o) => !o)}
          />

          <div className="day-map-timeline">
            {periods.map((period) => (
              <PeriodSection
                key={period.id}
                period={period}
                periods={periods}
                tasks={scheduledByPeriod[period.id] || []}
                selectedTask={selectedTask}
                expandedTaskId={expandedTaskId}
                onExpandTask={setExpandedTaskId}
                onPlace={(periodId) => scheduleTask(selectedTaskId, periodId)}
                onStartChange={changeStart}
                onDurationChange={changeDuration}
                onPeriodChange={changePeriod}
                onRemove={removeFromMap}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
