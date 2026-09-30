import React, { useState, useRef, useEffect } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { getAIKeys, callAI, hasAIKey, extractJsonArray } from "../utils/aiCall";
import { sanitizeTaskField, CATEGORY_ICONS, byPriorityThenOrder } from "../utils/taskOps";
import { getFocusWindows } from "../utils/focusWindows";
import { useLociDayStr } from "../hooks/useTodayStr";
import { horizonsFromConfig, WORK_OLDER_ID } from "../utils/horizons";
import { dayLabel, doneTasks, isOpenPlanTask, ladderRungs, listTasks, openingRung, runwayLabelsShown, runwayTicks, workOlderCount } from "../utils/planLadder";
import { buildTaskMutationEvent, eventPatch, eventsPatch } from "../utils/activityLog";
import useTaskActions from "../hooks/useTaskActions";
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
import { IconChevronLeft, IconChevronRight, IconPin, IconPlus } from "./ui/icons";
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
          // As in Today's list: Enter opens the row; Space picks it up.
          onKeyDown: e => {
            if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onTaskClick(task); return; }
            listeners?.onKeyDown?.(e);
          },
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

// fullColTasks: the whole horizon when colTasks is a front's share of it.
function SortableRoadmapList({ colKey, colTasks, fullColTasks = colTasks, tasks, payload, savePayload, onTaskClick, onDone, isGoal = () => false, frontNameOf = () => null, openUuid = null }) {
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
    // Renumber the whole horizon's tier, not only the rows on screen: on a
    // front's page the horizon's other tasks keep their places around it.
    const tier = fullColTasks.filter(t => !!t.isHorizonPinned === draggedPinned);
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

// frontId: a front's page (52f–g) — only that front's open tasks, in the
// horizons that hold any, with no per-horizon + and no Inbox.
// Plan 57: the runway — a line from today to the furthest horizon's end, a
// dot at today, a tick at each end; labels where they fit (42.3, 57b.30).
function Runway({ rungs, day, phone }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const measure = () => setWidth(ref.current?.offsetWidth || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const ticks = runwayTicks(rungs, day);
  const shown = runwayLabelsShown(ticks, width, phone);
  return (
    <div className="plan-runway" ref={ref} aria-hidden="true">
      <span className="plan-runway-line" />
      <span className="plan-runway-dot" />
      <span className="plan-runway-label is-today">TODAY</span>
      {ticks.map(t => (
        <React.Fragment key={t.end}>
          <span className="plan-runway-tick" style={{ left: `${t.at * 100}%` }} />
          {shown.has(t.end) && (
            <span className={`plan-runway-label${t.furthest ? " is-far" : ""}`} style={t.furthest ? undefined : { left: `${t.at * 100}%` }}>
              {t.furthest ? dayLabel(t.end, day).replace(/^[A-Z]{3} /, "") : t.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// 42.1: the rung Plan opens on is remembered on this device.
const RUNG_KEY = "loci_plan_rung";
const readRung = () => { try { return localStorage.getItem(RUNG_KEY); } catch { return null; } };
const writeRung = (id) => { try { localStorage.setItem(RUNG_KEY, id); } catch { /* private mode */ } };

export default function RoadmapTab({ payload, savePayload, savePayloadAsync, onOpenAddTask, focusInbox = false, uid, writeActivityEvents, focusTimer = {}, frontId = null, frontsColumn = null, frontOpen = false, onCloseFront }) {
  const { tasks = [], config = {} } = payload;
  const windows = getFocusWindows(config);

  // Plan 57 (7b): the ladder — a rung per horizon, the open one's list beside
  // it. A front's page (frontId) keeps its horizon sections.
  const lociDay = useLociDayStr(windows);
  const rungs = ladderRungs(tasks, horizonsFromConfig(config, lociDay), lociDay);
  const olderCount = workOlderCount(tasks);
  const [rung, setRung] = useState(() => readRung());
  const selected = rung === WORK_OLDER_ID && olderCount > 0 ? WORK_OLDER_ID : openingRung(rungs, rung === WORK_OLDER_ID ? null : rung);
  const selectedRung = rungs.find(r => r.id === selected) || null;
  // A phone (57d–e): the ladder is the page; a rung pushes its list.
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 600);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const [phoneList, setPhoneList] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  // ≥1600 a rung closes a front's page shown in the list's place (57b.25).
  const pickRung = (id) => { setRung(id); writeRung(id); setPhoneList(true); setDoneOpen(false); onCloseFront?.(); };

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
  const {
    undo, setUndo, undoText, handleUndo,
    patchTask, handleMoveToToday, handleChangeHorizon, handleTogglePin, handlePark,
    handleSetSteps, handleMarkDone, handleDelete,
  } = useTaskActions({ payload, savePayload, savePayloadAsync, uid, writeActivityEvents, focusTimer });
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
  // A front's page names the front once, in its title, not on every row.
  const frontNameOf = (task) => (frontId ? null : fronts.find(f => f.id === task.frontId)?.name || null);

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

  const shownColumns = frontId
    ? columns
      .map(col => {
        const all = tasks.filter(t => t.horizonLevel === col.key && isVisibleRoadmapTask(t)).sort(byPriorityThenOrder);
        return { ...col, allTasks: all, tasks: all.filter(t => t.frontId === frontId) };
      })
      .filter(col => col.tasks.length > 0)
    // The ladder shows one list: the open rung's, pinned first then your
    // order (42.4).
    : [{
      key: selected,
      label: selected === WORK_OLDER_ID ? "Work · older" : selectedRung?.name || "",
      noAdd: selected === WORK_OLDER_ID,
      allTasks: listTasks(tasks, selected),
      tasks: listTasks(tasks, selected),
    }];
  const detailCol = detailUuid ? shownColumns.find(col => col.tasks.some(t => t.uuid === detailUuid)) : null;
  const detailTask = detailCol ? detailCol.tasks.find(t => t.uuid === detailUuid) : null;
  const detailIndex = detailTask ? detailCol.tasks.indexOf(detailTask) : -1;
  // Moved to another horizon: the ladder opens that rung, so the sheet
  // follows it. Done, moved to Today, parked or deleted: it left Plan, so
  // the sheet closes.
  const movedTo = !frontId && detailUuid && !detailTask
    ? tasks.find(t => t.uuid === detailUuid && isOpenPlanTask(t) && (t.horizonLevel === WORK_OLDER_ID || rungs.some(r => r.id === t.horizonLevel)))?.horizonLevel
    : null;
  useEffect(() => {
    if (movedTo) { setRung(movedTo); writeRung(movedTo); return; }
    if (detailUuid && !detailTask) setDetailUuid(null);
  }, [detailUuid, detailTask, movedTo]);
  const focusRow = (uuid) => requestAnimationFrame(() => document.querySelector(`.roadmap-container [data-task-uuid="${uuid}"]`)?.focus());
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
    <div className={`roadmap-container ${frontId ? "plan-front-tasks" : "plan-horizons-view"}`}>
      {frontId && shownColumns.length === 0 && <p className="plan-empty">Nothing open on this front.</p>}
      {frontId ? (
      <div className="plan-horizons">
        {shownColumns.map(col => {
          const colTasks = col.tasks;
          return (
            <section key={col.key} className="plan-horizon" aria-labelledby={`plan-h-${col.key}`}>
              <div className="plan-horizon-head">
                <h3 className="plan-horizon-name" id={`plan-h-${col.key}`}>
                  {col.label} <span className="plan-horizon-count">{colTasks.length}</span>
                </h3>
                {!col.noAdd && !frontId && (
                  <button type="button" className="plan-horizon-add" onClick={() => onOpenAddTask(col.key)} aria-label={`Add a task to ${col.label}`}>
                    <IconPlus size={20} />
                  </button>
                )}
              </div>
              <SortableRoadmapList
                colKey={col.key}
                colTasks={colTasks}
                fullColTasks={col.allTasks}
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
      ) : (
        <>
          <Runway rungs={rungs} day={lociDay} phone={narrow} />
          <div className={`plan-ladder-grid${narrow ? " is-phone" : ""}${narrow && phoneList ? " is-list" : ""}${frontsColumn ? " has-fronts" : ""}`}>
            {/* 57a–e: a rung per horizon — name and open count, its end and
                days left, the bar of the period gone (red at ≤3 days left). */}
            <nav className="plan-ladder" aria-label="Horizons">
              {rungs.map(r => (
                <button
                  key={r.id}
                  type="button"
                  data-horizon={r.id}
                  className={`plan-rung${r.id === selected && !frontOpen ? " is-open" : ""}${r.red ? " is-red" : ""}${r.dotted ? " is-dotted" : ""}`}
                  aria-current={r.id === selected && !frontOpen ? "true" : undefined}
                  onClick={() => pickRung(r.id)}
                >
                  <span className="plan-rung-top">
                    <span className="plan-rung-name">{r.name}</span>
                    <span className="plan-rung-count">{r.count}</span>
                  </span>
                  <span className="plan-rung-date">
                    {r.dotted ? `TO ${dayLabel(r.period.end, lociDay).replace(/^[A-Z]{3} /, "")}` : `ENDS ${dayLabel(r.period.end, lociDay)} · ${r.daysLeft} ${r.daysLeft === 1 ? "DAY" : "DAYS"}`}
                  </span>
                  <span className="plan-rung-bar"><span style={{ width: `${Math.round(r.elapsed * 100)}%` }} /></span>
                  <IconChevronRight size={18} className="plan-rung-chevron" aria-hidden="true" />
                </button>
              ))}
              {/* 57: the old Work horizon, until each task has a horizon. */}
              {olderCount > 0 && (
                <button
                  type="button"
                  data-horizon={WORK_OLDER_ID}
                  className={`plan-rung plan-rung-older${selected === WORK_OLDER_ID ? " is-open" : ""}`}
                  aria-current={selected === WORK_OLDER_ID ? "true" : undefined}
                  onClick={() => pickRung(WORK_OLDER_ID)}
                >
                  <span className="plan-rung-top">
                    <span className="plan-rung-name">Work · older</span>
                    <span className="plan-rung-count">{olderCount}</span>
                  </span>
                  <span className="plan-rung-date">Give each a horizon, once.</span>
                  <IconChevronRight size={18} className="plan-rung-chevron" aria-hidden="true" />
                </button>
              )}
            </nav>

            {/* The open rung's list (57): name, its range, days and tasks;
                rows; a "Done · N" fold (42.2); "+ Add to …" at the foot. */}
            {!frontOpen && (
            <section className="plan-open" aria-labelledby={`plan-h-${selected}`}>
              {narrow && (
                <button type="button" className="plan-open-back" onClick={() => setPhoneList(false)}>
                  <IconChevronLeft size={18} aria-hidden="true" /> Plan
                </button>
              )}
              <h2 className="plan-open-title" id={`plan-h-${selected}`}>{shownColumns[0].label}</h2>
              {selectedRung && selected !== WORK_OLDER_ID && (
                <p className="plan-open-meta">
                  {dayLabel(selectedRung.period.start, lociDay).replace(/^[A-Z]{3} /, "")} – {dayLabel(selectedRung.period.end, lociDay).replace(/^[A-Z]{3} /, "")}
                  {!selectedRung.dotted && ` · ${selectedRung.daysLeft} ${selectedRung.daysLeft === 1 ? "DAY" : "DAYS"} LEFT`}
                  {` · ${shownColumns[0].tasks.length} ${shownColumns[0].tasks.length === 1 ? "TASK" : "TASKS"}`}
                </p>
              )}
              <SortableRoadmapList
                colKey={shownColumns[0].key}
                colTasks={shownColumns[0].tasks}
                fullColTasks={shownColumns[0].allTasks}
                tasks={tasks}
                payload={payload}
                savePayload={savePayload}
                onTaskClick={openTask}
                onDone={handleMarkDone}
                isGoal={isGoal}
                frontNameOf={frontNameOf}
                openUuid={detailUuid}
              />
              {(() => {
                const done = selectedRung ? doneTasks(tasks, selected, selectedRung.period) : [];
                if (!done.length) return null;
                return (
                  <div className="plan-done">
                    <button type="button" className="plan-done-toggle" aria-expanded={doneOpen} onClick={() => setDoneOpen(o => !o)}>
                      Done · {done.length}
                    </button>
                    {doneOpen && (
                      <ul className="plan-done-list">
                        {done.map(t => <li key={t.uuid} className="plan-done-row">{t.title}</li>)}
                      </ul>
                    )}
                  </div>
                );
              })()}
              {!shownColumns[0].noAdd && (
                <button type="button" className="plan-open-add" onClick={() => onOpenAddTask(selected)}>
                  <IconPlus size={18} aria-hidden="true" /> Add to {shownColumns[0].label}
                </button>
              )}
            </section>
            )}
            {/* ≥1600 (57a): the Fronts column; a front's page takes the
                list's place (57b.25). */}
            {frontsColumn}
          </div>
        </>
      )}
      {/* Mind Box's notes wait below the horizons (45h has none on top). */}
      {!frontId && inbox}

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
            onSetSteps={(steps, meta) => handleSetSteps(detailTask, steps, meta)}
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
