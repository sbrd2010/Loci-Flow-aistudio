import React, { useEffect, useRef, useState } from "react";
import { horizonChoices } from "../utils/planLadder";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatClock24, formatSpan, moveToTomorrow, restoreSchedule } from "../utils/dayMapPlan";
import { mergeWindowSpans } from "../utils/focusWindows";
import { isDeferred } from "../utils/deferral";
import {
  applyReflow, currentDayMinutes, getEstimate, getTaskId,
  hasHeadGap, normalizePriority, reflowRoute, routeCut, routeIsContiguous, useDayRoute,
} from "../hooks/useDayRoute";
import { isEventTask, isFixedStop } from "../utils/dayMapRoute";
import { eventAsks } from "../utils/fixedTime";
import { addedBreaks, busyFromRows, defaultBreak, laterTodaySlot, newBreakId, nextFreeSlot } from "../utils/dayMapBreaks";
import { buildTaskMutationEvent, eventPatch } from "../utils/activityLog";
import { safeUUID } from "../utils/uuid";
import { isEveningGuardBlocked } from "../utils/eveningGuard";
import DayBar from "./DayBar";
import MinimumDay from "./MinimumDay";
import { confirmMinimumDay, minimumDay } from "../utils/minimumDay";
import DayMapFrom from "./DayMapFrom";
import LinkifyText from "./LinkifyText";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import DidItHappen from "./DidItHappen";
import { closeDayOffered } from "../utils/closeDay";
import TaskDetail from "./TaskDetail";
import FixTimeSheet from "./FixTimeSheet";
import useTaskActions from "../hooks/useTaskActions";
import { frontsFromConfig, frontsOnOffer } from "../utils/fronts";
import { IconCheck, IconChevronDown, IconChevronLeft, IconLock, IconPin } from "./ui/icons";
import { useFocusLedger } from "../hooks/useFocusLedger";
import { dayBar, doneToday, factualLine } from "../utils/dayMapFacts";
import { unzoomTransform } from "../utils/cssZoom";
import "../styles/dayMap.css";

// Day map (50e–f, 52d–e). Today's tasks laid end to end from a start time,
// as a flat list: the time each starts, the task, how long. The day ends when
// the focus time left runs out: a red DAY ENDS line, and what starts after it
// is listed under WON'T FIT TODAY. "Move N to tomorrow" puts those at the top
// of tomorrow's route (nothing is deleted), with Undo. Every open Today task
// is on the route, in the list's order (Q59); above it: From · Fixed time.

// `row` is the stop as the route engine laid it out (utils/dayMapRoute): its
// start and end, and whether it is fixed, late, pulled forward, or stops for
// a break. A fixed stop keeps its time, so it is not dragged.
function RouteStop({ task, row, fromYesterday = false, isNow, isOver, isGoal, isOpen, onOpen, onStartFocus, until = null, min = null, was = null, flash = false, asks = null }) {
  const taskId = getTaskId(task);
  const {
    attributes, listeners, setActivatorNodeRef,
    setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: taskId, data: { taskId }, disabled: row.fixed });

  const { start, end } = row;
  const p = normalizePriority(task.priority);
  // Brief §6: each block reads "09:00 to 10:15, Acme CV".
  const late = row.late && !asks;
  const label = `${isNow || late ? "Now" : formatClock24(start)} to ${formatClock24(end)}, ${task.title}, Priority ${p.slice(1)}`
    + (row.fixed ? ", fixed time" : "") + (row.pulledForward ? ", pulled forward" : "")
    + (row.continues ? ", continues after the break" : "")
    + (isGoal ? ", goal task" : "") + (min === "confirmed" ? ", minimum day" : "") + (isOver ? ", after the day ends" : "")
    + (asks ? ", did it happen?" : "");

  const style = {
    transform: CSS.Transform.toString(unzoomTransform(transform)),
    transition,
    opacity: isDragging ? 0.55 : undefined,
    zIndex: isDragging ? 5 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`dm-stop${isNow ? " is-now" : ""}${late ? " is-late" : ""}${asks ? " is-asking" : ""}${isOver ? " is-over" : ""}${isDragging ? " is-dragging" : ""}${isOpen ? " is-open" : ""}${flash ? " is-flash" : ""}`}
      data-task-uuid={taskId}
    >
      <div
        ref={setActivatorNodeRef}
        className="dm-main"
        aria-label={label}
        aria-haspopup="dialog"
        tabIndex={attributes.tabIndex}
        role={attributes.role}
        aria-roledescription={attributes["aria-roledescription"]}
        aria-describedby={attributes["aria-describedby"]}
        onClick={onOpen}
        {...listeners}
        // Space picks the stop up (the drag's key); Enter opens its sheet,
        // as a row does in Today's list.
        onKeyDown={e => {
          // (While it is held, onOpen ignores it: Enter drops it instead.)
          if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onOpen(); return; }
          listeners?.onKeyDown?.(e);
        }}
      >
        <span className="dm-time">{isNow ? "NOW" : late ? "now" : formatClock24(start)}</span>
        <span className="dm-rail" aria-hidden="true"><span className={`dm-dot${isNow ? " is-now" : ""}${isOver ? " is-over" : ""}`} /></span>
        <span className="dm-title">
          <LinkifyText text={task.title} />
          {row.fixed && <span className="dm-lock"><IconLock size={14} /></span>}
          {row.pulledForward && <span className="dm-pulled">PULLED FORWARD</span>}
          {/* 58e: a stop a fixed time moved says where it was, until you leave. */}
          {was != null && <span className="dm-pulled">WAS {formatClock24(was)}</span>}
          {isGoal && <span className="task-tag is-goal">GOAL</span>}
          {/* Q33.1: a dotted MIN while the minimum day is suggested; the
              green one once it's confirmed. */}
          {min && <span className={`task-tag is-min${min === "suggested" ? " is-suggested" : ""}`}>MIN</span>}
          {fromYesterday && <span className="from-yesterday">FROM YESTERDAY</span>}
        </span>
        <span className="dm-dur">{formatSpan(end - start)}</span>
        {/* 56a: the one thing, at NOW, until the end of its stop. */}
        {until != null && <span className="dm-one-thing"><IconPin size={12} />THE ONE THING · UNTIL {formatClock24(until)}</span>}
      </div>
      {/* Q36.3: still open 5 minutes after it ended, it asks (Q47.5). */}
      {asks && <DidItHappen title={task.title} {...asks} />}
      {/* Q31: something at a set time (a call) is never a focus session. */}
      {isNow && !isEventTask(task) && (
        <button type="button" className="dm-start" onClick={onStartFocus} onPointerDown={e => e.stopPropagation()}>
          Start focus
        </button>
      )}

    </li>
  );
}

export default function DayMapPage({ payload, savePayload, savePayloadAsync, onClose, onStartFocus, onEndFocus, onAddTask, onHelpChoose, onCloseDay, dayClock, flushNow = () => {}, backLabel = "Today", uid, writeActivityEvents, focusTimer }) {
  // A stop, opened (52): the task sheet.
  const [detailId, setDetailId] = useState(null);
  // The route's own Undo: { message, before, at } — before is what to put back.
  const [routeUndo, setRouteUndo] = useState(null);
  // The sheet's actions (done, park, delete, a step) and their Undo, as in
  // Plan. One toast shows: whichever came last.
  const actions = useTaskActions({ payload, savePayload, savePayloadAsync, uid, writeActivityEvents, focusTimer });
  const setUndo = (u) => { setRouteUndo(u); if (u) actions.setUndo(null); };
  // Done, Park, Delete or a horizon change take a stop off the route, and
  // their Undo puts it back: either way the route is timed again once the
  // write has landed (the effect below), so no gap or overlap is left.
  const pendingReflowRef = useRef(null);
  const act = (fn) => (...args) => { setRouteUndo(null); pendingReflowRef.current = { prefer: null }; fn(...args); };
  const undoAction = () => {
    const task = actions.undo?.task;
    if (task && actions.undo.kind !== "step") pendingReflowRef.current = { prefer: getTaskId(task) };
    actions.handleUndo();
  };
  const undo = routeUndo;
  // Fixed time (58c–e): the sheet, open on step 1 or on a stop; the stops it
  // moved and where they were (shown until you leave); the fixed row's flash.
  const [fixing, setFixing] = useState(null); // { task?, breakItem? }
  const [wasStarts, setWasStarts] = useState(null); // Map id → earlier start
  const [flashId, setFlashId] = useState(null);
  // A "Something else" stop's creation write, by task id: its Undo logs the
  // removal only after the creation has been logged.
  const createdWritesRef = useRef(new Map());
  useEffect(() => {
    if (!flashId) return undefined;
    const t = setTimeout(() => setFlashId(null), 600);
    return () => clearTimeout(t);
  }, [flashId]);
  // "Done so far today" (56a–c): open on a monitor, folded below 1600px.
  const [doneOpen, setDoneOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1600);
  // The phone's action sits right on the nav, whatever its height.
  const [navHeight, setNavHeight] = useState(0);
  useEffect(() => {
    const nav = document.querySelector(".tab-bar");
    if (!nav || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setNavHeight(nav.getBoundingClientRect().height));
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  const {
    tasks, config: routeConfig, windows, breaks, todayStr, tomorrowStr, payloadRef,
    activeTodayTasks, scheduledTasks, tomorrowTasks,
    anchorMinutes, rows, routeTasks, plan, isGoal, sortableIds, latestTasks, applyAndSave,
    setAnchor, setAddedBreaks,
  } = useDayRoute({ payload, savePayload });

  // A drag ends in a click on the row it dropped; that click must not open it.
  const draggingRef = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    // One stop per ↑/↓; Space picks up and drops, Enter drops (it opens a
    // stop when nothing is held).
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    })
  );

  // The sheet's estimate is the stop's duration: both fields change, and the
  // route is timed again.
  const changeDuration = (taskId, duration) => {
    applyAndSave(scheduledTasks.map(t =>
      getTaskId(t) === taskId ? { ...t, dayMapDurationMinutes: duration || null, timeEstimateMinutes: duration || null } : t
    ), anchorMinutes);
  };

  // The pinned task is what you are doing now, and may have a focus session
  // open that only Today can close properly — so it is never moved from here.
  const movable = plan.wontFit.filter(t => !t.isNowFocus);
  const moveOverToTomorrow = () => {
    const ids = movable.map(getTaskId);
    if (!ids.length) return;
    const { tasks: nextTasks, before } = moveToTomorrow(latestTasks(), ids, tomorrowStr);
    savePayload({ ...payloadRef.current, tasks: nextTasks, timestamp: Date.now() });
    setUndo({ message: `${ids.length} ${ids.length === 1 ? "task" : "tasks"} moved to tomorrow`, before, at: Date.now() });
  };

  // Undo puts the tasks back, then times the whole route again: the route may
  // have changed since, and restored stops must not share an order or a
  // start time with it.
  const handleUndo = () => {
    if (!undo) return;
    // Breaks are one day's: past midnight, Undo has nothing to put back.
    if (undo.kind === "breaks") { setUndo(null); if (undo.date === todayStr) setAddedBreaks(undo.breaks); return; }
    const restored = restoreSchedule(latestTasks(), undo.before);
    const put = new Set(undo.before.map(getTaskId));
    const onRoute = restored.filter(t => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted && !t.isParked
      && t.dayMapDate === todayStr && !isDeferred(t, todayStr) && (t.dayMapOrder != null || !!t.dayMapPeriod));
    const byOrder = (a, b) => ((a.dayMapOrder ?? Infinity) - (b.dayMapOrder ?? Infinity))
      || (put.has(getTaskId(b)) - put.has(getTaskId(a)))
      || ((a.dayMapStartMinutes ?? 0) - (b.dayMapStartMinutes ?? 0));
    const route = [...onRoute].sort(byOrder);
    // A stop made for a fixed time ("Something else") goes again.
    const kept = undo.created ? restored.filter(t => getTaskId(t) !== undo.created) : restored;
    const next = { ...payloadRef.current, tasks: applyReflow(kept, reflowRoute(route.filter(t => getTaskId(t) !== undo.created), anchorMinutes, todayStr, breaks)), timestamp: Date.now() };
    setUndo(null);
    setWasStarts(null);
    if (!undo.created || !undo.createdTask) { savePayload(next); return; }
    // Undo takes back the stop it made: the ledger says so, after the
    // creation it undoes and once the removal itself has landed (Codex
    // reviews of #425).
    const removed = buildTaskMutationEvent("task_deleted", undo.createdTask, { windows });
    const created = createdWritesRef.current.get(undo.created) || Promise.resolve();
    createdWritesRef.current.delete(undo.created);
    Promise.all([created, savePayloadAsync(next)])
      .then(() => writeActivityEvents?.(eventPatch(uid, removed)))
      .catch(() => {});
  };

  // Fixes `target` at `at` (58c–e). A task not on the route joins it; for
  // something new, a Today task is made first. The route then flows around
  // it, the stops it moved say where they were, and Undo puts it all back.
  const fixTime = (target, at, isNew) => {
    const p = payloadRef.current;
    let all = latestTasks();
    let task = target;
    if (isNew && isEveningGuardBlocked(p?.config)) return;
    if (isNew) {
      task = {
        id: Date.now(), userId: p?.config?.userId || "", uuid: safeUUID(), title: target.title,
        horizonLevel: "today", priority: "P3", category: "Personal", frontId: null,
        timeEstimateMinutes: target.minutes, deadlineTimestamp: null, reminderAt: null,
        isCompleted: false, isParked: false, isNowFocus: false,
        // Q31: something at a set time — a lock and its time in Today's
        // list, and never a focus session.
        fixedKind: "event",
        orderIndex: all.filter(t => t.horizonLevel === "today" && !t.isDeleted).length,
        dateCompletedString: null, isDeleted: false, lastUpdated: Date.now(), subSteps: [],
      };
      all = [...all, task];
    }
    const id = getTaskId(task);
    const before = [...scheduledTasks, ...(scheduledTasks.some(t => getTaskId(t) === id) ? [] : [latestTasks().find(t => getTaskId(t) === id) || task])];
    const fixed = { ...task, dayMapFixedMinutes: at };
    const order = scheduledTasks.some(t => getTaskId(t) === id)
      ? scheduledTasks.map(t => (getTaskId(t) === id ? fixed : t))
      : [...scheduledTasks, fixed];
    const reflowed = reflowRoute(order, anchorMinutes, todayStr, breaks);
    const earlier = new Map(routeTasks.map(t => [getTaskId(t), Number(t.dayMapStartMinutes)]));
    const was = new Map(reflowed
      .filter(t => getTaskId(t) !== id && earlier.has(getTaskId(t)) && earlier.get(getTaskId(t)) !== t.dayMapStartMinutes)
      .map(t => [getTaskId(t), earlier.get(getTaskId(t))]));
    const next = { ...p, tasks: applyReflow(all, reflowed), config: { ...(p?.config || {}), dayMapDate: todayStr, dayMapAnchorMinutes: anchorMinutes, lastUpdated: Date.now() }, timestamp: Date.now() };
    // A new task is logged once its write has landed, as Add task does
    // (Codex review of #425).
    // The event is made now, when you confirm, and written once the task's
    // write has landed, as Add task does (Codex review of #425).
    const created = isNew ? buildTaskMutationEvent("task_created", task, { windows }) : null;
    const written = typeof savePayloadAsync === "function"
      ? savePayloadAsync(next)
      : (savePayload(next), Promise.resolve());
    if (created) {
      createdWritesRef.current.set(getTaskId(task), written.then(() => writeActivityEvents?.(eventPatch(uid, created))));
      createdWritesRef.current.get(getTaskId(task)).catch(() => {});
    }
    setFixing(null);
    setWasStarts(was);
    setFlashId(id);
    setUndo({
      message: `${task.title} fixed at ${formatClock24(at)} · ${was.size} ${was.size === 1 ? "stop" : "stops"} moved`,
      before, created: isNew ? id : null, createdTask: isNew ? task : null, at: Date.now(),
    });
  };

  // Focus goes back to a break's row when its sheet closes (10b): once the
  // sheet is gone and the row is drawn, so the row can take it.
  const [refocusBreak, setRefocusBreak] = useState(null);
  const focusBreak = (id) => setRefocusBreak(String(id));
  useEffect(() => {
    if (refocusBreak == null || fixing) return;
    // window.CSS: this file's CSS is dnd-kit's.
    document.querySelector(`.dm-break [data-break-id="${window.CSS.escape(refocusBreak)}"]`)?.focus();
    setRefocusBreak(null);
  }, [refocusBreak, fixing]);
  // Q31: a break you add, or change (its `id`), and Remove; each with Undo.
  const saveBreak = (start, lengthMin, id) => {
    const before = addedBreaks(routeConfig, todayStr);
    const was = id == null ? null : before.find(b => b.id === id) || null;
    const item = { id: id ?? newBreakId(), kind: "break", start, lengthMin };
    setAddedBreaks(id == null ? [...before, item] : before.map(b => (b.id === id ? item : b)));
    // Q36a: a break now ends a focus session running, saved as it stands
    // (until Focus 59's pause, when Resume starts a new one). Changing a
    // break that already covered now doesn't end one started during it.
    const nowMin = currentDayMinutes(windows);
    const covers = (b) => !!b && b.start <= nowMin && nowMin < b.start + b.lengthMin;
    if (covers(item) && !covers(was) && focusTimer?.focusSessionId) onEndFocus?.();
    setFixing(null);
    if (id != null) focusBreak(id);
    setUndo({ kind: "breaks", date: todayStr, breaks: before, message: `Break ${formatClock24(start)}–${formatClock24(start + lengthMin)}${id == null ? " added" : ""}`, at: Date.now() });
  };
  const removeBreak = (id) => {
    const before = addedBreaks(routeConfig, todayStr);
    setAddedBreaks(before.filter(b => b.id !== id));
    setFixing(null);
    setUndo({ kind: "breaks", date: todayStr, breaks: before, message: "Break removed", at: Date.now() });
  };

  // Q47.5: "Did it happen?" → Move → Later today: the next free slot it
  // fits before the day ends, if there is one.
  const laterFor = (task) => {
    return laterTodaySlot(rows, breaks, Math.max(nowMins, anchorMinutes), getEstimate(task), plan.dayEnd);
  };

  // Q36a: "Did it happen?" → Move → Tomorrow: it goes to tomorrow's
  // "Moved from yesterday", its fixed time cleared, with Undo.
  const moveOneToTomorrow = (task) => {
    const { tasks: nextTasks, before } = moveToTomorrow(latestTasks(), [getTaskId(task)], tomorrowStr);
    savePayload({ ...payloadRef.current, tasks: nextTasks, timestamp: Date.now() });
    setFixing(null);
    setUndo({ message: `Moved to tomorrow: ${task.title}`, before, at: Date.now() });
  };

  // Unfix: the stop flows with the route again, with Undo.
  const unfix = (taskId) => {
    const task = scheduledTasks.find(t => getTaskId(t) === taskId);
    if (!task) return;
    const { dayMapFixedMinutes, ...flowing } = task;
    applyAndSave(scheduledTasks.map(t => (getTaskId(t) === taskId ? flowing : t)), anchorMinutes);
    // The WAS badges were about the fix; with it gone they'd point nowhere
    // (Codex review of #425).
    setWasStarts(null);
    setUndo({ message: `No fixed time: ${task.title}`, before: [...scheduledTasks], at: Date.now() });
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
    // The drop is read on the route as it shows (a stop pulled forward sits
    // ahead of its place in the order), and that order is what is kept
    // (Codex review of #421).
    const shown = routeTasks.map(t => scheduledTasks.find(s => getTaskId(s) === getTaskId(t))).filter(Boolean);
    const oldIndex = shown.findIndex(t => getTaskId(t) === active.id);
    const newIndex = shown.findIndex(t => getTaskId(t) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    applyAndSave(arrayMove(shown, oldIndex, newIndex), anchorMinutes, null, { listFollows: true });
  };

  const n = plan.wontFit.length;
  const isOver = n > 0;
  const dayEndLabel = formatClock24(plan.dayEnd);
  const nowMins = currentDayMinutes(windows);

  // The route (50f): the rows as laid out — stops, breaks, free time — the
  // DAY ENDS line where it falls, then what won't fit today.
  // Turn 76 (c): one cut for Today and the Day map. A task fits whole or
  // not; what doesn't fit is told as its total; the gap left before the day
  // ends is free time.
  const fitCut = routeCut(routeTasks, plan);
  const free = fitCut.spare;
  const wontFit = { count: plan.wontFit.length, minutes: fitCut.wontFitMinutes };

  // 56a–c: what was done today (focus sessions, and tasks ticked done), the
  // factual line, and the day bar. With no ledger to read (demo, a refused
  // read) the done part is left out rather than read as nothing done.
  const { raw: ledgerRaw, status: ledgerStatus } = useFocusLedger(uid, 1, windows);
  const done = doneToday(ledgerStatus === "ready" ? ledgerRaw : null, tasks, todayStr, windows);
  const doneMinutes = ledgerStatus === "ready" ? done.reduce((sum, r) => sum + r.minutes, 0) : null;
  // Where the route ends. A fixed stop whose time has passed but is still
  // open ends its length from now, not at its stale time (Codex review of
  // #428).
  const stopRows = rows.filter(r => r.kind === "stop");
  // The day ends where the last focus window ends. Opened after it, the
  // route starts at now and plan.dayEnd would be now too (Codex review of
  // #428).
  const windowEnds = mergeWindowSpans(windows).map(([, end]) => end);
  const dayEnd = windowEnds.length ? Math.max(...windowEnds) : plan.dayEnd;
  const finish = stopRows.length ? Math.max(...stopRows.map(r => (r.late ? nowMins + (r.end - r.start) : r.end))) : null;
  // Every stop still on the route counts as left, fixed ones too (Codex
  // review of #428).
  const leftStops = routeTasks;
  const fact = factualLine({
    doneMinutes,
    doneCount: done.length,
    routeEmpty: !scheduledTasks.length,
    openTasks: activeTodayTasks.length - tomorrowTasks.length,
    finish: finish ?? nowMins,
    dayEnd,
    now: nowMins,
    left: { count: leftStops.length, minutes: leftStops.reduce((sum, t) => sum + getEstimate(t), 0) },
    wontFit,
  });
  const windowStart = mergeWindowSpans(windows)[0]?.[0];
  const firstSession = done.find(r => r.kind === "session");
  const bar = windowStart == null ? null : dayBar({ windowStart, firstSessionStart: firstSession?.start ?? null, now: nowMins, dayEnd, finish });
  // The bar's legend from the same finish as the line: a late fixed stop
  // still open counts from now (Codex review of #428).
  const barPlanned = finish == null ? plan.planned : Math.max(0, finish - Math.max(anchorMinutes, nowMins));
  const barOverBy = finish == null ? 0 : Math.max(0, finish - dayEnd);
  const dayEndText = `DAY ENDS ${dayEndLabel}`
    + (free > 0 ? ` · ${formatSpan(free)} FREE` : "");
  const routeIndex = new Map(routeTasks.map((t, i) => [getTaskId(t), i]));
  // NOW is the first stop, unless it is a fixed time already passed (that
  // row says "now" in red instead).
  const firstOnTime = rows.find(r => r.kind === "stop" && !r.late);
  // The DAY ENDS line falls before the first row of the first stop that
  // won't fit, so a stop a break split stays in one piece, in time order,
  // under it (Codex review of #425).
  const cut = plan.overIndex === -1 ? rows.length
    : rows.findIndex(r => r.kind === "stop" && routeIndex.get(getTaskId(r.task)) >= plan.overIndex);
  const rowIsOver = (r) => rows.indexOf(r) >= cut;
  // Minimum day (56a–b): today's open tasks in the order they come, the
  // route as it shows.
  const openToday = routeTasks.map(t => scheduledTasks.find(s => getTaskId(s) === getTaskId(t))).filter(Boolean);
  // Turn 76 (d): only tasks that fit before the day ends are suggested.
  const minDay = minimumDay({ config: routeConfig, todayStr, ordered: openToday, isGoal, fits: (t) => !fitCut.overIds.has(getTaskId(t)) });
  const minIds = new Set(minDay.ids);
  const timeOf = (id) => {
    const r = rows.find(x => x.kind === "stop" && getTaskId(x.task) === id);
    if (!r) return "";
    return r === firstOnTime && r.start <= nowMins + 15 ? "NOW" : formatClock24(r.start);
  };
  const confirmMin = (ids) => {
    const p = payloadRef.current;
    savePayload({ ...p, config: confirmMinimumDay(p?.config || {}, todayStr, ids), timestamp: Date.now() });
  };
  // 56a–b: "Over by 40m. Two tasks won't fit." beside an outlined Move.
  const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  const wontFitCount = plan.wontFit.length;
  const renderRow = (r) => {
    if (r.kind === "break" && r.added != null) {
      // A break you added opens its own sheet: Length, Time, Remove (Q31).
      const item = addedBreaks(routeConfig, todayStr).find(b => b.id === r.added);
      const open = () => item && setFixing({ breakItem: { id: item.id, start: Number(item.start), lengthMin: Number(item.lengthMin) } });
      return (
        <li key={`added:${r.added}:${r.start}`} className="dm-break is-added">
          <div
            className="dm-main"
            role="button"
            tabIndex={0}
            data-break-id={r.added}
            aria-label={`${formatClock24(r.start)} to ${formatClock24(r.end)}, ${r.name}`}
            onClick={open}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
          >
            <span className="dm-time">{formatClock24(r.start)}</span>
            <span className="dm-rail" aria-hidden="true"><span className="dm-dash" /></span>
            <span className="dm-title">{r.name}</span>
            <span className="dm-dur">{formatSpan(r.end - r.start)}</span>
          </div>
        </li>
      );
    }
    if (r.kind === "break") {
      return (
        <li key={`break:${r.start}`} className="dm-break" aria-label={`${formatClock24(r.start)} to ${formatClock24(r.end)}, ${r.name}`}>
          <span className="dm-time">{formatClock24(r.start)}</span>
          <span className="dm-rail" aria-hidden="true"><span className="dm-dash" /></span>
          <span className="dm-title">{r.name}</span>
          <span className="dm-dur">{formatSpan(r.end - r.start)}</span>
        </li>
      );
    }
    if (r.kind === "free") {
      return (
        <li key={`free:${r.start}`} className="dm-free" aria-label={`${formatClock24(r.start)} to ${formatClock24(r.end)}, free`}>
          <span className="dm-time">{formatClock24(r.start)}</span>
          <span className="dm-rail" aria-hidden="true" />
          <span className="dm-title">free {formatSpan(r.end - r.start)}</span>
          <span className="dm-dur" />
        </li>
      );
    }
    const { task } = r;
    const id = getTaskId(task);
    if (r.continued) {
      // The rest of a stop a break split: it opens the same task.
      return (
        <li key={`${id}:continued:${r.start}`} className={`dm-stop is-continued${rowIsOver(r) ? " is-over" : ""}`}>
          <div
            className="dm-main"
            role="button"
            tabIndex={0}
            aria-label={`${formatClock24(r.start)} to ${formatClock24(r.end)}, ${task.title}, continued after the break`}
            onClick={() => setDetailId(id)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailId(id); } }}
          >
            <span className="dm-time">{formatClock24(r.start)}</span>
            <span className="dm-rail" aria-hidden="true"><span className={`dm-dot${rowIsOver(r) ? " is-over" : ""}`} /></span>
            <span className="dm-title">{task.title} · continued</span>
            <span className="dm-dur">{formatSpan(r.end - r.start)}</span>
          </div>
        </li>
      );
    }
    const isNowRow = r === firstOnTime && r.start <= nowMins + 15;
    return (
      <RouteStop
        key={id}
        task={task}
        row={r}
        fromYesterday={task.deferredUntil === todayStr}
        isNow={isNowRow}
        min={minIds.has(id) ? minDay.state : null}
        until={isNowRow && task.isNowFocus ? routeTasks.find(t => getTaskId(t) === id)?.routeEndMinutes ?? null : null}
        isOver={rowIsOver(r)}
        isGoal={isGoal(task)}
        isOpen={detailId === id}
        onOpen={() => { if (!draggingRef.current) setDetailId(id); }}
        onStartFocus={() => startFocus(id)}
        asks={eventAsks(r, nowMins) ? {
          laterAt: laterFor(task),
          onDone: () => act(actions.handleMarkDone)(task),
          onLater: (at) => fixTime(task, at, false),
          onTomorrow: () => moveOneToTomorrow(task),
          onPickTime: () => setFixing({ task }),
        } : null}
        was={wasStarts?.get(id) ?? null}
        flash={flashId === id}
      />
    );
  };
  // The route is timed again when a sheet action asks (Done, Park, Delete
  // and their Undo), or when it has a gap or an overlap from any other write
  // (the full editor, Today, another device). A stop put back by Undo keeps
  // its old order, which it now shares with the stop that moved up into its
  // place: it goes first, back where it was.
  //
  // With no From set, the route starts now: a first stop that starts later
  // than now's quarter hour is a gap too (the stop before it went).
  useEffect(() => {
    const pending = pendingReflowRef.current;
    const fromSet = routeConfig.dayMapDate === todayStr && routeConfig.dayMapAnchorMinutes != null;
    const start = fromSet ? anchorMinutes : currentDayMinutes(windows);
    // A fixed stop keeps its own time: the head is the first stop that flows.
    const headGap = !fromSet && hasHeadGap(scheduledTasks, start, todayStr, breaks);
    if (!pending && !headGap && routeIsContiguous(scheduledTasks, breaks)) return;
    pendingReflowRef.current = null;
    const prefer = pending?.prefer ?? null;
    const order = (t) => t.dayMapOrder ?? Infinity;
    const route = [...scheduledTasks].sort((a, b) => (order(a) - order(b))
      || ((getTaskId(b) === prefer) - (getTaskId(a) === prefer)));
    applyAndSave(route, start);
  }, [scheduledTasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // The sheet on phones and tablets, the drawer from 1024px (as in Plan).
  // Its place is its place on screen (routeTasks: time order), for "N OF M"
  // and ↑/↓; the task itself is the stored one.
  const detailTask = detailId ? scheduledTasks.find(t => getTaskId(t) === detailId) : null;
  const detailIndex = detailTask ? routeIndex.get(detailId) ?? -1 : -1;
  const routeNeighbour = (i) => {
    const t = routeTasks[i];
    return t ? scheduledTasks.find(s => getTaskId(s) === getTaskId(t)) : undefined;
  };
  // Done, parked, deleted, off the route or off Today: the sheet closes.
  useEffect(() => {
    if (detailId && !detailTask) setDetailId(null);
  }, [detailId, detailTask]);
  const focusStop = (id) => requestAnimationFrame(() => document.querySelector(`.dm-route [data-task-uuid="${window.CSS.escape(id)}"] .dm-main`)?.focus());
  const closeDetail = () => { const back = detailId; setDetailId(null); if (back) focusStop(back); };
  // An action that takes the task off the route: focus goes to its neighbour.
  const leaving = (fn, arg = detailTask) => {
    const next = routeNeighbour(detailIndex + 1) || routeNeighbour(detailIndex - 1);
    fn(arg);
    if (next) focusStop(getTaskId(next));
  };
  // ↑/↓ move through the route; Esc closes and hands focus back to the stop.
  const onDetailKeyDown = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !detailTask) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeDetail(); return; }
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const next = dir && routeNeighbour(detailIndex + dir);
    if (!next) return;
    e.preventDefault();
    setDetailId(getTaskId(next));
  };
  const detailOpenRef = useRef(false);
  detailOpenRef.current = !!detailTask;
  const closeDetailRef = useRef(closeDetail);
  closeDetailRef.current = closeDetail;
  const [drawerViewport, setDrawerViewport] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  useEffect(() => {
    const update = () => setDrawerViewport(window.innerWidth >= 1024);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // 52d / 56a–b: From · Fixed time. Above the route on a phone; in the
  // right column from 1024px.
  const controls = (
    <div className="dm-controls">
      <DayMapFrom anchorMinutes={anchorMinutes} onChangeAnchor={setAnchor} windows={windows} />
      <button type="button" className="dm-text-btn" onClick={() => setFixing({})}>Fixed time</button>
    </div>
  );

  const close = () => { flushNow(); onClose(); };
  // Esc goes back (50e–f), unless a dialog or a field is taking it.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // An open drawer takes Esc before the page does, wherever focus is.
      if (detailOpenRef.current) { closeDetailRef.current(); return; }
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Done so far today (56a–c): folded above the route, and kept when the
  // last task is done, where the day's sessions matter most (Codex review
  // of #428).
  const doneFold = done.length > 0 && (
    <section className="dm-done" aria-label="Done so far today">
      <button type="button" className="dm-done-toggle" aria-expanded={doneOpen} onClick={() => setDoneOpen(o => !o)}>
        <span className="dm-time" />
        <span className="dm-rail" aria-hidden="true"><span className="dm-dot is-done"><IconCheck size={10} /></span></span>
        <span className="dm-title">Done so far today · {done.length}</span>
        <span className="dm-dur">{doneMinutes != null && doneMinutes > 0 ? formatSpan(doneMinutes).toUpperCase() : ""} <IconChevronDown size={16} /></span>
      </button>
      {doneOpen && (
        <ol className="dm-done-list">
          {done.map(r => (
            <li key={`${r.kind}:${r.id}`} className="dm-done-row">
              <span className="dm-time">{r.start == null ? "" : formatClock24(r.start)}</span>
              <span className="dm-rail" aria-hidden="true"><span className="dm-dot is-done"><IconCheck size={10} /></span></span>
              <span className="dm-title">{r.title}{r.kind === "marked" && <span className="dm-pulled">MARKED DONE</span>}</span>
              <span className="dm-dur">{r.kind === "session" ? formatSpan(r.minutes) : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const undoText = actions.undo ? actions.undoText : undo ? undo.message : "";
  const onUndo = actions.undo ? undoAction : handleUndo;
  const toastAt = actions.undo?.at ?? undo?.at;

  return (
    <div className="day-map-page">
      {/* 56a–c: Back (Esc), the title and the factual line. The date and the
          time left are the app header's (50e–f). */}
      <div className="dm-head">
        <button type="button" className="dm-back" onClick={close} aria-label={`Back to ${backLabel}`}>
          <IconChevronLeft size={22} />
          <span className="dm-back-label">{backLabel}</span>
          <kbd className="wall-key dm-back-key" aria-hidden="true">Esc</kbd>
        </button>
        <h1 className="dm-heading">Day map</h1>
        {dayClock && <span className="dm-date">{dayClock.date}</span>}
        {/* 55d–e: always in the header (a text button on a phone). */}
        {/* Q48.2: not before the day has started. */}
        {onCloseDay && closeDayOffered(nowMins, mergeWindowSpans(windows)[0]?.[0] ?? 0) && (
          <button type="button" className="dm-close-day" onClick={onCloseDay}>Close the day</button>
        )}
        {/* 56a–c: one sentence, recomputed on every change; never a quote. */}
        <p className="dm-fact">{fact.text}{fact.alert && <span className="dm-fact-alert">{fact.alert}</span>}</p>
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
          {doneFold}
          {/* A call or a meeting can be the first thing on an empty day. */}
          <button type="button" className="dm-text-btn" onClick={() => setFixing({})}>Fixed time</button>
        </section>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={() => { draggingRef.current = true; }}
          onDragEnd={(e) => { setTimeout(() => { draggingRef.current = false; }, 0); handleDragEnd(e); }}
          onDragCancel={() => { setTimeout(() => { draggingRef.current = false; }, 0); }}
        >
          <div className="dm-layout">
            {bar && (
              <DayBar bar={bar} now={nowMins} doneMinutes={doneMinutes} plannedMinutes={barPlanned} overBy={barOverBy} wontFitMinutes={wontFit.count > 0 ? wontFit.minutes : null} />
            )}
            {/* 52d: From · Fixed time, as text, above the route. */}
            {!drawerViewport && controls}

            <div className="dm-route-wrap">
              {doneFold}
              {scheduledTasks.length > 0 && (
                <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                  <ol className="dm-route" aria-label="Today's route">
                    {rows.filter(r => !rowIsOver(r)).map(renderRow)}
                    <li className="dm-dayend" aria-label={`Day ends at ${dayEndLabel}`}>
                      <span className="dm-dayend-label">{dayEndText}</span>
                    </li>
                    {rows.filter(rowIsOver).map(renderRow)}
                  </ol>
                </SortableContext>
              )}
              {tomorrowTasks.length > 0 && (
                <p className="dm-tomorrow-note">{tomorrowTasks.length} {tomorrowTasks.length === 1 ? "task now starts" : "tasks now start"} tomorrow.</p>
              )}
              {!drawerViewport && openToday.length > 0 && (
                <MinimumDay state={minDay.state} ids={minDay.ids} tasks={openToday} timeOf={timeOf} onConfirm={confirmMin} />
              )}
              {(isOver || plan.overBy > 0) && onHelpChoose && (
                <button type="button" className="dm-text-btn is-alert dm-help" onClick={onHelpChoose}>Help me choose</button>
              )}
            </div>

            {/* The action: a card on a laptop (52e); on a phone a button
                above the nav (52d). */}
            <div className="dm-side" style={navHeight ? { "--dm-nav-h": `${navHeight}px` } : undefined}>
              {drawerViewport && openToday.length > 0 && (
                <MinimumDay state={minDay.state} ids={minDay.ids} tasks={openToday} timeOf={timeOf} onConfirm={confirmMin} />
              )}
              {drawerViewport && controls}
              {movable.length > 0 && (drawerViewport ? (
                <div className="dm-over">
                  <p className="dm-over-text">
                    <strong>{wontFitCount <= 10 ? NUMBER_WORDS[wontFitCount] : wontFitCount} {wontFitCount === 1 ? "task won’t" : "tasks won’t"} fit · {formatSpan(wontFit.minutes)}.</strong>
                  </p>
                  <button type="button" className="dm-btn-outline" onClick={moveOverToTomorrow}>Move {movable.length} to tomorrow</button>
                </div>
              ) : (
                <button type="button" className="dm-move" onClick={moveOverToTomorrow}>Move {movable.length} to tomorrow</button>
              ))}
            </div>
          </div>
          {/* Empty, yet needed: without an overlay, a keyboard drag's drop
              often lands back where it started. */}
          <DragOverlay dropAnimation={null} />
        </DndContext>
      )}

      {fixing && (
        <FixTimeSheet
          routeTasks={routeTasks}
          stops={scheduledTasks}
          task={fixing.task}
          breakItem={fixing.breakItem}
          // From a later From, the route's start: a break before it would
          // never show (loopcheck of #430).
          breakDefault={defaultBreak(rows, Math.max(nowMins, anchorMinutes), busyFromRows(rows, breaks))}
          laterAt={nextFreeSlot(rows, Math.max(nowMins, anchorMinutes))}
          busy={busyFromRows(rows, breaks, fixing.breakItem ? fixing.breakItem.id : null)}
          onBreak={saveBreak}
          onRemoveBreak={removeBreak}
          onTomorrow={fixing.task && eventAsks(rows.find(x => x.kind === "stop" && getTaskId(x.task) === getTaskId(fixing.task)), nowMins) ? () => moveOneToTomorrow(fixing.task) : undefined}
          from={anchorMinutes}
          breaks={breaks}
          nowMins={nowMins}
          dayStart={mergeWindowSpans(windows)[0]?.[0] ?? 0}
          dayEnd={Math.max(0, ...mergeWindowSpans(windows).map(([, end]) => end))}
          durationOf={getEstimate}
          getTaskId={getTaskId}
          onFix={fixTime}
          onClose={() => {
            // Back to the break row it came from (10b); a task's sheet
            // hands focus back its own way.
            const at = fixing?.breakItem?.id;
            setFixing(null);
            if (at != null) focusBreak(at);
          }}
          newBlocked={isEveningGuardBlocked(routeConfig)}
        />
      )}

      <UndoAnnouncer message={undoText} />
      {detailTask && !drawerViewport && <div className="task-detail-scrim" onClick={closeDetail} aria-hidden="true" />}
      {detailTask && (
        <div onKeyDown={onDetailKeyDown}>
          <TaskDetail
            key={detailTask.uuid || detailId}
            // Its estimate is the stop's duration, as the route times it.
            task={{ ...detailTask, timeEstimateMinutes: getEstimate(detailTask) }}
            horizonChoices={horizonChoices(routeConfig, todayStr)}
            variant={drawerViewport ? "drawer" : "sheet"}
            kicker={`DAY MAP · ${detailIndex + 1} OF ${scheduledTasks.length}`}
            isGoal={isGoal(detailTask)}
            fronts={frontsOnOffer(frontsFromConfig(payload.config || {}), detailTask.frontId)}
            onClose={closeDetail}
            onPatch={patch => {
              const { timeEstimateMinutes, horizonLevel, ...rest } = patch;
              if (timeEstimateMinutes !== undefined) changeDuration(detailId, timeEstimateMinutes);
              if (horizonLevel && horizonLevel !== detailTask.horizonLevel) act(actions.handleChangeHorizon)(detailTask, horizonLevel);
              if (Object.keys(rest).length) actions.patchTask(detailTask.uuid, rest);
            }}
            onSetSteps={(steps, meta) => { if (meta?.removed) setRouteUndo(null); actions.handleSetSteps(detailTask, steps, meta); }}
            onDone={() => leaving(act(actions.handleMarkDone))}
            fixedAt={isFixedStop(detailTask) ? formatClock24(detailTask.dayMapFixedMinutes) : null}
            onFixTime={() => { const t = detailTask; setDetailId(null); setFixing({ task: t }); }}
            onUnfix={isFixedStop(detailTask) ? () => unfix(detailId) : undefined}
            onPark={() => leaving(act(actions.handlePark))}
            onDelete={() => leaving(act(actions.handleDelete))}
          />
        </div>
      )}

      {(undo || actions.undo) && <UndoToast key={toastAt} message={undoText} onUndo={onUndo} onClose={() => { setRouteUndo(null); actions.setUndo(null); }} />}
    </div>
  );
}
