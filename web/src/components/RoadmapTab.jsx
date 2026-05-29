import React, { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

export default function RoadmapTab({ payload, savePayload, onOpenAddTask }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  const columns = [
    { key: "week", label: "This Week" },
    { key: "month", label: "Month" },
    { key: "quarter", label: "Quarter" },
    { key: "halfyear", label: "6 Months" },
    { key: "office", label: "Work" }
  ];

  // Active task selected for overlay details menu
  const [selectedTask, setSelectedTask] = useState(null);

  // Mobile accordion: which column is expanded
  const [expandedCol, setExpandedCol] = useState("week");

  const [confirmDialog, setConfirmDialog] = useState(null);

  // Helper: Format date as YYYY-MM-DD
  const getTodayDateString = () => {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
  };

  // Update contribution count inside the payload
  const incrementContribution = (newContributions, dateStr) => {
    const index = newContributions.findIndex((c) => c.dateString === dateStr);
    const compositeKey = `${payload.userId}_${dateStr}`;
    if (index === -1) {
      newContributions.push({
        compositeKey,
        userId: payload.userId,
        dateString: dateStr,
        count: 1,
        lastUpdated: Date.now()
      });
    } else {
      newContributions[index] = {
        ...newContributions[index],
        count: newContributions[index].count + 1,
        lastUpdated: Date.now()
      };
    }
    return newContributions;
  };

  const handleMoveToToday = (task) => {
    // 1. Calculate new orderIndex for Today tasks
    const todayTasksCount = tasks.filter((t) => t.horizonLevel === "today" && !t.isDeleted).length;

    const updatedTasks = tasks.map((t) => {
      if (t.uuid === task.uuid) {
        return {
          ...t,
          horizonLevel: "today",
          orderIndex: todayTasksCount,
          lastUpdated: Date.now()
        };
      }
      return t;
    });

    savePayload({
      ...payload,
      tasks: updatedTasks
    });
    setSelectedTask(null);
  };

  const handleMarkDone = (task) => {
    const todayDateStr = getTodayDateString();

    const updatedTasks = tasks.map((t) => {
      if (t.uuid === task.uuid) {
        return {
          ...t,
          isCompleted: true,
          isNowFocus: false,
          dateCompletedString: todayDateStr,
          lastUpdated: Date.now()
        };
      }
      return t;
    });

    savePayload({
      ...payload,
      tasks: updatedTasks,
      config: {
        ...config,
        totalXp: (Number(config.totalXp) || 0) + 100,
        lastUpdated: Date.now()
      },
      contributions: incrementContribution([...contributions], todayDateStr)
    });
    setSelectedTask(null);
  };

  const handleTriageBrainDump = (item, horizon) => {
    const userId = payload.userId || payload.config?.userId || "";
    const freshTask = {
      id: Date.now(),
      userId,
      uuid: crypto.randomUUID(),
      title: item.text,
      concreteStep: "Do first tiny step",
      horizonLevel: horizon,
      priority: "P3",
      category: "Personal",
      timeEstimateMinutes: 25,
      deadlineTimestamp: null,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      orderIndex: tasks.filter(t => t.horizonLevel === horizon && !t.isDeleted).length,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: Date.now()
    };
    const updatedDump = (payload.brainDump || []).filter(d => d.id !== item.id);
    savePayload({ ...payload, tasks: [...tasks, freshTask], brainDump: updatedDump });
  };

  const handleDeleteBrainDump = (item) => {
    savePayload({ ...payload, brainDump: (payload.brainDump || []).filter(d => d.id !== item.id) });
  };

  const handleDelete = (task) => {
    setConfirmDialog({
      message: `Delete "${task.title}"?\n\nThis cannot be undone.`,
      confirmLabel: "Delete", cancelLabel: "Cancel", danger: true,
      onConfirm: () => {
        const updatedTasks = tasks.map((t) =>
          t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t
        );
        savePayload({ ...payload, tasks: updatedTasks });
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
      onConfirm: () => {
        savePayload({ ...payload, brainDump: [] });
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  return (
    <div className="roadmap-container">
      {(payload.brainDump || []).length > 0 && (
        <section className="card" style={{marginBottom:"4px"}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"4px"}}>
            <h2 style={{fontSize:"15px", fontWeight:"800", fontFamily:"var(--font-display)", color:"var(--text-primary)", margin:0}}>
              📥 Brain Dump Inbox
            </h2>
            <button onClick={handleClearAllBrainDump}
              style={{fontSize:"11px", padding:"4px 10px", background:"none", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", color:"var(--danger)", cursor:"pointer", fontWeight:"700"}}>
              Clear all
            </button>
          </div>
          <p style={{fontSize:"11.5px", color:(payload.brainDump || []).length >= 50 ? "var(--danger)" : "var(--text-secondary)", marginBottom:"12px", fontWeight:(payload.brainDump || []).length >= 50 ? "700" : "400"}}>
            {(payload.brainDump || []).length}/50 {(payload.brainDump || []).length >= 50 ? "— inbox full! Triage before adding more." : `unprocessed idea${(payload.brainDump || []).length !== 1 ? "s" : ""}. Send each to the right horizon.`}
          </p>
          <div style={{display:"flex", flexDirection:"column", gap:"8px"}}>
            {(payload.brainDump || []).map(item => (
              <div key={item.id} style={{background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", padding:"10px 12px"}}>
                <p style={{fontSize:"13px", fontWeight:"600", color:"var(--text-primary)", marginBottom:"8px"}}>{item.text}</p>
                <div style={{display:"flex", gap:"6px", flexWrap:"wrap"}}>
                  {[["today","→ Today"],["week","→ Week"],["month","→ Month"],["quarter","→ Quarter"]].map(([h, label]) => (
                    <button key={h} className="btn" onClick={() => handleTriageBrainDump(item, h)}
                      style={{fontSize:"11px", padding:"5px 10px", background:"var(--bg-card)", color:"var(--accent)", border:"1px solid var(--accent)"}}>
                      {label}
                    </button>
                  ))}
                  <button onClick={() => handleDeleteBrainDump(item)}
                    style={{fontSize:"11px", padding:"5px 10px", background:"none", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", color:"var(--danger)", cursor:"pointer"}}>
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div>
        <h2 className="roadmap-board-title">Horizon Planning Board</h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Map your goals strategically across time-horizons. Tap a card to edit.
        </p>
      </div>

      <div className="roadmap-scroll-container">
        {columns.map((col) => {
          const colTasks = tasks
            .filter((t) => t.horizonLevel === col.key && !t.isDeleted && !t.isCompleted)
            // Fix #19: sort by orderIndex for consistent display order
            .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

          const isExpanded = expandedCol === col.key;

          return (
            <div key={col.key} className={`roadmap-column${isExpanded ? " expanded" : ""}`}>
              <div
                className="column-header"
                onClick={() => setExpandedCol(isExpanded ? "" : col.key)}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <span className="column-title">{col.label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="column-count">{colTasks.length}</span>
                  <button
                    className="column-add-btn"
                    onClick={(e) => { e.stopPropagation(); onOpenAddTask(col.key); }}
                    title={`Add task directly to ${col.label}`}
                  >
                    +
                  </button>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                </div>
              </div>

              <div className={`column-tasks-list${isExpanded ? " col-expanded" : " col-collapsed"}`}>
                {colTasks.length === 0 ? (
                  <div className="roadmap-empty-state">
                    No tasks here. Add some via + button.
                  </div>
                ) : (
                  colTasks.map((task) => (
                    <div
                      key={task.uuid}
                      className="roadmap-task-card"
                      onClick={() => setSelectedTask(task)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "6px" }}>
                        <span className="roadmap-task-title">{task.title}</span>
                        <span className={`priority-badge ${task.priority.toLowerCase()}`} style={{ flexShrink: 0 }}>
                          {task.priority}
                        </span>
                      </div>
                      {task.concreteStep && (
                        <span className="roadmap-task-step">⚡ {task.concreteStep}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task Interaction Overlay Menu Dialog */}
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
              <button
                className="btn"
                onClick={() => handleMarkDone(selectedTask)}
                style={{ background: "var(--success)" }}
              >
                ✓ Mark Done (+100 XP)
              </button>
              <button
                className="btn btn-cancel"
                onClick={() => handleDelete(selectedTask)}
                style={{ color: "var(--danger)", border: "1.5px solid var(--border)" }}
              >
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
