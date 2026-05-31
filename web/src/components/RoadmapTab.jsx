import React, { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { celebrate } from "../utils/celebrations";
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, DragOverlay
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableRoadmapCard({ id, task, onTaskClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        position: "relative",
      }}
    >
      <div
        className="roadmap-task-card"
        onClick={() => onTaskClick(task)}
        style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}
      >
        <button
          {...listeners}
          {...attributes}
          style={{
            background: "none", border: "none", cursor: "grab",
            color: "var(--text-muted)", opacity: 0.3, padding: "2px 4px",
            flexShrink: 0, lineHeight: 1, fontSize: "14px", marginTop: "1px",
            touchAction: "none",
          }}
          onClick={e => e.stopPropagation()}
          aria-label="Drag to reorder"
        >
          ⠿
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "6px" }}>
            <span className="roadmap-task-title">{task.title}</span>
            <span className={`priority-badge ${task.priority?.toLowerCase() || "p3"}`} style={{ flexShrink: 0 }}>
              {task.priority}
            </span>
          </div>
          {task.concreteStep && (
            <span className="roadmap-task-step">⚡ {task.concreteStep}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SortableRoadmapList({ colKey, colTasks, tasks, payload, savePayload, onTaskClick }) {
  const [activeId, setActiveId] = useState(null);
  const getKey = (t) => t.uuid || String(t.id);
  const ids = colTasks.map(getKey);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const oldIdx = colTasks.findIndex(t => getKey(t) === active.id);
    const newIdx = colTasks.findIndex(t => getKey(t) === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove([...colTasks], oldIdx, newIdx);
    const orderMap = new Map(reordered.map((t, i) => [getKey(t), i]));
    savePayload({ ...payload, tasks: tasks.map(t =>
      orderMap.has(getKey(t)) ? { ...t, orderIndex: orderMap.get(getKey(t)), lastUpdated: Date.now() } : t
    )});
  };

  if (colTasks.length === 0) {
    return <div className="roadmap-empty-state">No tasks here. Tap + to add one.</div>;
  }

  const activeTask = activeId ? colTasks.find(t => getKey(t) === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {colTasks.map(task => (
          <SortableRoadmapCard
            key={getKey(task)}
            id={getKey(task)}
            task={task}
            onTaskClick={onTaskClick}
          />
        ))}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div style={{
            background: "var(--bg-card)",
            border: "1.5px solid var(--accent)",
            borderRadius: "10px",
            padding: "10px 12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
            transform: "rotate(0.8deg) scale(1.02)",
            opacity: 0.95,
            fontSize: "13px",
            fontWeight: "700",
            color: "var(--text-primary)"
          }}>
            {activeTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default function RoadmapTab({ payload, savePayload, onOpenAddTask, onEditTask }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  const columns = [
    { key: "week",     label: "This Week",  shortLabel: "Week"  },
    { key: "month",    label: "Month",      shortLabel: "Month" },
    { key: "quarter",  label: "Quarter",    shortLabel: "Quarter"  },
    { key: "halfyear", label: "6 Months",   shortLabel: "6 Months" },
    { key: "office",   label: "Work",       shortLabel: "Work"  }
  ];

  const [selectedTask, setSelectedTask] = useState(null);
  // "week" by default; "inbox" when brain dump pill is selected on mobile
  const [expandedCol, setExpandedCol] = useState("week");
  const [confirmDialog, setConfirmDialog] = useState(null);

  const getTodayDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const incrementContribution = (newContributions, dateStr) => {
    const index = newContributions.findIndex((c) => c.dateString === dateStr);
    const uid = payload.userId || payload.config?.userId || "";
    const compositeKey = `${uid}_${dateStr}`;
    if (index === -1) {
      newContributions.push({ compositeKey, userId: uid, dateString: dateStr, count: 1, lastUpdated: Date.now() });
    } else {
      newContributions[index] = { ...newContributions[index], count: newContributions[index].count + 1, lastUpdated: Date.now() };
    }
    return newContributions;
  };

  const handleMoveToToday = (task) => {
    const todayTasksCount = tasks.filter((t) => t.horizonLevel === "today" && !t.isDeleted).length;
    savePayload({
      ...payload,
      tasks: tasks.map((t) =>
        t.uuid === task.uuid ? { ...t, horizonLevel: "today", orderIndex: todayTasksCount, lastUpdated: Date.now() } : t
      )
    });
    setSelectedTask(null);
  };

  const handleMarkDone = (task) => {
    celebrate();
    const todayDateStr = getTodayDateString();
    savePayload({
      ...payload,
      tasks: tasks.map((t) =>
        t.uuid === task.uuid ? { ...t, isCompleted: true, isNowFocus: false, dateCompletedString: todayDateStr, lastUpdated: Date.now() } : t
      ),
      config: { ...config, totalXp: (Number(config.totalXp) || 0) + 100, lastUpdated: Date.now() },
      contributions: incrementContribution([...contributions], todayDateStr)
    });
    setSelectedTask(null);
  };

  const handleTriageBrainDump = (item, horizon) => {
    const userId = payload.userId || payload.config?.userId || "";
    const freshTask = {
      id: Date.now(), userId,
      uuid: safeUUID(),
      title: item.text,
      concreteStep: "Do first tiny step",
      horizonLevel: horizon,
      priority: "P3",
      category: "Personal",
      timeEstimateMinutes: 25,
      deadlineTimestamp: null,
      isCompleted: false, isParked: false, isNowFocus: false,
      orderIndex: tasks.filter(t => t.horizonLevel === horizon && !t.isDeleted).length,
      dateCompletedString: null, isDeleted: false, lastUpdated: Date.now()
    };
    savePayload({ ...payload, tasks: [...tasks, freshTask], brainDump: (payload.brainDump || []).filter(d => d.id !== item.id) });
  };

  const handleDeleteBrainDump = (item) => {
    savePayload({ ...payload, brainDump: (payload.brainDump || []).filter(d => d.id !== item.id) });
  };

  const handleDelete = (task) => {
    setConfirmDialog({
      message: `Delete "${task.title}"?\n\nThis cannot be undone.`,
      confirmLabel: "Delete", cancelLabel: "Cancel", danger: true,
      onConfirm: () => {
        savePayload({ ...payload, tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t) });
        setSelectedTask(null);
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  const handleClearAllBrainDump = () => {
    setConfirmDialog({
      message: `Clear all ${(payload.brainDump || []).length} brain dump items?\n\nThis cannot be undone.`,
      confirmLabel: "Clear all", cancelLabel: "Cancel", danger: true,
      onConfirm: () => { savePayload({ ...payload, brainDump: [] }); setConfirmDialog(null); },
      onCancel: () => setConfirmDialog(null)
    });
  };

  // Shared task list renderer used by both mobile panel and desktop column
  const renderTaskList = (colKey) => {
    const colTasks = tasks
      .filter(t => t.horizonLevel === colKey && !t.isDeleted && !t.isCompleted)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    return (
      <SortableRoadmapList
        colKey={colKey}
        colTasks={colTasks}
        tasks={tasks}
        payload={payload}
        savePayload={savePayload}
        onTaskClick={setSelectedTask}
      />
    );
  };

  const brainDump = payload.brainDump || [];
  const currentCol = columns.find(c => c.key === expandedCol);
  const useCompact = (config.roadmapStyle || "compact") !== "grid";

  // ── Shared: pill + panel layout (compact mode, works at all screen sizes) ──
  const renderCompactLayout = () => (
    <div className="roadmap-compact-layout">
      <div className="horizon-pills" role="tablist">
        {brainDump.length > 0 && (
          <button role="tab" className={`horizon-pill${expandedCol === "inbox" ? " active" : ""}`} onClick={() => setExpandedCol("inbox")}>
            📥 Inbox <span className="pill-badge">{brainDump.length}</span>
          </button>
        )}
        {columns.map(col => {
          const count = tasks.filter(t => t.horizonLevel === col.key && !t.isDeleted && !t.isCompleted).length;
          return (
            <button key={col.key} role="tab"
              className={`horizon-pill${expandedCol === col.key ? " active" : ""}`}
              onClick={() => setExpandedCol(col.key)}
            >
              {col.shortLabel}
              {count > 0 && <span className="pill-badge">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="horizon-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)" }}>
            {expandedCol === "inbox" ? "📥 Brain Dump Inbox" : currentCol?.label || ""}
          </span>
          {expandedCol !== "inbox" && (
            <button className="column-add-btn" onClick={() => onOpenAddTask(expandedCol)}
              style={{ width: "28px", height: "28px", fontSize: "18px", borderRadius: "50%", flexShrink: 0 }}
              title={`Add task to ${currentCol?.label}`}>+</button>
          )}
          {expandedCol === "inbox" && brainDump.length > 0 && (
            <button onClick={handleClearAllBrainDump}
              style={{ fontSize: "11px", padding: "4px 10px", background: "none", border: "1px solid var(--danger)", borderRadius: "var(--radius-sm)", color: "var(--danger)", cursor: "pointer", fontWeight: "700" }}>
              Clear all
            </button>
          )}
        </div>

        {expandedCol === "inbox" ? (
          brainDump.length === 0 ? (
            <div className="roadmap-empty-state">Brain dump is empty. Use the 📝 button on the Home tab to capture thoughts.</div>
          ) : (
            <>
              <p style={{ fontSize: "11.5px", color: brainDump.length >= 50 ? "var(--danger)" : "var(--text-secondary)", fontWeight: brainDump.length >= 50 ? "700" : "400" }}>
                {brainDump.length}/50 {brainDump.length >= 50 ? "— inbox full! Triage before adding more." : `item${brainDump.length !== 1 ? "s" : ""}. Send each to the right horizon.`}
              </p>
              {brainDump.map(item => (
                <div key={item.id} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "8px" }}>{item.text}</p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {[["today","Today"],["week","Week"],["month","Month"],["quarter","Qtr"]].map(([h, label]) => (
                      <button key={h} className="btn" onClick={() => handleTriageBrainDump(item, h)}
                        style={{ fontSize: "11px", padding: "5px 10px", background: "var(--bg-card)", color: "var(--accent)", border: "1px solid var(--accent)" }}>
                        → {label}
                      </button>
                    ))}
                    <button onClick={() => handleDeleteBrainDump(item)}
                      style={{ fontSize: "11px", padding: "5px 10px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--danger)", cursor: "pointer" }}>
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </>
          )
        ) : (
          renderTaskList(expandedCol)
        )}
      </div>
    </div>
  );

  // ── Shared: accordion grid layout (grid mode, works at all screen sizes) ──
  const renderGridLayout = () => (
    <>
      {brainDump.length > 0 && (
        <section className="card" style={{ marginBottom: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: "800", fontFamily: "var(--font-display)", color: "var(--text-primary)", margin: 0 }}>
              📥 Brain Dump Inbox
            </h2>
            <button onClick={handleClearAllBrainDump}
              style={{ fontSize: "11px", padding: "4px 10px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--danger)", cursor: "pointer", fontWeight: "700" }}>
              Clear all
            </button>
          </div>
          <p style={{ fontSize: "11.5px", color: brainDump.length >= 50 ? "var(--danger)" : "var(--text-secondary)", marginBottom: "12px", fontWeight: brainDump.length >= 50 ? "700" : "400" }}>
            {brainDump.length}/50 {brainDump.length >= 50 ? "— inbox full! Triage before adding more." : `unprocessed idea${brainDump.length !== 1 ? "s" : ""}. Send each to the right horizon.`}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {brainDump.map(item => (
              <div key={item.id} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "8px" }}>{item.text}</p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {[["today","→ Today"],["week","→ Week"],["month","→ Month"],["quarter","→ Quarter"]].map(([h, label]) => (
                    <button key={h} className="btn" onClick={() => handleTriageBrainDump(item, h)}
                      style={{ fontSize: "11px", padding: "5px 10px", background: "var(--bg-card)", color: "var(--accent)", border: "1px solid var(--accent)" }}>
                      {label}
                    </button>
                  ))}
                  <button onClick={() => handleDeleteBrainDump(item)}
                    style={{ fontSize: "11px", padding: "5px 10px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--danger)", cursor: "pointer" }}>
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="roadmap-scroll-container">
        {columns.map((col) => {
          const colTasks = tasks
            .filter((t) => t.horizonLevel === col.key && !t.isDeleted && !t.isCompleted)
            .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
          const isExpanded = expandedCol === col.key;
          return (
            <div key={col.key} className={`roadmap-column${isExpanded ? " expanded" : ""}`}>
              <div className="column-header" onClick={() => setExpandedCol(isExpanded ? "" : col.key)} style={{ cursor: "pointer", userSelect: "none" }}>
                <span className="column-title">{col.label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="column-count">{colTasks.length}</span>
                  <button className="column-add-btn" onClick={(e) => { e.stopPropagation(); onOpenAddTask(col.key); }} title={`Add task directly to ${col.label}`}>+</button>
                  <span style={{ fontSize: "18px", color: "var(--text-primary)", fontWeight: "700", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                </div>
              </div>
              <div className={`column-tasks-list${isExpanded ? " col-expanded" : " col-collapsed"}`}>
                <SortableRoadmapList
                  colKey={col.key}
                  colTasks={colTasks}
                  tasks={tasks}
                  payload={payload}
                  savePayload={savePayload}
                  onTaskClick={setSelectedTask}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="roadmap-container">
      <div>
        <h2 className="roadmap-board-title">Horizon Planning</h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Map your goals strategically across time horizons. Tap a card to manage.
        </p>
      </div>

      {useCompact ? renderCompactLayout() : renderGridLayout()}

      {/* Task management overlay */}
      {selectedTask && (
        <div className="modal-overlay" onClick={() => setSelectedTask(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "360px" }}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ fontSize: "16px" }}>Manage Commitment</h2>
              <button className="close-btn" onClick={() => setSelectedTask(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ marginBottom: "8px" }}>
                <span className={`priority-badge ${selectedTask.priority.toLowerCase()}`} style={{ marginBottom: "6px", display: "inline-block" }}>
                  {selectedTask.priority}
                </span>
                <h4 style={{ fontSize: "15px", fontWeight: "600", color: "var(--text-primary)", lineHeight: "1.4" }}>
                  {selectedTask.title}
                </h4>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                  Micro step: {selectedTask.concreteStep}
                </p>
              </div>
              <button className="btn" onClick={() => handleMoveToToday(selectedTask)}>
                🚀 Move to Today
              </button>
              {onEditTask && (
                <button className="btn" onClick={() => { onEditTask(selectedTask); setSelectedTask(null); }}
                  style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1.5px solid var(--border)", boxShadow: "none" }}>
                  ✏ Edit task
                </button>
              )}
              <button className="btn" onClick={() => handleMarkDone(selectedTask)} style={{ background: "var(--success)" }}>
                ✓ Mark Done (+100 XP)
              </button>
              <button className="btn btn-cancel" onClick={() => handleDelete(selectedTask)}
                style={{ color: "var(--danger)", border: "1.5px solid var(--border)" }}>
                🗑 Delete Task
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  );
}
