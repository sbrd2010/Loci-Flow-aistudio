import React, { useState, useRef, useEffect } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { celebrate } from "../utils/celebrations";
import { getAIKeys, callAI, hasAIKey, extractJsonArray } from "../utils/aiCall";
import { sanitizeTaskField, CATEGORY_ICONS, byPriorityThenOrder } from "../utils/taskOps";
import { getFocusWindows, getLociDayStr } from "../utils/focusWindows";
import { safeCopyToClipboard } from "../utils/clipboard";
import { buildTaskMutationEvent, eventPatch, eventsPatch } from "../utils/activityLog";
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, DragOverlay
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import LinkifyText from "./LinkifyText";

function SortableRoadmapCard({ id, task, onTaskClick, interactionStyle = "classic" }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const isDragAnywhere = interactionStyle === "dragAnywhere";
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
        ref={isDragAnywhere ? setActivatorNodeRef : undefined}
        className="roadmap-task-card"
        onClick={() => onTaskClick(task)}
        {...(isDragAnywhere ? {
          ...listeners,
          tabIndex: attributes?.tabIndex,
          "aria-disabled": attributes?.["aria-disabled"],
          "aria-describedby": attributes?.["aria-describedby"],
        } : {})}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          ...(isDragAnywhere ? { cursor: "grab" } : {}),
        }}
      >
        {!isDragAnywhere && (
          <button
            {...listeners}
            {...attributes}
            style={{
              background: "none", border: "none", cursor: "grab",
              color: "var(--text-muted)", opacity: 0.3, padding: "2px 3px",
              flexShrink: 0, lineHeight: 1, fontSize: "13px",
              touchAction: "none",
            }}
            onClick={e => e.stopPropagation()}
            aria-label="Drag to reorder"
          >
            ⠿
          </button>
        )}
        <span className={`priority-badge ${task.priority?.toLowerCase() || "p3"}`} style={{ flexShrink: 0 }}>
          {task.priority || "P3"}
        </span>
        {task.isHorizonPinned && (
          <span title="Pinned to top" aria-label="Pinned to top" style={{ flexShrink: 0, fontSize: "12px" }}>📌</span>
        )}
        {CATEGORY_ICONS[task.category] && (
          <span className="task-category-icon" title={task.category} aria-label={task.category}>
            {CATEGORY_ICONS[task.category]}
          </span>
        )}
        <span className="roadmap-task-title" style={{ flex: 1, minWidth: 0 }}><LinkifyText text={task.title} /></span>
        {task.subSteps && task.subSteps.length > 0 && (
          <span
            title={`${task.subSteps.filter(s => s.done).length}/${task.subSteps.length} steps done`}
            style={{ flexShrink: 0, fontSize: "11px", color: "var(--text-muted)" }}
          >
            ☑ {task.subSteps.filter(s => s.done).length}/{task.subSteps.length}
          </span>
        )}
        {isDragAnywhere && (
          <button
            className="task-row-kebab-btn"
            onClick={e => { e.stopPropagation(); onTaskClick(task); }}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            aria-label="Task options"
            title="Task options"
          >⋮</button>
        )}
      </div>
    </div>
  );
}

function SortableRoadmapList({ colKey, colTasks, tasks, payload, savePayload, onTaskClick }) {
  const interactionStyle = payload?.config?.taskRowInteractionStyle === "dragAnywhere" ? "dragAnywhere" : "classic";
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
    // colTasks is already pin-sorted-first; reordering across the whole column
    // would overwrite the *other* pin tier's orderIndex on every drag (its tasks
    // didn't move but would still get renumbered). Scope the reorder to tasks
    // sharing the dragged task's pin status, and no-op a drag across the
    // pin/unpinned boundary — pin status alone decides that ordering, not orderIndex.
    const draggedPinned = !!colTasks[oldIdx].isHorizonPinned;
    if (!!colTasks[newIdx].isHorizonPinned !== draggedPinned) return;
    const tier = colTasks.filter(t => !!t.isHorizonPinned === draggedPinned);
    const tierOldIdx = tier.findIndex(t => getKey(t) === active.id);
    const tierNewIdx = tier.findIndex(t => getKey(t) === over.id);
    const reordered = arrayMove([...tier], tierOldIdx, tierNewIdx);
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
            interactionStyle={interactionStyle}
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

export default function RoadmapTab({ payload, savePayload, savePayloadAsync, onOpenAddTask, onEditTask, initialExpandedCol, uid, writeActivityEvents }) {
  const { tasks = [], config = {}, contributions = [] } = payload;
  const windows = getFocusWindows(config);

  const columns = [
    { key: "week",     label: "This Week",  shortLabel: "Week"  },
    { key: "month",    label: "Month",      shortLabel: "Month" },
    { key: "quarter",  label: "Quarter",    shortLabel: "Quarter"  },
    { key: "halfyear", label: "6 Months",   shortLabel: "6 Months" },
    { key: "office",   label: "Work",       shortLabel: "Work"  }
  ];

  const [selectedTask, setSelectedTask] = useState(null);
  // "week" by default; "inbox" when brain dump pill is selected on mobile,
  // or when navigated here via initialExpandedCol (e.g. Mind Box's inbox link)
  const [expandedCol, setExpandedCol] = useState(initialExpandedCol || "week");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [undoTask, setUndoTask] = useState(null);
  const undoTimeoutRef = useRef(null);
  // Brain dump deletion is confirmed via a deferred onConfirm callback — by the
  // time the user clicks "Delete", `payload` in that closure may be stale (e.g.
  // a background save landed while the dialog was open). Track the latest
  // payload in a ref so the delete reads/writes current data, not a snapshot.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef(null);
  const [longDumpWarning, setLongDumpWarning] = useState(null); // {id, horizon}
  const [aiBreakdownSuggestion, setAiBreakdownSuggestion] = useState(null); // {id, items: [{title, concreteStep}], noKey, error}
  const [aiBreakdownLoading, setAiBreakdownLoading] = useState(null); // item.id
  const [editingDumpItem, setEditingDumpItem] = useState(null); // {id, text}

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const openTask = (task) => {
    setCopied(false);
    setSelectedTask(task);
  };

  const handleCopy = (task) => {
    const text = task.concreteStep && task.concreteStep !== "Do first tiny step"
      ? `${task.title}\n${task.concreteStep}`
      : task.title;
    safeCopyToClipboard(text).then(ok => {
      if (!ok) return;
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopied(true);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 900);
    });
  };

  const isVisibleRoadmapTask = (t) => !t.isDeleted && !t.isCompleted && !t.isParked;

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
    const todayTasksCount = tasks.filter((t) => t.horizonLevel === "today" && isVisibleRoadmapTask(t)).length;
    savePayloadAsync({
      ...payload,
      tasks: tasks.map((t) =>
        t.uuid === task.uuid ? { ...t, horizonLevel: "today", orderIndex: todayTasksCount, lastUpdated: Date.now() } : t
      )
    })
      .then(() => {
        const event = buildTaskMutationEvent("task_moved", task, {
          fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: "today" }, windows,
        });
        writeActivityEvents(eventPatch(uid, event));
      })
      .catch(() => {});
    setSelectedTask(null);
  };

  const handleTogglePin = (task) => {
    savePayload({
      ...payload,
      tasks: tasks.map((t) =>
        t.uuid === task.uuid ? { ...t, isHorizonPinned: !t.isHorizonPinned, lastUpdated: Date.now() } : t
      )
    });
    setSelectedTask(null);
  };

  const handleMarkDone = (task) => {
    celebrate();
    const todayDateStr = getTodayDateString();
    const lociTodayStr = getLociDayStr(new Date(), getFocusWindows(config));
    savePayloadAsync({
      ...payload,
      tasks: tasks.map((t) =>
        t.uuid === task.uuid ? { ...t, isCompleted: true, isNowFocus: false, dateCompletedString: lociTodayStr, lastUpdated: Date.now() } : t
      ),
      config: { ...config, totalXp: (Number(config.totalXp) || 0) + 100, lastUpdated: Date.now() },
      contributions: incrementContribution([...contributions], todayDateStr)
    })
      .then(() => writeActivityEvents(eventPatch(uid, buildTaskMutationEvent("task_completed", task, { windows }))))
      .catch(() => {});
    setSelectedTask(null);
  };

  const doTriageBrainDump = (item, horizon, overrideText) => {
    const userId = payload.userId || payload.config?.userId || "";
    const titleText = overrideText !== undefined ? overrideText : item.text;
    const freshTask = {
      id: Date.now(), userId, uuid: safeUUID(),
      title: sanitizeTaskField(titleText, 1000) || "Untitled task",
      concreteStep: "Do first tiny step",
      horizonLevel: horizon, priority: "P3", category: "Personal",
      timeEstimateMinutes: 25, deadlineTimestamp: null,
      isCompleted: false, isParked: false, isNowFocus: false,
      orderIndex: tasks.filter(t => t.horizonLevel === horizon && isVisibleRoadmapTask(t)).length,
      dateCompletedString: null, isDeleted: false, lastUpdated: Date.now()
    };
    savePayloadAsync({ ...payload, tasks: [...tasks, freshTask], brainDump: (payload.brainDump || []).filter(d => d.id !== item.id) })
      .then(() => writeActivityEvents(eventPatch(uid, buildTaskMutationEvent("task_created", freshTask, { windows }))))
      .catch(() => {});
    setLongDumpWarning(null);
    setAiBreakdownSuggestion(null);
    setEditingDumpItem(null);
  };

  const handleTriageBrainDump = (item, horizon) => {
    const text = editingDumpItem?.id === item.id ? editingDumpItem.text : item.text;
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > 20) {
      setLongDumpWarning({ id: item.id, horizon });
      return;
    }
    doTriageBrainDump(item, horizon, editingDumpItem?.id === item.id ? editingDumpItem.text : undefined);
  };

  const handleDeleteBrainDump = (item) => {
    setConfirmDialog({
      message: "Delete this brain dump item?",
      confirmLabel: "Delete", cancelLabel: "Keep it", danger: true,
      onConfirm: () => {
        const latest = payloadRef.current;
        savePayload({ ...latest, brainDump: (latest.brainDump || []).filter(d => d.id !== item.id) });
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  const MAX_BREAKDOWN_ITEMS = 6;

  const handleAIBreakdown = async (item) => {
    const textToBreakdown = editingDumpItem?.id === item.id ? editingDumpItem.text : item.text;
    if (!hasAIKey()) {
      setAiBreakdownSuggestion({ id: item.id, items: [], noKey: true });
      return;
    }
    setAiBreakdownLoading(item.id);
    try {
      const keys = getAIKeys();
      const prompt = `Here is a raw brain dump note:
"${textToBreakdown}"

Turn it into 1-${MAX_BREAKDOWN_ITEMS} clear, atomic, actionable tasks — one task per distinct action in the note. If the note only contains one real action, return a single task; don't pad the list with filler.

Hard rules:
- Never merge unrelated points into one task, and never write a vague catch-all title
- Titles are action-style and specific (max 60 chars) — keep the concrete subject: names, dates, amounts, tools, places
- Every task has a concreteStep: the single easiest first physical/digital action (max 60 chars)
- Preserve concrete details from the note in the concreteStep or a follow-up task rather than dropping them just to keep a title short

Return ONLY a JSON array of objects like {"title": "...", "concreteStep": "..."}, no markdown, no explanation.`;
      const result = await callAI({
        ...keys,
        systemPrompt: "You are a productivity assistant. Respond ONLY with a valid JSON array, no markdown. Preserve every concrete detail from the input — never compress or summarize away names, dates, deadlines, amounts, or other specifics to save space.",
        messages: [{ role: "user", content: prompt }],
        // Headroom for up to MAX_BREAKDOWN_ITEMS title+concreteStep objects —
        // 600 was tight enough that a truncated mid-array response (non-empty,
        // so no provider retries it) would silently collapse to the one-item
        // fallback below, defeating the point of asking for multiple tasks.
        maxTokens: 1500,
        reasoningEffort: "low",
      });
      let parsed;
      try {
        parsed = extractJsonArray(result);
      } catch {
        parsed = [{ title: textToBreakdown.substring(0, 60), concreteStep: "Do first tiny step" }];
      }
      const items = parsed
        .filter(t => t && typeof t.title === "string" && t.title.trim())
        .slice(0, MAX_BREAKDOWN_ITEMS)
        .map(t => ({
          title: sanitizeTaskField(t.title, 1000) || textToBreakdown.substring(0, 60),
          concreteStep: sanitizeTaskField(t.concreteStep, 300) || "Do first tiny step"
        }));
      setAiBreakdownSuggestion({
        id: item.id,
        items: items.length ? items : [{ title: textToBreakdown.substring(0, 60), concreteStep: "Do first tiny step" }]
      });
    } catch {
      setAiBreakdownSuggestion({ id: item.id, items: [], error: true });
    }
    setAiBreakdownLoading(null);
  };

  const handleConfirmAISuggestion = (item) => {
    if (!aiBreakdownSuggestion || aiBreakdownSuggestion.id !== item.id || !aiBreakdownSuggestion.items?.length) return;
    const horizon = longDumpWarning?.horizon || "today";
    const userId = payload.userId || payload.config?.userId || "";
    const baseOrderIndex = tasks.filter(t => t.horizonLevel === horizon && isVisibleRoadmapTask(t)).length;
    const freshTasks = aiBreakdownSuggestion.items.map((suggestion, i) => ({
      id: Date.now() + i, userId, uuid: safeUUID(),
      title: suggestion.title,
      concreteStep: suggestion.concreteStep || "Do first tiny step",
      horizonLevel: horizon, priority: "P3", category: "Personal",
      timeEstimateMinutes: 25, deadlineTimestamp: null,
      isCompleted: false, isParked: false, isNowFocus: false,
      orderIndex: baseOrderIndex + i,
      dateCompletedString: null, isDeleted: false, lastUpdated: Date.now()
    }));
    savePayloadAsync({ ...payload, tasks: [...tasks, ...freshTasks], brainDump: (payload.brainDump || []).filter(d => d.id !== item.id) })
      .then(() => {
        const events = freshTasks.map((t) => buildTaskMutationEvent("task_created", t, { windows }));
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    setLongDumpWarning(null);
    setAiBreakdownSuggestion(null);
    setEditingDumpItem(null);
  };

  const handleDelete = (task) => {
    setConfirmDialog({
      message: `Delete "${task.title}"?\n\nYou can undo this for a few seconds after deleting.`,
      confirmLabel: "Delete", cancelLabel: "Cancel", danger: true,
      onConfirm: () => {
        savePayloadAsync({ ...payload, tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t) })
          .then(() => writeActivityEvents(eventPatch(uid, buildTaskMutationEvent("task_deleted", task, { windows }))))
          .catch(() => {});
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        setUndoTask(task);
        undoTimeoutRef.current = setTimeout(() => setUndoTask(null), 5000);
        setSelectedTask(null);
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  const handleUndoDelete = () => {
    if (!undoTask) return;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    savePayloadAsync({ ...payload, tasks: tasks.map((t) => t.uuid === undoTask.uuid ? { ...t, isDeleted: false, lastUpdated: Date.now() } : t) })
      .then(() => writeActivityEvents(eventPatch(uid, buildTaskMutationEvent("task_restored", undoTask, { windows }))))
      .catch(() => {});
    setUndoTask(null);
  };

  const handleClearAllBrainDump = () => {
    setConfirmDialog({
      message: `Clear all ${(payload.brainDump || []).length} brain dump items?\n\nThis cannot be undone.`,
      confirmLabel: "Clear all", cancelLabel: "Cancel", danger: true,
      onConfirm: () => { savePayload({ ...payload, brainDump: [] }); setConfirmDialog(null); },
      onCancel: () => setConfirmDialog(null)
    });
  };

  const renderDumpItem = (item) => {
    const isWarning = longDumpWarning?.id === item.id;
    const isLoadingAI = aiBreakdownLoading === item.id;
    const hasSuggestion = aiBreakdownSuggestion?.id === item.id;
    const isEditing = editingDumpItem?.id === item.id;
    const showHorizonBtns = !isWarning && !isLoadingAI && !hasSuggestion;

    return (
      <div key={item.id} data-testid="dump-item" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 12px", marginBottom: "8px" }}>
        {isEditing ? (
          <textarea
            value={editingDumpItem.text}
            onChange={e => setEditingDumpItem({ id: item.id, text: e.target.value })}
            style={{ width: "100%", fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", background: "var(--bg-card)", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", padding: "6px 8px", marginBottom: "8px", resize: "vertical", minHeight: "60px", fontFamily: "inherit", boxSizing: "border-box" }}
          />
        ) : (
          <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "8px" }}>{item.text}</p>
        )}

        {isWarning && !hasSuggestion && !isLoadingAI && (
          <div style={{ marginBottom: "8px" }}>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" }}>
              {isEditing ? "Edited above — break it down or move as-is." : "This note is long. Edit first, break it down, or move as-is."}
            </p>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {!isEditing && (
                <button
                  onClick={() => setEditingDumpItem({ id: item.id, text: item.text })}
                  style={{ fontSize: "11px", padding: "5px 10px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", cursor: "pointer" }}>
                  ✏ Edit first
                </button>
              )}
              <button
                onClick={() => handleAIBreakdown(item)}
                style={{ fontSize: "11px", padding: "5px 10px", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", color: "#fff", cursor: "pointer" }}>
                ✦ Break down
              </button>
              <button
                onClick={() => doTriageBrainDump(item, longDumpWarning.horizon, isEditing ? editingDumpItem.text : undefined)}
                style={{ fontSize: "11px", padding: "5px 10px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-secondary)", cursor: "pointer" }}>
                Move as-is
              </button>
              <button
                onClick={() => { setLongDumpWarning(null); setEditingDumpItem(null); }}
                style={{ fontSize: "11px", padding: "5px 10px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoadingAI && (
          <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>✦ Breaking down with AI...</p>
        )}

        {hasSuggestion && (
          <div style={{ marginBottom: "8px" }}>
            {aiBreakdownSuggestion.items?.length ? (
              <>
                <p style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                  AI suggestion{aiBreakdownSuggestion.items.length > 1 ? ` (${aiBreakdownSuggestion.items.length} tasks)` : ""}
                </p>
                {aiBreakdownSuggestion.items.map((suggestion, i) => (
                  <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", padding: "8px 10px", marginBottom: "6px" }}>
                    <p style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "2px" }}>{suggestion.title}</p>
                    {suggestion.concreteStep && (
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>⚡ {suggestion.concreteStep}</p>
                    )}
                  </div>
                ))}
              </>
            ) : aiBreakdownSuggestion.noKey ? (
              <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "6px" }}>🔑 Add an AI key in Settings → AI Keys to use this. Edit or move as-is.</p>
            ) : (
              <p style={{ fontSize: "11px", color: "var(--danger)", marginBottom: "6px" }}>AI unavailable. Edit or move as-is.</p>
            )}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {aiBreakdownSuggestion.items?.length > 0 && (
                <button
                  onClick={() => handleConfirmAISuggestion(item)}
                  style={{ fontSize: "11px", padding: "5px 12px", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", color: "#fff", cursor: "pointer", fontWeight: "700" }}>
                  {aiBreakdownSuggestion.items.length > 1 ? `Use these (${aiBreakdownSuggestion.items.length}) →` : "Use this →"}
                </button>
              )}
              <button
                onClick={() => doTriageBrainDump(item, longDumpWarning?.horizon || "today", editingDumpItem?.id === item.id ? editingDumpItem.text : undefined)}
                style={{ fontSize: "11px", padding: "5px 10px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-secondary)", cursor: "pointer" }}>
                Move as-is
              </button>
              <button
                onClick={() => { setAiBreakdownSuggestion(null); setLongDumpWarning(null); setEditingDumpItem(null); }}
                style={{ fontSize: "11px", padding: "5px 10px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {showHorizonBtns && (
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
        )}
      </div>
    );
  };

  // Shared task list renderer used by both mobile panel and desktop column
  const renderTaskList = (colKey) => {
    const colTasks = tasks
      .filter(t => t.horizonLevel === colKey && isVisibleRoadmapTask(t))
      .sort(byPriorityThenOrder);
    return (
      <SortableRoadmapList
        colKey={colKey}
        colTasks={colTasks}
        tasks={tasks}
        payload={payload}
        savePayload={savePayload}
        onTaskClick={openTask}
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
          const count = tasks.filter(t => t.horizonLevel === col.key && isVisibleRoadmapTask(t)).length;
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

      <div className="horizon-panel" style={{ paddingBottom: "80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)" }}>
            {expandedCol === "inbox" ? "📥 Brain Dump Inbox" : currentCol?.label || ""}
            {expandedCol !== "inbox" && <span className="roadmap-sort-hint">Sorted by priority</span>}
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
              {brainDump.map(item => renderDumpItem(item))}
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
            {brainDump.map(item => renderDumpItem(item))}
          </div>
        </section>
      )}
      <div className="roadmap-scroll-container">
        {columns.map((col) => {
          const colTasks = tasks
            .filter((t) => t.horizonLevel === col.key && isVisibleRoadmapTask(t))
            .sort(byPriorityThenOrder);
          const isExpanded = expandedCol === col.key;
          return (
            <div key={col.key} className={`roadmap-column${isExpanded ? " expanded" : ""}`}>
              <div className="column-header" onClick={() => setExpandedCol(isExpanded ? "" : col.key)} style={{ cursor: "pointer", userSelect: "none" }}>
                <span className="column-title">{col.label}<span className="roadmap-sort-hint">Sorted by priority</span></span>
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
                  onTaskClick={openTask}
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
                <span className={`priority-badge ${(selectedTask.priority || "P3").toLowerCase()}`} style={{ marginBottom: "6px", display: "inline-block" }}>
                  {selectedTask.priority || "P3"}
                </span>
                {selectedTask.isHorizonPinned && (
                  <span title="Pinned to top" aria-label="Pinned to top" style={{ marginLeft: "6px", fontSize: "13px" }}>📌</span>
                )}
                <h4 style={{ fontSize: "15px", fontWeight: "600", color: "var(--text-primary)", lineHeight: "1.4", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  <LinkifyText text={selectedTask.title} />
                </h4>
                {selectedTask.concreteStep && selectedTask.concreteStep !== "Do first tiny step" && (
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    ⚡ <LinkifyText text={selectedTask.concreteStep} />
                  </p>
                )}
                {selectedTask.subSteps && selectedTask.subSteps.length > 0 && (
                  <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {selectedTask.subSteps.map(s => (
                      <div key={s.id} style={{ fontSize: "12px", display: "flex", gap: "6px", color: s.done ? "var(--text-muted)" : "var(--text-secondary)", textDecoration: s.done ? "line-through" : "none" }}>
                        <span style={{ flexShrink: 0 }}>{s.done ? "☑" : "☐"}</span>
                        <span style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}><LinkifyText text={s.text} /></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn" onClick={() => handleMoveToToday(selectedTask)}>
                🚀 Move to Today
              </button>
              <button className="btn" onClick={() => handleTogglePin(selectedTask)}
                style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1.5px solid var(--border)", boxShadow: "none" }}>
                {selectedTask.isHorizonPinned ? "📌 Unpin from top" : "📌 Pin to top"}
              </button>
              {onEditTask && (
                <button className="btn" onClick={() => { onEditTask(selectedTask); setSelectedTask(null); }}
                  style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1.5px solid var(--border)", boxShadow: "none" }}>
                  ✏ Edit task
                </button>
              )}
              <button className="btn" onClick={() => handleCopy(selectedTask)}
                style={{ background: "var(--bg-secondary)", color: copied ? "var(--success)" : "var(--text-primary)", border: "1.5px solid var(--border)", boxShadow: "none" }}>
                {copied ? "✓ Copied!" : "📋 Copy"}
              </button>
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

      {/* Undo Delete Toast */}
      {undoTask && (
        <div className="bottom-toast" style={{ position: "fixed", bottom: "calc(76px + env(safe-area-inset-bottom, 0px))", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "20px", padding: "10px 16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.35)", zIndex: 200, fontSize: "12.5px", whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
            "{undoTask.title.length > 28 ? undoTask.title.substring(0, 28) + "..." : undoTask.title}" deleted
          </span>
          <button onClick={handleUndoDelete}
            style={{ background: "var(--accent)", color: "var(--btn-text, #fff)", border: "none", borderRadius: "12px", padding: "5px 14px", fontSize: "12px", fontWeight: "700", cursor: "pointer", flexShrink: 0 }}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
