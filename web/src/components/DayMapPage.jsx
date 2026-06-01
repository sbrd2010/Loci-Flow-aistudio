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
  { id: "morning", label: "Morning", start: 6 * 60, end: 12 * 60 },
  { id: "afternoon", label: "Afternoon", start: 12 * 60, end: 17 * 60 },
  { id: "evening", label: "Evening", start: 17 * 60, end: 21 * 60 },
  { id: "night", label: "Night", start: 21 * 60, end: 26 * 60 },
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
  const {
    dayMapDate,
    dayMapPeriod,
    dayMapStartMinutes,
    dayMapDurationMinutes,
    dayMapOrder,
    ...rest
  } = task;
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
        <span />
        <span />
        <span />
      </button>
      <div className="day-map-task-copy">
        <div className="day-map-task-title-row">
          <span className={`day-map-priority ${normalizePriority(task.priority).toLowerCase()}`}>{normalizePriority(task.priority)}</span>
          <strong>{task.title}</strong>
        </div>
        {task.concreteStep && <p>{task.concreteStep}</p>}
      </div>
      <div className="day-map-task-controls">
        <select value={start} onChange={(event) => onStartChange(taskId, Number(event.target.value))} aria-label="Start time">
          {buildSlotOptions(period).map((slot) => (
            <option key={slot} value={slot}>{formatClock(slot)}</option>
          ))}
        </select>
        <select value={duration} onChange={(event) => onDurationChange(taskId, Number(event.target.value))} aria-label="Duration">
          {DURATION_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>{formatDuration(minutes)}</option>
          ))}
        </select>
        <button type="button" className="day-map-remove" onClick={() => onRemove(taskId)} aria-label="Remove from Day Map">
          x
        </button>
      </div>
    </div>
  );
}

function PeriodPanel({
  period,
  tasks,
  selectedTask,
  pickerOpen,
  unscheduledTasks,
  onSlotClick,
  onPickTask,
  onStartChange,
  onDurationChange,
  onRemove,
}) {
  const capacity = period.end - period.start;
  const planned = tasks.reduce((sum, task) => sum + getEstimate(task), 0);
  const load = capacity ? Math.round((planned / capacity) * 100) : 0;
  const isOverbooked = load > 100;

  return (
    <DroppablePeriod period={period} isActive={!!selectedTask}>
      <div className="day-map-period-head">
        <div>
          <h2>{period.label}</h2>
          <span className="day-map-period-range">{formatShortClock(period.start)} - {formatShortClock(period.end)}</span>
        </div>
        <span className={`day-map-load-pill ${isOverbooked ? "over" : ""}`}>{formatDuration(planned)}</span>
      </div>

      <div className="day-map-period-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(load, 100)}%` }} />
      </div>

      <div className="day-map-task-stack">
        {tasks.length ? tasks.map((task) => (
          <ScheduledTaskBlock
            key={getTaskId(task)}
            task={task}
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
          {unscheduledTasks.length ? unscheduledTasks.map((task) => (
            <button key={getTaskId(task)} type="button" onClick={() => onPickTask(getTaskId(task), period.id)}>
              <span className={`day-map-priority ${normalizePriority(task.priority).toLowerCase()}`}>{normalizePriority(task.priority)}</span>
              <span>{task.title}</span>
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
      .filter((task) => task.horizonLevel === "today" && !task.isDeleted && !task.isCompleted && !task.isParked)
      .sort(sortByPriorityAndOrder)
  ), [tasks]);

  const scheduledByPeriod = useMemo(() => {
    const grouped = Object.fromEntries(PERIODS.map((period) => [period.id, []]));
    activeTodayTasks.forEach((task) => {
      if (!taskIsScheduledToday(task, todayStr)) return;
      if (grouped[task.dayMapPeriod]) grouped[task.dayMapPeriod].push(task);
    });
    PERIODS.forEach((period) => {
      grouped[period.id].sort((a, b) => {
        const startDiff = Number(a.dayMapStartMinutes ?? period.start) - Number(b.dayMapStartMinutes ?? period.start);
        if (startDiff !== 0) return startDiff;
        return sortByPriorityAndOrder(a, b);
      });
    });
    return grouped;
  }, [activeTodayTasks, todayStr]);

  const unscheduledTasks = useMemo(() => (
    activeTodayTasks.filter((task) => !taskIsScheduledToday(task, todayStr))
  ), [activeTodayTasks, todayStr]);

  const selectedTask = activeTodayTasks.find((task) => getTaskId(task) === selectedTaskId) || null;
  const plannedMinutes = activeTodayTasks.reduce((sum, task) => taskIsScheduledToday(task, todayStr) ? sum + getEstimate(task) : sum, 0);
  const totalCapacity = PERIODS.reduce((sum, period) => sum + (period.end - period.start), 0);
  const scheduledCount = activeTodayTasks.length - unscheduledTasks.length;

  const saveTasks = (nextTasks) => {
    savePayload({ ...payload, tasks: nextTasks, timestamp: Date.now() });
  };

  const nextSlotForPeriod = (periodId, duration) => {
    const period = PERIODS.find((item) => item.id === periodId) || PERIODS[0];
    const scheduled = scheduledByPeriod[periodId] || [];
    const cursor = scheduled.reduce((max, task) => {
      const start = Number(task.dayMapStartMinutes ?? period.start);
      return Math.max(max, start + getEstimate(task) + 10);
    }, period.start);
    return roundToQuarter(Math.max(period.start, cursor || period.start));
  };

  const scheduleTask = (taskId, periodId, startOverride = null) => {
    const task = tasks.find((item) => getTaskId(item) === taskId);
    if (!task) return;
    const duration = getEstimate(task);
    const start = startOverride ?? nextSlotForPeriod(periodId, duration);
    saveTasks(tasks.map((item) => (
      getTaskId(item) === taskId
        ? {
            ...item,
            dayMapDate: todayStr,
            dayMapPeriod: periodId,
            dayMapStartMinutes: start,
            dayMapDurationMinutes: duration,
            lastUpdated: Date.now(),
          }
        : item
    )));
    setSelectedTaskId(null);
    setPickerPeriod(null);
  };

  const handleSlotClick = (periodId) => {
    if (selectedTaskId) {
      scheduleTask(selectedTaskId, periodId);
      return;
    }
    setPickerPeriod((current) => current === periodId ? null : periodId);
  };

  const changeStart = (taskId, startMinutes) => {
    saveTasks(tasks.map((task) => (
      getTaskId(task) === taskId
        ? { ...task, dayMapStartMinutes: startMinutes, lastUpdated: Date.now() }
        : task
    )));
  };

  const changeDuration = (taskId, duration) => {
    saveTasks(tasks.map((task) => (
      getTaskId(task) === taskId
        ? { ...task, dayMapDurationMinutes: duration, lastUpdated: Date.now() }
        : task
    )));
  };

  const removeFromMap = (taskId) => {
    saveTasks(tasks.map((task) => getTaskId(task) === taskId ? removeScheduleFields(task) : task));
  };

  const clearMap = () => {
    saveTasks(tasks.map((task) => taskIsScheduledToday(task, todayStr) ? removeScheduleFields(task) : task));
    setSelectedTaskId(null);
    setPickerPeriod(null);
  };

  const autoFillGaps = () => {
    if (!unscheduledTasks.length) return;
    const cursors = {};
    PERIODS.forEach((period) => {
      cursors[period.id] = (scheduledByPeriod[period.id] || []).reduce((max, task) => {
        const start = Number(task.dayMapStartMinutes ?? period.start);
        return Math.max(max, start + getEstimate(task) + 10);
      }, period.start);
    });

    const placements = new Map();
    [...unscheduledTasks].sort(sortByPriorityAndOrder).forEach((task) => {
      const duration = getEstimate(task);
      const preferred = getPreferredPeriods(task);
      const periodId = preferred.find((id) => {
        const period = PERIODS.find((item) => item.id === id);
        return period && cursors[id] + duration <= period.end;
      }) || preferred[0];
      const start = roundToQuarter(cursors[periodId]);
      cursors[periodId] = start + duration + 10;
      placements.set(getTaskId(task), { periodId, start, duration });
    });

    saveTasks(tasks.map((task) => {
      const placement = placements.get(getTaskId(task));
      return placement
        ? {
            ...task,
            dayMapDate: todayStr,
            dayMapPeriod: placement.periodId,
            dayMapStartMinutes: placement.start,
            dayMapDurationMinutes: placement.duration,
            lastUpdated: Date.now(),
          }
        : task;
    }));
    setSelectedTaskId(null);
    setPickerPeriod(null);
  };

  const handleDragEnd = ({ active, over }) => {
    const taskId = active?.data?.current?.taskId;
    const periodId = over?.id;
    if (!taskId || !PERIODS.some((period) => period.id === periodId)) return;
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
                {unscheduledTasks.length ? unscheduledTasks.map((task) => (
                  <DraggableTaskChip
                    key={getTaskId(task)}
                    task={task}
                    selected={getTaskId(task) === selectedTaskId}
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
