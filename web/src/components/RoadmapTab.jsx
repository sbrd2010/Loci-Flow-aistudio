import React, { useState, useRef, useEffect } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { celebrate } from "../utils/celebrations";
import { getAIKeys, callAI, hasAIKey, extractJsonArray } from "../utils/aiCall";
import { sanitizeTaskField, CATEGORY_ICONS, byPriorityThenOrder } from "../utils/taskOps";
import { getFocusWindows, getLociDayStr } from "../utils/focusWindows";
import { buildTaskMutationEvent, buildFocusTerminalEvent, eventPatch, eventsPatch } from "../utils/activityLog";
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
import TaskDetail, { formatEstimate } from "./TaskDetail";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import { IconPin, IconPlus } from "./ui/icons";
import { commitmentKickerFront, frontForCommitment, frontsFromConfig, frontsOnOffer } from "../utils/fronts";

// A horizon row (45h, 52h): the circle marks it done; the title; then a pin
// if it is pinned, GOAL, and priority · estimate · front, whatever is set
// (the front truncates first). The row opens the task. Drag: by the grip on
// a laptop (shown on hover and focus), by a long press on touch, or by the
// whole row in Drag anywhere mode.
function SortableRoadmapCard({ id, task, onTaskClick, onDone, isGoal = false, frontName = null, interactionStyle = "classic", isOpen = false }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const isDragAnywhere = interactionStyle === "dragAnywhere";
  const estimate = Number(task.timeEstimateMinutes) > 0 ? formatEstimate(task.timeEstimateMinutes) : null;
  const figures = [task.priority || "P3", estimate].filter(Boolean).join(" · ");
  // Classic: the mouse and the keyboard drag by the grip; touch by holding
  // the row, since the grip only shows on hover.
  const { onTouchStart, ...gripListeners } = listeners || {};
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
        className={`roadmap-task-card plan-row${isDragAnywhere ? " is-drag-anywhere" : ""}${isOpen ? " is-open" : ""}`}
        data-task-uuid={task.uuid}
        onClick={() => onTaskClick(task)}
        {...(isDragAnywhere ? {
          ...listeners,
          tabIndex: attributes?.tabIndex,
          "aria-disabled": attributes?.["aria-disabled"],
          "aria-describedby": attributes?.["aria-describedby"],
        } : {
          onTouchStart,
          tabIndex: 0,
          role: "button",
          "aria-label": `Open: ${task.title}`,
          onKeyDown: e => {
            if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            onTaskClick(task);
          },
        })}
      >
        {!isDragAnywhere && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...gripListeners}
            {...attributes}
            className="plan-row-grip"
            onClick={e => e.stopPropagation()}
            aria-label={`Drag to reorder: ${task.title}`}
          >
            ⠿
          </button>
        )}
        {onDone && (
          <button
            type="button"
            className="plan-row-circle"
            aria-label={`Mark done: ${task.title}`}
            onClick={e => { e.stopPropagation(); onDone(task); }}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          >
            <span aria-hidden="true" />
          </button>
        )}
        <span className="plan-row-body">
          <span className="roadmap-task-title plan-row-title">
            <LinkifyText text={task.title} />
          </span>
          <span className="plan-row-meta">
            {task.isHorizonPinned && <span className="plan-row-pin" role="img" aria-label="Pinned to top"><IconPin size={14} /></span>}
            {isGoal && <span className="task-tag is-goal">GOAL</span>}
            <span className="plan-row-figures">{figures}</span>
            {frontName && <span className="plan-row-figures plan-row-front">· {frontName}</span>}
          </span>
        </span>
        {isDragAnywhere && (
          <button
            type="button"
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

function SortableRoadmapList({ colKey, colTasks, tasks, payload, savePayload, onTaskClick, onDone, isGoal = () => false, frontNameOf = () => null, openUuid = null }) {
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
    return <div className="roadmap-empty-state plan-empty">Nothing here yet.</div>;
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
            onDone={onDone}
            isGoal={isGoal(task)}
            frontName={frontNameOf(task)}
            interactionStyle={interactionStyle}
            isOpen={task.uuid === openUuid}
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

export default function RoadmapTab({ payload, savePayload, savePayloadAsync, onOpenAddTask, onEditTask, focusInbox = false, uid, writeActivityEvents, focusTimer = {} }) {
  const { tasks = [], config = {} } = payload;
  const windows = getFocusWindows(config);

  // 45h: the four horizons, always shown. Work (the older horizon) is shown
  // only while it holds tasks, so none of them is lost from view.
  const columns = [
    { key: "week",     label: "This week" },
    { key: "month",    label: "This month" },
    { key: "quarter",  label: "This quarter" },
    { key: "halfyear", label: "6 months" },
    // 52: Work stays only while it holds tasks, "older", with no +.
    { key: "office",   label: "Work · older", onlyWithTasks: true, noAdd: true },
  ];

  // A task, opened (52h): the same sheet as Today's, with Plan's footer.
  const [detailUuid, setDetailUuid] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  // The one Undo toast (done, delete, park, today, step), as on Today.
  const [undo, setUndo] = useState(null);
  const [drawerViewport, setDrawerViewport] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  useEffect(() => {
    const update = () => setDrawerViewport(window.innerWidth >= 1024);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // Brain dump deletion is confirmed via a deferred onConfirm callback — by the
  // time the user clicks "Delete", `payload` in that closure may be stale (e.g.
  // a background save landed while the dialog was open). Track the latest
  // payload in a ref so the delete reads/writes current data, not a snapshot.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const [longDumpWarning, setLongDumpWarning] = useState(null); // {id, horizon}
  const [aiBreakdownSuggestion, setAiBreakdownSuggestion] = useState(null); // {id, items: [{title, concreteStep}], noKey, error}
  const [aiBreakdownLoading, setAiBreakdownLoading] = useState(null); // item.id
  const [editingDumpItem, setEditingDumpItem] = useState(null); // {id, text}

  // Mind Box's "N notes waiting" lands here: bring the Inbox into view.
  const inboxRef = useRef(null);
  useEffect(() => {
    if (focusInbox) inboxRef.current?.scrollIntoView({ block: "start" });
  }, [focusInbox]);

  const openTask = (task) => setDetailUuid(task.uuid);

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

  // Each action writes from the latest payload: the sheet stays open across
  // saves, so a closure's `tasks` can be a render behind.
  const latestTasks = () => payloadRef.current?.tasks || [];
  const patchTask = (uuid, patch) => {
    const latest = payloadRef.current;
    savePayload({ ...latest, tasks: latestTasks().map(t => t.uuid === uuid ? { ...t, ...patch, lastUpdated: Date.now() } : t) });
  };

  const handleMoveToToday = (task) => {
    const todayTasksCount = latestTasks().filter((t) => t.horizonLevel === "today" && isVisibleRoadmapTask(t)).length;
    const event = buildTaskMutationEvent("task_moved", task, {
      fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: "today" }, windows,
    });
    savePayloadAsync({
      ...payloadRef.current,
      tasks: latestTasks().map((t) =>
        t.uuid === task.uuid ? { ...t, horizonLevel: "today", deferredUntil: null, orderIndex: todayTasksCount, lastUpdated: Date.now() } : t
      )
    })
      .then(() => writeActivityEvents(eventPatch(uid, event)))
      .catch(() => {});
    setUndo({ kind: "today", task, at: Date.now() });
  };

  // A horizon change from the sheet's picker. To Today it leaves Plan, so it
  // goes the way Move to Today does, with Undo.
  const handleChangeHorizon = (task, horizon) => {
    if (horizon === "today") { handleMoveToToday(task); return; }
    const event = buildTaskMutationEvent("task_moved", task, {
      fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: horizon }, windows,
    });
    const orderIndex = latestTasks().filter(t => t.horizonLevel === horizon && isVisibleRoadmapTask(t)).length;
    savePayloadAsync({ ...payloadRef.current, tasks: latestTasks().map(t => t.uuid === task.uuid ? { ...t, horizonLevel: horizon, orderIndex, lastUpdated: Date.now() } : t) })
      .then(() => writeActivityEvents(eventPatch(uid, event)))
      .catch(() => {});
  };

  const handleTogglePin = (task) => patchTask(task.uuid, { isHorizonPinned: !task.isHorizonPinned });

  const handlePark = (task) => {
    const now = Date.now();
    const event = buildTaskMutationEvent("task_parked", task, { windows, now });
    // Parking clears isNowFocus: a session running on this task (one started
    // from Coach, say) ends here, recorded, as Done and Delete end theirs.
    const endedFocusSession = task.isNowFocus && typeof focusTimer.endFocusSession === "function"
      ? focusTimer.endFocusSession("user_abandoned")
      : null;
    savePayloadAsync({ ...payloadRef.current, tasks: latestTasks().map(t => t.uuid === task.uuid ? { ...t, isParked: true, isNowFocus: false, lastUpdated: Date.now() } : t) })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    setUndo({ kind: "park", task, at: now });
  };

  const handleToggleStep = (task, stepId) => {
    const current = latestTasks().find(t => t.uuid === task.uuid);
    if (!current) return;
    patchTask(task.uuid, { subSteps: (current.subSteps || []).map(st => st.id === stepId ? { ...st, done: !st.done } : st) });
  };
  const handleAddStep = (task, text) => {
    const current = latestTasks().find(t => t.uuid === task.uuid);
    if (!current) return;
    patchTask(task.uuid, { subSteps: [...(current.subSteps || []), { id: safeUUID(), text, done: false }] });
  };
  // A step goes at once, with Undo (52: Undo, not confirm).
  const handleDeleteStep = (task, stepId) => {
    const current = latestTasks().find(t => t.uuid === task.uuid);
    const step = (current?.subSteps || []).find(st => st.id === stepId);
    if (!step) return;
    patchTask(task.uuid, { subSteps: current.subSteps.filter(st => st.id !== stepId) });
    setUndo({ kind: "step", task: current, step, at: Date.now() });
  };

  const handleMarkDone = (task) => {
    celebrate();
    const actionAt = Date.now();
    const todayDateStr = getTodayDateString();
    const lociTodayStr = getLociDayStr(new Date(), getFocusWindows(config));
    const event = buildTaskMutationEvent("task_completed", task, { windows, now: actionAt });
    // Marking the actively focused task done clears isNowFocus below without
    // ending its session — end it here, same as Today's handleToggleComplete.
    const endedFocusSession = task.isNowFocus && typeof focusTimer.endFocusSession === "function"
      ? focusTimer.endFocusSession("completed_task")
      : null;
    savePayloadAsync({
      ...payloadRef.current,
      tasks: latestTasks().map((t) =>
        t.uuid === task.uuid ? { ...t, isCompleted: true, isNowFocus: false, dateCompletedString: lociTodayStr, lastUpdated: Date.now() } : t
      ),
      contributions: incrementContribution([...(payloadRef.current.contributions || [])], todayDateStr)
    })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          // Use endedFocusSession.task, not `task` — if the pin moved to
          // `task` via a path that never ended the PREVIOUS session, this
          // call actually closed out that older session, which may belong to
          // a different task entirely.
          events.push(buildFocusTerminalEvent("focus_completed", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    setUndo({ kind: "done", task, at: actionAt, dateStr: todayDateStr });
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
    const event = buildTaskMutationEvent("task_created", freshTask, { windows });
    savePayloadAsync({ ...payload, tasks: [...tasks, freshTask], brainDump: (payload.brainDump || []).filter(d => d.id !== item.id) })
      .then(() => writeActivityEvents(eventPatch(uid, event)))
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
    const events = freshTasks.map((t) => buildTaskMutationEvent("task_created", t, { windows }));
    savePayloadAsync({ ...payload, tasks: [...tasks, ...freshTasks], brainDump: (payload.brainDump || []).filter(d => d.id !== item.id) })
      .then(() => writeActivityEvents(eventsPatch(uid, events)))
      .catch(() => {});
    setLongDumpWarning(null);
    setAiBreakdownSuggestion(null);
    setEditingDumpItem(null);
  };

  // Delete goes at once, with Undo (50: Undo, not confirm).
  const handleDelete = (task) => {
    const now = Date.now();
    const event = buildTaskMutationEvent("task_deleted", task, { windows, now });
    // Deleting the actively focused task (e.g. one started from Coach)
    // drops it out of activeTask (isDeleted-filtered) without ever
    // clearing isNowFocus itself — end its session here or it's left
    // open with no terminal event.
    const endedFocusSession = task.isNowFocus && typeof focusTimer.endFocusSession === "function"
      ? focusTimer.endFocusSession("user_abandoned")
      : null;
    savePayloadAsync({ ...payloadRef.current, tasks: latestTasks().map((t) => t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t) })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    setUndo({ kind: "delete", task, at: now });
  };

  // Undo puts back only what the action changed, on the task as it is now.
  const handleUndo = () => {
    if (!undo) return;
    const { kind, task } = undo;
    setUndo(null);
    const latest = payloadRef.current;
    const current = latestTasks().find(t => t.uuid === task.uuid);
    if (!current) return;
    const put = (patch, eventType, opts = {}) => {
      const next = { ...latest, ...opts, tasks: latestTasks().map(t => t.uuid === task.uuid ? { ...t, ...patch, lastUpdated: Date.now() } : t) };
      if (!eventType) { savePayload(next); return; }
      const event = buildTaskMutationEvent(eventType, current, { windows, ...(eventType === "task_moved" ? { fromState: { horizonLevel: current.horizonLevel }, toState: { horizonLevel: task.horizonLevel } } : {}) });
      savePayloadAsync(next).then(() => writeActivityEvents(eventPatch(uid, event))).catch(() => {});
    };
    if (kind === "delete" && current.isDeleted) put({ isDeleted: false }, "task_restored");
    else if (kind === "park" && current.isParked) put({ isParked: false });
    else if (kind === "today" && current.horizonLevel === "today") put({ horizonLevel: task.horizonLevel, orderIndex: task.orderIndex, deferredUntil: task.deferredUntil ?? null }, "task_moved");
    else if (kind === "step") put({ subSteps: [...(current.subSteps || []), undo.step].sort((a, b) => (task.subSteps || []).findIndex(x => x.id === a.id) - (task.subSteps || []).findIndex(x => x.id === b.id)) });
    else if (kind === "done" && current.isCompleted) {
      const contributions = [...(latest.contributions || [])];
      const idx = contributions.findIndex(c => c.dateString === undo.dateStr);
      if (idx !== -1 && contributions[idx].count > 0) contributions[idx] = { ...contributions[idx], count: contributions[idx].count - 1, lastUpdated: Date.now() };
      put({ isCompleted: false, dateCompletedString: null }, "task_reopened", { contributions });
    }
  };
  const UNDO_LABELS = { done: "Marked done", delete: "Deleted", park: "Parked", today: "Moved to Today" };
  const undoText = !undo ? "" : undo.kind === "step" ? `Step removed: ${undo.step.text}` : `${UNDO_LABELS[undo.kind]}: ${undo.task.title}`;

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

  const brainDump = payload.brainDump || [];
  // GOAL: the same rule as Today's rows — the front the wall's kicker names.
  const fronts = frontsFromConfig(config);
  const goalFront = commitmentKickerFront(frontForCommitment(tasks.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted), fronts), config);
  const isGoal = (task) => !!goalFront && task.frontId === goalFront.id;
  const frontNameOf = (task) => fronts.find(f => f.id === task.frontId)?.name || null;

  const inbox = brainDump.length > 0 && (
    <section className="plan-inbox" aria-labelledby="plan-inbox-title" ref={inboxRef}>
      <div className="plan-horizon-head">
        <h3 className="plan-horizon-name" id="plan-inbox-title">Inbox <span className="plan-horizon-count">{brainDump.length}</span></h3>
        <button type="button" className="plan-inbox-clear" onClick={handleClearAllBrainDump}>Clear all</button>
      </div>
      <p className={`plan-inbox-note${brainDump.length >= 50 ? " is-full" : ""}`}>
        {brainDump.length}/50 {brainDump.length >= 50 ? "— the inbox is full. Send some on before adding more." : `${brainDump.length === 1 ? "note" : "notes"} from Mind Box. Send each to a horizon.`}
      </p>
      <div className="plan-inbox-items">{brainDump.map(item => renderDumpItem(item))}</div>
    </section>
  );

  const shownColumns = columns
    .map(col => ({ ...col, tasks: tasks.filter(t => t.horizonLevel === col.key && isVisibleRoadmapTask(t)).sort(byPriorityThenOrder) }))
    .filter(col => !col.onlyWithTasks || col.tasks.length > 0);
  const detailCol = detailUuid ? shownColumns.find(col => col.tasks.some(t => t.uuid === detailUuid)) : null;
  const detailTask = detailCol ? detailCol.tasks.find(t => t.uuid === detailUuid) : null;
  const detailIndex = detailTask ? detailCol.tasks.indexOf(detailTask) : -1;
  // Done, moved to Today, parked or deleted: it left Plan, so the sheet closes.
  useEffect(() => {
    if (detailUuid && !detailTask) setDetailUuid(null);
  }, [detailUuid, detailTask]);
  const focusRow = (uuid) => requestAnimationFrame(() => document.querySelector(`.plan-horizons [data-task-uuid="${uuid}"]`)?.focus());
  const closeDetail = () => { const back = detailUuid; setDetailUuid(null); if (back) focusRow(back); };
  // An action that takes the task out of Plan: focus goes to its neighbour
  // in the horizon, as on Today.
  const leaving = (task, act) => {
    const col = detailCol?.tasks || [];
    const i = col.findIndex(t => t.uuid === task.uuid);
    const next = col[i + 1] || col[i - 1];
    act(task);
    if (next) focusRow(next.uuid);
  };
  // The drawer's keys (50b): ↑/↓ move through the horizon, Esc closes and
  // hands focus back to the row.
  const onDetailKeyDown = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !detailTask) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeDetail(); return; }
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const next = dir && detailCol.tasks[detailIndex + dir];
    if (!next) return;
    e.preventDefault();
    setDetailUuid(next.uuid);
  };

  return (
    <div className="roadmap-container plan-horizons-view">
      <div className="plan-horizons">
        {shownColumns.map(col => {
          const colTasks = col.tasks;
          return (
            <section key={col.key} className="plan-horizon" aria-labelledby={`plan-h-${col.key}`}>
              <div className="plan-horizon-head">
                <h3 className="plan-horizon-name" id={`plan-h-${col.key}`}>
                  {col.label} <span className="plan-horizon-count">{colTasks.length}</span>
                </h3>
                {!col.noAdd && (
                  <button type="button" className="plan-horizon-add" onClick={() => onOpenAddTask(col.key)} aria-label={`Add a task to ${col.label}`}>
                    <IconPlus size={20} />
                  </button>
                )}
              </div>
              <SortableRoadmapList
                colKey={col.key}
                colTasks={colTasks}
                tasks={tasks}
                payload={payload}
                savePayload={savePayload}
                onTaskClick={openTask}
                onDone={handleMarkDone}
                isGoal={isGoal}
                frontNameOf={frontNameOf}
                openUuid={detailUuid}
              />
            </section>
          );
        })}
      </div>
      {/* Mind Box's notes wait below the horizons (45h has none on top). */}
      {inbox}

      {/* A task, opened (52h): the sheet on phones and tablets, the drawer
          from 1024px. */}
      {detailTask && !drawerViewport && <div className="task-detail-scrim" onClick={closeDetail} aria-hidden="true" />}
      {detailTask && (
        <div onKeyDown={onDetailKeyDown}>
          <TaskDetail
            key={detailTask.uuid}
            task={detailTask}
            variant={drawerViewport ? "drawer" : "sheet"}
            kicker={`${detailCol.label.toUpperCase()} · ${detailIndex + 1} OF ${detailCol.tasks.length}`}
            isGoal={isGoal(detailTask)}
            fronts={frontsOnOffer(fronts, detailTask.frontId)}
            onClose={closeDetail}
            onPatch={patch => (patch.horizonLevel && patch.horizonLevel !== detailTask.horizonLevel
              ? handleChangeHorizon(detailTask, patch.horizonLevel)
              : patchTask(detailTask.uuid, patch))}
            onToggleStep={stepId => handleToggleStep(detailTask, stepId)}
            onDeleteStep={stepId => handleDeleteStep(detailTask, stepId)}
            onAddStep={text => handleAddStep(detailTask, text)}
            onMoreDetails={onEditTask ? () => { onEditTask(detailTask); setDetailUuid(null); } : undefined}
            onDone={() => leaving(detailTask, handleMarkDone)}
            onMoveToToday={() => leaving(detailTask, handleMoveToToday)}
            onTogglePin={() => handleTogglePin(detailTask)}
            onPark={() => leaving(detailTask, handlePark)}
            onDelete={() => leaving(detailTask, handleDelete)}
          />
        </div>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      <UndoAnnouncer message={undoText} />
      {undo && <UndoToast key={undo.at} message={undoText} onUndo={handleUndo} onClose={() => setUndo(null)} />}
    </div>
  );
}
