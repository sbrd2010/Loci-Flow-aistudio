import React, { useMemo, useState } from "react";
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
import "../styles/dayMap.css";

const PERIODS = [
  { id: "morning",   label: "Morning",   start: 6 * 60,  end: 12 * 60 },
  { id: "afternoon", label: "Afternoon", start: 12 * 60, end: 17 * 60 },
  { id: "evening",   label: "Evening",   start: 17 * 60, end: 21 * 60 },
  { id: "night",     label: "Night",     start: 21 * 60, end: 26 * 60 },
];

const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
const DURATION_OPTIONS = [15, 25, 45, 60, 120, 240, 360];

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

function sortByPriorityAndOrder(a, b) {
  const pa = PRIORITY_RANK[normalizePriority(a.priority)] || 3;
  const pb = PRIORITY_RANK[normalizePriority(b.priority)] || 3;
  if (pa !== pb) return pa - pb;
  return (a.orderIndex ?? 9999) - (b.orderIndex ?? 9999);
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
    data: { taskId },
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.55 : 1 }
    : { opacity: isDragging ? 0.55 : 1 };

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`day-map-task-chip ${selected ? "selected" : ""}`}
      style={style}
      onClick={() => onSelect(taskId)}
      {...attributes}
      {...listeners}
    >
      <span className={`day-map-priority ${normalizePriority(task.priority).toLowerCase()}`}>{normalizePriority(task.priority)}</span>
      <span className="day-map-chip-title">{task.title}</span>
      <span className="day-map-chip-duration">{formatDuration(getEstimate(task))}</span>
    </button>
  );
}

function DroppablePeriod({ period, isActive, children }) {
  const { isOver, setNodeRef } = useDroppable({ id: period.id });
  return (
    <section ref={setNodeRef} className={`day-map-period ${isOver ? "is-over" : ""} ${isActive ? "has-selection" : ""}`}>
      {children}
    </section>
  );
}

function ScheduledTaskBlock({ task, period, onStartChange, onDurationChange, onRemove }) {
  const taskId = getTaskId(task);
  const duration = getEstimate(task);
  const start = Number(task.dayMapStartMinutes ?? period.start);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `scheduled-${taskId}`,
    data: { taskId },
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.55 : 1 }
    : { opacity: isDragging ? 0.55 : 1 };

  return (
    <div ref={setNodeRef} className="day-map-task-block" style={style}>
      <button className="day-map-drag-handle" type="button" aria-label="Drag task" {...attributes} {...listeners}>
        <span /><span /><span />
      </button>
      <div className="day-map-task-copy">
        <div className="day-map-task-title-row">
          <span className={`day-map-priority ${normalizePriority(task.priority).toLowerCase()}`}>{normalizePriority(task.priority)}</span>
          <strong>{task.title}</strong>
        </div>
        {task.concreteStep && <p>{task.concreteStep}</p>}
      </div>
      <div className="day-map-task-controls">
        <select value={start} onChange={(e) => onStartChange(taskId, Number(e.target.value))} aria-label="Start time">
          {buildSlotOptions(period).map((slot) => (
            <option key={slot} value={slot}>{formatClock(slot)}</option>
          ))}
        </select>
        <select value={duration} onChange={(e) => onDurationChange(taskId, Number(e.target.value))} aria-label="Duration">
          {DURATION_OPTIONS.map((m) => (
            <option key={m} value={m}>{formatDuration(m)}</option>
          ))}
        </select>
        <button type="button" className="day-map-remove" onClick={() => onRemove(taskId)} aria-label="Remove from Day Map">
          ×
        </button>
      </div>
    </div>
  );
}

function PeriodPanel({
  period, tasks, selectedTask, pickerOpen, unscheduledTasks,
  onSlotClick, onPickTask, onStartChange, onDurationChange, onRemove,
}) {
  const capacity = period.end - period.start;
  const planned = tasks.reduce((sum, t) => sum + getEstimate(t), 0);
  const load = capacity ? Math.round((planned / capacity) * 100) : 0;
  const isOverbooked = load > 100;

  return (
    <DroppablePeriod period={period} isActive={!!selectedTask}>
      <div className="day-map-period-head">
        <div>
          <h2>{period.label}</h2>
          <span className="day-map-period-range">{formatShortClock(period.start)} – {formatShortClock(period.end)}</span>
        </div>
        <span className={`day-map-load-pill ${isOverbooked ? "over" : ""}`}>{formatDuration(planned)}</span>
      </div>

      <div className="day-map-period-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(load, 100)}%` }} />
      </div>

      <div className="day-map-task-stack">
        {tasks.length ? tasks.map((t) => (
          <ScheduledTaskBlock
            key={getTaskId(t)}
            task={t}
            period={period}
            onStartChange={onStartChange}
            onDurationChange={onDurationChange}
            onRemove={onRemove}
          />
        )) : (
          <div className="day-map-empty-slot">
            <span>Open slot</span>
            <small>{formatDuration(capacity)} available</small>
          </div>
        )}
      </div>

      <button type="button" className="day-map-slot-button" onClick={() => onSlotClick(period.id)}>
        {selectedTask ? "Place selected" : "Fill slot"}
      </button>

      {pickerOpen && (
        <div className="day-map-picker">
          {unscheduledTasks.length ? unscheduledTasks.map((t) => (
            <button key={getTaskId(t)} type="button" onClick={() => onPickTask(getTaskId(t), period.id)}>
              <span className={`day-map-priority ${normalizePriority(t.priority).toLowerCase()}`}>{normalizePriority(t.priority)}</span>
              <span>{t.title}</span>
            </button>
          )) : <span className="day-map-picker-empty">All Today tasks are placed.</span>}
        </div>
      )}
    </DroppablePeriod>
  );
}

export default function DayMapPage({ payload, savePayload, onClose, onAddTask }) {
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [pickerPeriod, setPickerPeriod] = useState(null);
  const todayStr = toLocalDateStr(new Date());
  const tasks = payload?.tasks || [];

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
    const grouped = Object.fromEntries(PERIODS.map((p) => [p.id, []]));
    activeTodayTasks.forEach((t) => {
      if (!taskIsScheduledToday(t, todayStr)) return;
      if (grouped[t.dayMapPeriod]) grouped[t.dayMapPeriod].push(t);
    });
    PERIODS.forEach((p) => {
      grouped[p.id].sort((a, b) => {
        const diff = Number(a.dayMapStartMinutes ?? p.start) - Number(b.dayMapStartMinutes ?? p.start);
        return diff !== 0 ? diff : sortByPriorityAndOrder(a, b);
      });
    });
    return grouped;
  }, [activeTodayTasks, todayStr]);

  const unscheduledTasks = useMemo(() => (
    activeTodayTasks.filter((t) => !taskIsScheduledToday(t, todayStr))
  ), [activeTodayTasks, todayStr]);

  const selectedTask = activeTodayTasks.find((t) => getTaskId(t) === selectedTaskId) || null;
  const plannedMinutes = activeTodayTasks.reduce((sum, t) => taskIsScheduledToday(t, todayStr) ? sum + getEstimate(t) : sum, 0);
  const totalCapacity = PERIODS.reduce((sum, p) => sum + (p.end - p.start), 0);
  const scheduledCount = activeTodayTasks.length - unscheduledTasks.length;

  const saveTasks = (nextTasks) => savePayload({ ...payload, tasks: nextTasks, timestamp: Date.now() });

  const nextSlotForPeriod = (periodId) => {
    const period = PERIODS.find((p) => p.id === periodId) || PERIODS[0];
    const scheduled = scheduledByPeriod[periodId] || [];
    const cursor = scheduled.reduce((max, t) => {
      const start = Number(t.dayMapStartMinutes ?? period.start);
      return Math.max(max, start + getEstimate(t) + 10);
    }, period.start);
    return roundToQuarter(Math.max(period.start, cursor));
  };

  const scheduleTask = (taskId, periodId, startOverride = null) => {
    const task = tasks.find((t) => getTaskId(t) === taskId);
    if (!task) return;
    const duration = getEstimate(task);
    const start = startOverride ?? nextSlotForPeriod(periodId);
    saveTasks(tasks.map((t) => (
      getTaskId(t) === taskId
        ? { ...t, dayMapDate: todayStr, dayMapPeriod: periodId, dayMapStartMinutes: start, dayMapDurationMinutes: duration, lastUpdated: Date.now() }
        : t
    )));
    setSelectedTaskId(null);
    setPickerPeriod(null);
  };

  const handleSlotClick = (periodId) => {
    if (selectedTaskId) { scheduleTask(selectedTaskId, periodId); return; }
    setPickerPeriod((cur) => cur === periodId ? null : periodId);
  };

  const changeStart = (taskId, startMinutes) => {
    saveTasks(tasks.map((t) => getTaskId(t) === taskId ? { ...t, dayMapStartMinutes: startMinutes, lastUpdated: Date.now() } : t));
  };

  const changeDuration = (taskId, duration) => {
    saveTasks(tasks.map((t) => getTaskId(t) === taskId ? { ...t, dayMapDurationMinutes: duration, lastUpdated: Date.now() } : t));
  };

  const removeFromMap = (taskId) => {
    saveTasks(tasks.map((t) => getTaskId(t) === taskId ? removeScheduleFields(t) : t));
  };

  const clearMap = () => {
    saveTasks(tasks.map((t) => taskIsScheduledToday(t, todayStr) ? removeScheduleFields(t) : t));
    setSelectedTaskId(null);
    setPickerPeriod(null);
  };

  const autoFillGaps = () => {
    if (!unscheduledTasks.length) return;
    const cursors = {};
    PERIODS.forEach((p) => {
      cursors[p.id] = (scheduledByPeriod[p.id] || []).reduce((max, t) => {
        const start = Number(t.dayMapStartMinutes ?? p.start);
        return Math.max(max, start + getEstimate(t) + 10);
      }, p.start);
    });
    const placements = new Map();
    [...unscheduledTasks].sort(sortByPriorityAndOrder).forEach((t) => {
      const duration = getEstimate(t);
      const preferred = getPreferredPeriods(t);
      const periodId = preferred.find((id) => {
        const p = PERIODS.find((item) => item.id === id);
        return p && cursors[id] + duration <= p.end;
      }) || preferred[0];
      const start = roundToQuarter(cursors[periodId]);
      cursors[periodId] = start + duration + 10;
      placements.set(getTaskId(t), { periodId, start, duration });
    });
    saveTasks(tasks.map((t) => {
      const p = placements.get(getTaskId(t));
      return p ? { ...t, dayMapDate: todayStr, dayMapPeriod: p.periodId, dayMapStartMinutes: p.start, dayMapDurationMinutes: p.duration, lastUpdated: Date.now() } : t;
    }));
    setSelectedTaskId(null);
    setPickerPeriod(null);
  };

  const handleDragEnd = ({ active, over }) => {
    const taskId = active?.data?.current?.taskId;
    const periodId = over?.id;
    if (!taskId || !PERIODS.some((p) => p.id === periodId)) return;
    scheduleTask(taskId, periodId);
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
          <span>{formatDuration(plannedMinutes)} planned</span>
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
          <section className="day-map-overview">
            <div className="day-map-load-line">
              <div>
                <strong>{formatDuration(Math.max(totalCapacity - plannedMinutes, 0))}</strong>
                <span>open space</span>
              </div>
              <div className="day-map-load-track" aria-hidden="true">
                <span style={{ width: `${Math.min((plannedMinutes / totalCapacity) * 100, 100)}%` }} />
              </div>
            </div>
            <div className="day-map-actions">
              <button type="button" onClick={autoFillGaps} disabled={!unscheduledTasks.length}>Auto-fill gaps</button>
              <button type="button" onClick={clearMap} disabled={!scheduledCount}>Clear map</button>
            </div>
          </section>

          <div className="day-map-layout">
            <aside className="day-map-tray" aria-label="Available Today tasks">
              <div className="day-map-tray-head">
                <h2>Available Today</h2>
                <span>{unscheduledTasks.length}</span>
              </div>
              <div className="day-map-chip-list">
                {unscheduledTasks.length ? unscheduledTasks.map((t) => (
                  <DraggableTaskChip
                    key={getTaskId(t)}
                    task={t}
                    selected={getTaskId(t) === selectedTaskId}
                    onSelect={setSelectedTaskId}
                  />
                )) : <p className="day-map-all-set">Every Today task is placed.</p>}
              </div>
            </aside>

            <div className="day-map-timeline">
              {PERIODS.map((period) => (
                <PeriodPanel
                  key={period.id}
                  period={period}
                  tasks={scheduledByPeriod[period.id] || []}
                  selectedTask={selectedTask}
                  pickerOpen={pickerPeriod === period.id}
                  unscheduledTasks={unscheduledTasks}
                  onSlotClick={handleSlotClick}
                  onPickTask={scheduleTask}
                  onStartChange={changeStart}
                  onDurationChange={changeDuration}
                  onRemove={removeFromMap}
                />
              ))}
            </div>
          </div>
        </DndContext>
      )}
    </div>
  );
}
