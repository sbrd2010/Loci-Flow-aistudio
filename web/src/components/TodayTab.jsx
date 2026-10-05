import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { horizonChoices } from "../utils/planLadder";
import TaskRow, { ROADMAP_HORIZONS } from "./TaskRow";
import SplitTaskSheet from "./SplitTaskSheet";
import { buildSplit, undoSplit } from "../utils/splitTask";
import TodayWall from "./TodayWall";
import Momentum from "./Momentum";
import { LEGACY_DEADLINE_FRONT_ID, frontsFromConfig, frontsOnOffer, commitmentDaysLeft, commitmentKickerFront, frontForCommitment, frontProgress } from "../utils/fronts";
import { useFocusLedger } from "../hooks/useFocusLedger";
import { minutesForTaskOn } from "../utils/focusLedger";
import { buildMomentum } from "../utils/momentum";
import { isEveningGuardBlocked } from "../utils/eveningGuard";
import FocusModePage from "./FocusModePage";
import RescueMode from "./RescueMode";
import { safeUUID } from "../utils/uuid";
import { endSessionTasks, switchToNextTasks, withNextStep } from "../utils/focusEnd";
import { taskSteps, stepsPatch, applyStepsPatch } from "../utils/taskSteps";
import { buildToggleCompletedTasks } from "../utils/taskOps";
import { buildParkTaskTasks } from "../utils/coachActions";
import { shouldStopFocusOnComplete, focusBlockSeconds, chosenStartOption } from "../utils/focusSession";
import { getAIKeys, callAI, extractJsonArray, hasAIKey } from "../utils/aiCall";
import { celebrate } from "../utils/celebrations";
import { track } from "../firebase";
import { cancelReminder } from "../utils/reminders";
import { getLociDayStr } from "../utils/dailyAnchors";
import { getFocusWindows } from "../utils/focusWindows";
import { buildTaskMutationEvent, buildFocusStartedEvent, buildFocusTerminalEvent, eventPatch, eventsPatch } from "../utils/activityLog";
import { committedTaskIdsForDay, shouldShowReflection } from "../utils/dailyCoachCheckins";
import "../styles/focusNow.css";
import "../styles/todayList.css";
import "../styles/todaySheet.css";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import {
  DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, DragOverlay
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { isDeferred, isOnToday } from "../utils/deferral";
import { IconPlus } from "./ui/icons";
import TaskDetail from "./TaskDetail";
import DayMapColumn from "./DayMapColumn";
import { makeOneThing, undoOneThing } from "../utils/oneThing";
import { addThought } from "../utils/thoughts";
import { clearMyDay, undoClearMyDay } from "../utils/clearMyDay";
import { buildGoalRecord, goalStartDay, goalTaskDoneToday, nextGoalTask } from "../utils/goalRecord";
import { horizonsFromConfig } from "../utils/horizons";
import { confirmedMinimumDay } from "../utils/minimumDay";
import { currentDayMinutes, getEstimate, getTaskId, oneThingToNow, restoreRoute, routeCut, routeFollowsList, useDayRoute } from "../hooks/useDayRoute";
import MoreSheet from "./MoreSheet";
import { routeBreaks } from "../utils/dayMapBreaks";
import { isEventTask, isFixedStop } from "../utils/dayMapRoute";
import { bringBack, formatClock24, formatSpanCaps, moveToTomorrow, nextDateStr, restoreSchedule } from "../utils/dayMapPlan";
import { parkedTasks, parkedSince, restoreParked, undoRestoreParked } from "../utils/parked";
import { useListChoreography, listMotionMode } from "../hooks/useListChoreography";

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
  </svg>
);

function SortableTaskItem({ id, isOver = false, disabled = false, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      // Past the Day ends line (Q59): muted, still draggable.
      className={isOver ? "today-row-over" : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        position: "relative",
        zIndex: isDragging ? 0 : "auto",
      }}
    >
      {children({
        dragHandleListeners: listeners,
        dragHandleAttributes: attributes,
        // The row is the keyboard's handle in both modes (50b: one tab stop).
        dragActivatorRef: setActivatorNodeRef,
      })}
    </div>
  );
}

export default function TodayTab({
  payload, savePayload, savePayloadAsync, saveConfigPatch, onOpenDayMap, onOpenMindBox, onOpenPlan, onOpenCoach, onScattered, onOpenAddTask,
  // 57f: "September ended · 2 left · Review" until the review is done.
  reviewLine = null,
  // 55d–e, Q47: "Day ends 17:30 · Close the day"; and the closed day.
  closeLine = null, dayClosed = null, onOpenCloseDay = null,
  // Q49: the goal band opens Settings → Key deadline.
  onOpenKeyDeadline = null,
  // Q55.3: Mind Box asks for Rescue here (where focus can start); Leave tells
  // App, which goes back to where it was opened from.
  rescueRequest = null, onRescueRequestOpened, onRescueClosed,
  // The goal record's Edit goal for a goal that is a stored front: its page.
  onOpenFront = null,
  // The mini window's I'm stuck (59b → 59d).
  stuckPending = false, onStuckShown,
  activeTask, isTimerRunning, setIsTimerRunning, timerSecondsLeft,
  timerMaxSeconds, setTimerMaxSeconds, isFocusMode, setIsFocusMode,
  focusSessionActive, setFocusSessionActive, sessionCompletePending,
  pipOpen, handleOpenPiP, keepTimerOnTaskChange, blockEnd, startBreak, startNextBlock, setNextLen, setBlockEndHeld, isAddTaskDialogOpen, startFocusSession, endFocusSession, focusSessionId, focusSessionTaskUuid, changeFocusDuration,
  extendTimer, addTimeToSession, dismissSessionComplete, focusStartedAt, focusElapsedSeconds, focusBlockNumber,
  selectedTrack, volume, trackLoadState, selectTrack, selectCategory, reshuffleTrack, changeVolume,
  isSyncingFromCache = false,
  pendingCheckinSlot, setPendingCheckinSlot,
  syncWarning = null,
  uid, writeActivityEvents,
}) {
  const { tasks = [], config = {}, contributions = [] } = payload;
  // 70: on touch the grip is gone and a long-press lifts the row.
  const coarsePointer = typeof window !== "undefined" && !!window.matchMedia?.("(hover: none)").matches;
  const taskRowInteractionStyle = coarsePointer || config.taskRowInteractionStyle === "dragAnywhere" ? "dragAnywhere" : "classic";
  const windows = getFocusWindows(config);

  // Live (non-stale) read of focusSessionId for async callbacks (e.g.
  // startFocusAndLog's pinPromise handlers below) — the `focusSessionId`
  // PROP is a snapshot from whichever render the callback's closure was
  // created in; startFocusSession()'s setFocusSessionId() call doesn't
  // reach that closure until a LATER render, which a callback firing after
  // an async wait (a rejected pin write) would otherwise miss entirely.
  const focusSessionIdRef = useRef(focusSessionId);
  focusSessionIdRef.current = focusSessionId;

  // Starts a focus session on `task` and writes its focus_started event —
  // if startFocusSession() had to auto-close a still-open prior session to
  // make room for this one (e.g. Day Map's "Start Focus" while another
  // task's session is running), also writes that session's focus_abandoned
  // terminal event so it isn't silently orphaned.
  //
  // `pinPromise` (optional) is a still-in-flight pin write (e.g. Focus Now's
  // "pin then immediately start" button) — if given, ledger events wait for
  // it to confirm instead of logging for a pin that might not have landed.
  // `options` is passed straight to startFocusSession — the wall's start
  // chooser uses it for the length picked there (53e).
  // The wall's Start (and Space): the length picked in its chooser (53e). A
  // session already running on the task only resumes — a length would start
  // a new one and abandon it.
  const startWallFocus = (task) => {
    if (activeTask?.uuid === task.uuid && focusSessionId && focusSessionTaskUuid === task.uuid) {
      startFocusAndLog(task);
      return;
    }
    const option = chosenStartOption(config.focusStartChoice, focusBlockSeconds(config) / 60, task.timeEstimateMinutes);
    startFocusAndLog(task, null, { plannedSeconds: option.minutes * 60 });
  };
  const startFocusAndLog = (task, pinPromise, options) => {
    // If this task already has an open session (e.g. the user backed out of
    // the full-screen overlay while the timer kept running, then taps Focus
    // again on the same task), just reopen the overlay — treating this as a
    // brand-new session would auto-close the in-progress one and fragment
    // the ledger for what's really just a return-to-focus action.
    // ...unless the caller asked for a specific length. "Start small — 5
    // minutes" reaching this branch would resume whatever was already
    // running — a 25-minute countdown under a button promising five.
    // startFocusSession closes the open session with a proper terminal
    // event, so restarting here doesn't orphan anything.
    if (activeTask?.uuid === task.uuid && focusSessionId && focusSessionTaskUuid === task.uuid
        && !(Number(options?.plannedSeconds) > 0)) {
      setIsFocusMode(true);
      // At block end (Q41) this opens the block-end screen; it must not run
      // a finished block on from 0:00.
      if (!sessionCompletePending) setIsTimerRunning(true);
      return;
    }
    const session = startFocusSession(task, options);
    (pinPromise || Promise.resolve())
      .then(() => {
        if (session.priorSession && session.priorSession.task) {
          const abandonEvent = buildFocusTerminalEvent("focus_abandoned", session.priorSession.task, session.priorSession.focusSessionId, {
            ...session.priorSession, windows,
          });
          writeActivityEvents(eventPatch(uid, abandonEvent));
        }
        const startedEvent = buildFocusStartedEvent(task, session.focusSessionId, {
          focusInitialPlannedSeconds: session.focusInitialPlannedSeconds, now: session.focusStartedAt, windows,
        });
        writeActivityEvents(eventPatch(uid, startedEvent));
      })
      .catch(() => {
        // The pin write that was supposed to back this session never
        // confirmed (offline, drop-guard, etc.) — undo the optimistic
        // session start rather than leaving a focusSessionId open with no
        // focus_started event, which would otherwise surface later as an
        // orphaned terminal event with nothing to match. Only end it if
        // nothing else has already started a newer session in the meantime
        // — compare against focusSessionIdRef.current (live), not the
        // `focusSessionId` prop this closure captured at call time, which
        // stays stale until a later render and would make this check
        // silently never trigger.
        if (focusSessionIdRef.current === session.focusSessionId) {
          endFocusSession("user_abandoned");
          setIsTimerRunning(false);
          setIsFocusMode(false);
          setFocusSessionActive(false);
        }
      });
  };

  const [rescueActive, setRescueActive] = useState(false);
  const [rescueTask, setRescueTask] = useState(null);
  const [rescueEntryPoint, setRescueEntryPoint] = useState("today");
  const [isMVDMode, setIsMVDMode] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState(null);
  // "peekOpen is persisted to localStorage." Closed by default — the wall is
  // the default state, and the peek is how you ask for the rest.
  const [peekOpen, setPeekOpen] = useState(() => {
    try { return localStorage.getItem("loci_today_peek_open") === "1"; } catch { return false; }
  });
  // The phone sheet's height when open: half (37b) or full (37c). Every open
  // starts at half; full is a choice made each time.
  const [sheetFull, setSheetFull] = useState(false);
  const [sheetViewport, setSheetViewport] = useState(() => typeof window !== "undefined" && window.innerWidth < 840);
  // A task, opened (50a–b): a sheet below 1024px, a non-modal drawer above.
  // Q58: the phone's More sheet for the one thing (67d).
  const [moreOpen, setMoreOpen] = useState(false);
  const [drawerViewport, setDrawerViewport] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  // Q59: the list and the Day map are two views of one plan, behind a
  // List | Day map switch; the view last left is kept (this device).
  const [listView, setListViewState] = useState(() => {
    try { return window.localStorage.getItem("loci_today_view") === "daymap" ? "daymap" : "list"; } catch { return "list"; }
  });
  const setListView = (v) => {
    setListViewState(v);
    try { window.localStorage.setItem("loci_today_view", v); } catch { /* private mode */ }
  };
  const [detailUuid, setDetailUuid] = useState(null);
  const [rowFocusUuid, setRowFocusUuid] = useState(null);
  // E asks the open task to edit its title: tied to that task, so a task
  // opened later with Enter or a tap opens normally.
  const [editTitle, setEditTitle] = useState(null); // { uuid, n }
  useEffect(() => { if (!peekOpen) setSheetFull(false); }, [peekOpen]);
  useEffect(() => {
    const update = () => { setSheetViewport(window.innerWidth < 840); setDrawerViewport(window.innerWidth >= 1024); };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const sheetRef = useRef(null);
  const sheetDragRef = useRef(null);
  const layoutRef = useRef(null);
  const peekOpenRef = useRef(peekOpen);
  peekOpenRef.current = peekOpen;
  // From 840px the list shows and hides with the 51 choreography; phones
  // keep the sheet.
  const toggleList = useListChoreography({ rootRef: layoutRef, listRef: sheetRef, setOpen: setPeekOpen });
  const closeSheet = () => {
    const hadFocus = sheetRef.current?.contains(document.activeElement);
    setPeekOpen(false);
    if (hadFocus) requestAnimationFrame(() => document.querySelector(".wall-peek")?.focus());
  };
  // Dragging the grabber moves the sheet with the finger (no re-render per
  // move), then settles on the nearest height: up to full, down to half, or
  // far enough down to close. A drag that barely moves is left to the click.
  const onSheetPointerDown = (e) => {
    const el = sheetRef.current;
    if (!el || e.isPrimary === false) return;
    sheetDragRef.current = null;
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const wasFull = sheetFull;
    let dy = 0;
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      dy = ev.clientY - startY;
      if (Math.abs(dy) < 6) return;
      sheetDragRef.current = true;
      el.style.transition = "none";
      el.style.transform = `translateY(${Math.max(dy, wasFull ? 0 : -el.offsetHeight)}px)`;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      el.style.transition = "";
      el.style.transform = "";
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (!sheetDragRef.current) return;
      // Keep the drag flag through the click that may follow pointerup.
      setTimeout(() => { sheetDragRef.current = null; }, 0);
      if (dy < -60) setSheetFull(true);
      else if (wasFull && dy > 60 && dy < 240) setSheetFull(false);
      else if (dy > (wasFull ? 240 : 80)) closeSheet();
    };
    const cancel = (ev) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      sheetDragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };
  const onSheetGrabberClick = () => {
    // The click that ends a drag is not a tap.
    if (sheetDragRef.current) { sheetDragRef.current = null; return; }
    setSheetFull(v => !v);
  };
  useEffect(() => {
    try { localStorage.setItem("loci_today_peek_open", peekOpen ? "1" : "0"); } catch { /* private mode */ }
  }, [peekOpen]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    // Space picks a row up; Enter is the row's own (it opens the task, 50b).
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } })
  );

  const [rescueInitialState, setRescueInitialState] = useState(null);
  // Opened from Mind Box: Leave goes back there.
  const [rescueFromMindBox, setRescueFromMindBox] = useState(false);
  const openRescueMode = (initialState = null, fromMindBox = false) => {
    setRescueInitialState(typeof initialState === "string" ? initialState : null);
    setRescueFromMindBox(fromMindBox === true);
    if ((isFocusMode || isTimerRunning || focusSessionActive) && activeTask) {
      // Opened from inside an active Deep Focus session (the Stuck? button) —
      // rescue the task actually being focused on, even if it isn't in
      // todayTasksAll (e.g. pinned via a Coach action without moving horizons).
      setRescueTask(activeTask);
      setRescueEntryPoint("deep_focus");
    } else {
      // Opened from the Today-tab chip, with no session context — restrict
      // candidates to today's visible, active tasks (matching pinnedFocusTask's
      // own filtering), since a parked task or one from another horizon can't
      // be shown by Today's pinned-focus UI even if pinned.
      // Q36.3: a call at a set time is never Rescue's one task.
      const candidates = todayTasksAll.filter(t => !t.isCompleted && !isEventTask(t));
      const pinned = candidates.find(t => t.isNowFocus);
      setRescueTask(pinned || candidates[0] || null);
      setRescueEntryPoint("today");
    }
    setRescueActive(true);
    // isFocusMode only reflects whether the full-screen overlay is open —
    // a session left running via the floating mini-timer after exiting the
    // overlay keeps isTimerRunning true, so check that directly instead.
    if (isTimerRunning) setIsTimerRunning(false);
  };

  const todayStr = getLociDayStr(new Date(), windows);

  // ── Daily Anchors derived state ────────────────────────────────────────────
  const anchors = config.dailyAnchors || [];
  const anchorTodayStr = todayStr;

  const [breakdownLoadingUuid, setBreakdownLoadingUuid] = useState(null);
  const [breakdownErrorUuid, setBreakdownErrorUuid] = useState(null);
  const [breakdownNoKeyUuid, setBreakdownNoKeyUuid] = useState(null);

  // Split a task (45d): the wall's "Split it" and S open it for the one thing.
  const [splitTask, setSplitTask] = useState(null);
  // The one Undo toast: { kind: "done" | "delete" | "move" | "front" | "split"
  // | "swap" | "tomorrow" | "bringback" | "park", task (as it was), to, wasPinned, previous,
  // before, at }.
  // Only the task is held — what undoing writes is built from the tasks as
  // they are when Undo is tapped, not as they were 5 seconds earlier.
  const [undo, setUndo] = useState(null);

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

  // restorePin: Undo of a Mark done puts the task back on the wall — but only
  // if nothing else has been made the one thing in the meantime.
  const handleToggleComplete = (task, { restorePin = false } = {}) => {
    // Captured now, not inside the .then() below — that only runs once
    // savePayloadAsync's debounced write actually confirms (up to 1500ms,
    // more with retries), which could land the event's lociDateString on
    // the wrong side of a Loci-day boundary if the action itself happened
    // right before it.
    const actionAt = Date.now();
    const todayDateStr = getTodayDateString();
    const isCompleted = !task.isCompleted;
    if (isCompleted && task.reminderAt) cancelReminder(task.uuid);
    // Synchronously stop timer/focus overlay when completing the active focused task,
    // so the UI clears in the same render cycle rather than waiting for effects.
    // Also end the focus session itself (not just the UI) — completing the
    // focused task via this checkbox is a real session-completion path,
    // distinct from the "Done!" global prompt (App.jsx's handleFocusSessionDone),
    // and was previously leaving focusSessionIdRef open with no terminal
    // event, later either orphaned or wrongly auto-closed as "abandoned"
    // when the next session started.
    let endedFocusSession = null;
    if (shouldStopFocusOnComplete(task, isCompleted)) {
      endedFocusSession = endFocusSession("completed_task");
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    let updatedTasks = buildToggleCompletedTasks(tasks, task.uuid, isCompleted, todayStr);
    if (restorePin && !isCompleted && !tasks.some(t => t.isNowFocus && !t.isDeleted && !t.isCompleted)) {
      updatedTasks = updatedTasks.map(t => t.uuid === task.uuid ? { ...t, isNowFocus: true } : t);
    }
    if (isCompleted) setUndo({ kind: "done", task, wasPinned: !!task.isNowFocus, at: actionAt });
    if (isCompleted) {
      celebrate();
      track("task_completed", { horizon: task.horizonLevel });
    }
    let nextContributions = [...contributions];
    if (isCompleted) {
      nextContributions = incrementContribution(nextContributions, todayDateStr);
    } else {
      const contrIdx = nextContributions.findIndex((c) => c.dateString === todayDateStr);
      if (contrIdx !== -1 && nextContributions[contrIdx].count > 0) {
        nextContributions[contrIdx] = { ...nextContributions[contrIdx], count: nextContributions[contrIdx].count - 1, lastUpdated: Date.now() };
      }
    }
    savePayloadAsync({ ...payload, tasks: updatedTasks, contributions: nextContributions })
      .then(() => {
        const events = [buildTaskMutationEvent(isCompleted ? "task_completed" : "task_reopened", task, { windows, now: actionAt })];
        if (endedFocusSession) {
          // Use endedFocusSession.task (captured when that session started),
          // not `task` — if the Now Focus pin moved to `task` via a path that
          // never ended the PREVIOUS session (e.g. a raw pin-only action),
          // endFocusSession() above actually closed out that older session,
          // which may belong to a different task entirely.
          events.push(buildFocusTerminalEvent("focus_completed", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
  };

  const handlePinTask = (task) => {
    const now = Date.now();
    const isPinning = !task.isNowFocus;
    // Q36.3: something at a set time is never pinned (Codex review of #431).
    if (isPinning && isEventTask(task)) return;
    const newFocusUuid = isPinning ? task.uuid : null;
    // Pinning/unpinning here clears isNowFocus on whichever task currently
    // holds it — end that task's open session first, or it's left orphaned
    // with no terminal event (same gap fixed for the Rescue/Coach pin paths).
    // A raw pin (no timer start) never mints a new session itself, matching
    // SET_NOW_FOCUS's convention elsewhere.
    const previouslyFocused = tasks.find(t => t.isNowFocus && t.uuid !== newFocusUuid);
    const endedFocusSession = previouslyFocused ? endFocusSession("user_abandoned") : null;
    // Retargeting to a DIFFERENT task doesn't make activeTask null (it just
    // changes), so the hook's own "stop timer when activeTask disappears"
    // effects never fire — without this, a real running timer would keep
    // ticking, silently retargeted to the new task with no backing session.
    if (endedFocusSession) {
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    // Returned so callers (e.g. the Focus Now button, which pins then
    // immediately starts a session) can wait for this pin to actually
    // confirm before logging events of their own.
    const pinPromise = savePayloadAsync({ ...payload, tasks: tasks.map((t) => {
      const newFocus = isPinning && t.uuid === task.uuid;
      if (t.isNowFocus === newFocus) return t;
      return { ...t, isNowFocus: newFocus, lastUpdated: now };
    })});
    pinPromise
      .then(() => {
        if (endedFocusSession) {
          const abandonEvent = buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now });
          writeActivityEvents(eventPatch(uid, abandonEvent));
        }
      })
      .catch(() => {});
    return pinPromise;
  };

  // K1: the empty wall creates a task from free text. The record is
  // deliberately sparse — no front, no estimate, no subtask — and pinned
  // immediately, which is a legal task under Addendum C.
  //
  // concreteStep is OMITTED rather than set empty: normalizePayload only
  // rewrites the field when the key is present, and would substitute "Do first
  // tiny step" for an empty string — putting a subtask on the one task that is
  // specified not to have one. The rules accept its absence
  // (!newData.exists() || ...), and Firebase rejects an explicit undefined.
  const handleCommitNewTask = (title) => {
    const clean = String(title || "").trim().slice(0, 1000);
    if (!clean) return;
    // The wall is a third creation path, and Evening Guard is a setting the
    // user switched on for themselves — a path that quietly ignores it is a
    // way around their own decision. The wall disables Commit and says why,
    // so this is a backstop rather than the only check.
    if (isEveningGuardBlocked(config)) return false;
    const now = Date.now();
    const freshTask = {
      id: now,
      userId: config.userId || "",
      uuid: safeUUID(),
      title: clean,
      horizonLevel: "today",
      priority: "P3",
      // The canonical value every other creation path stores. Lowercase made a
      // second bucket in Insights and lost the row's category icon, because
      // consumers compare the stored string directly.
      category: "Personal",
      frontId: null,
      // timeEstimateMinutes is OMITTED, not set to 25: K1 says no estimate,
      // and writing one would have lists and Coach present an unsized task as
      // a deliberate 25-minute one. Every focus-time caller already falls back
      // to 25 at runtime when the field is absent.
      deadlineTimestamp: null,
      reminderAt: null,
      isCompleted: false,
      isParked: false,
      isNowFocus: true,
      orderIndex: todayTasksAll.length,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: now,
      subSteps: [],
    };
    // Exclusive, like every other pin (J5): whatever held isNowFocus lets go.
    // And ending its session is part of letting go — handlePinTask has done
    // this since it was written, and clearing the flag without it leaves a
    // session open against the OLD task while the timer retargets to the new
    // one, so the eventual terminal event credits the wrong task. The pinned
    // task can be outside Today (Coach and Mind Box can pin a week task), so
    // this looks at every task, not just today's.
    const previouslyFocused = (tasks || []).find(t => t.isNowFocus);
    const endedFocusSession = previouslyFocused ? endFocusSession("user_abandoned") : null;
    if (endedFocusSession) {
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    const tasks_ = (tasks || []).map(t => (t.isNowFocus ? { ...t, isNowFocus: false, lastUpdated: now } : t));
    savePayloadAsync({ ...payload, tasks: [...tasks_, freshTask] })
      .then(() => {
        // Built with the `now` captured when the user acted, not when the
        // debounced write confirmed: savePayloadAsync can land 1.5s later, or
        // later still on a retry, and defaulting the timestamp here files a
        // task created at 01:59 under the following Loci day.
        const events = [buildTaskMutationEvent("task_created", freshTask, { windows, now })];
        if (endedFocusSession) {
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    return true;
  };

  // "N parked this session": counted per focus session.
  const [parked, setParked] = useState({ sessionId: null, n: 0 });
  const handleFocusBrainDump = (text) => {
    // Q56.2: a parked thought lands in Mind Box, under the same 50 cap.
    // False when Mind Box is full, so Focus keeps the text and says so.
    const added = addThought(payload, text);
    if (!added) return false;
    savePayload(added.payload);
    setParked(p => ({ sessionId: focusSessionId, n: p.sessionId === focusSessionId ? p.n + 1 : 1 }));
    return true;
  };

  // 59d, I'm stuck. A smaller step goes ahead of the steps still open.
  const handleSmallerStep = (text) => {
    if (!activeTask) return;
    savePayload({ ...payload, tasks: withNextStep(tasks, activeTask, text) });
  };
  // Split (Q39.2): the sheet opens over Today; after it, focus is back, on
  // piece 1 (handleSplit). Closed without splitting, focus is back as it was.
  const splitFromStuckRef = useRef(false);
  const handleStuckSplit = () => {
    if (!activeTask) return;
    splitFromStuckRef.current = true;
    setIsFocusMode(false);
    setSplitTask(activeTask);
  };
  const closeSplitSheet = () => {
    setSplitTask(null);
    if (splitFromStuckRef.current) { splitFromStuckRef.current = false; setIsFocusMode(true); }
  };

  // Q39.2: piece 1 waits, not started, with Start ready. For 5 s the old
  // session is held, paused — Undo brings back the task and that same
  // sitting. Start, or the 5 s running out, saves it to the original task.
  const [splitFresh, setSplitFresh] = useState(null); // { pieceUuid, n, heldSessionId, original, created, until }
  const releaseHeldSession = (heldId) => {
    if (!heldId || focusSessionIdRef.current !== heldId) return;
    const ended = endFocusSession("user_abandoned");
    // Ended as every other path ends one: no session left for the bar to
    // offer, whose Resume would run a timer with nothing recording it
    // (Codex review of #436). Piece 1 still waits on the focus page.
    setIsTimerRunning(false);
    setFocusSessionActive(false);
    if (ended?.task) {
      writeActivityEvents(eventPatch(uid, buildFocusTerminalEvent(
        "focus_abandoned", ended.task, ended.focusSessionId, { ...ended, windows, now: Date.now() }
      )));
    }
  };
  useEffect(() => {
    const held = splitFresh?.heldSessionId;
    if (!held) return undefined;
    const id = setTimeout(() => {
      releaseHeldSession(held);
      setSplitFresh(f => (f && f.heldSessionId === held ? { ...f, heldSessionId: null } : f));
    }, Math.max(0, splitFresh.until - Date.now()));
    return () => clearTimeout(id);
  }, [splitFresh?.heldSessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const startSplitPiece = () => {
    const piece = tasks.find(t => t.uuid === splitFresh?.pieceUuid && !t.isDeleted);
    setSplitFresh(null);
    // A held session is closed by the new one, saved to its own task.
    if (piece) startFocusAndLog(piece);
  };
  const undoStuckSplit = () => {
    const f = splitFresh;
    if (!f?.heldSessionId || focusSessionIdRef.current !== f.heldSessionId) return;
    setSplitFresh(null);
    const now = Date.now();
    const made = tasks.filter(t => f.created.includes(t.uuid) && !t.isDeleted);
    const events = [
      buildTaskMutationEvent("task_restored", f.original, { windows, now }),
      ...made.map(t => buildTaskMutationEvent("task_deleted", t, { windows, now })),
    ];
    // The pin moves back to the original, whose session this is: keep its time.
    keepTimerOnTaskChange?.(true);
    savePayloadAsync({ ...payload, tasks: undoSplit(tasks, f.original, f.created, now) }, { expectedRemovals: f.created })
      .then(() => writeActivityEvents(eventsPatch(uid, events)))
      .catch(() => keepTimerOnTaskChange?.(false));
  };
  // Talk it through (Q39.1): the session stays paused (the focus bar shows
  // on Coach); the task and its next step go as a chip, sent with the first
  // message.
  const handleStuckCoach = () => {
    if (!activeTask) return;
    const step = taskSteps(activeTask).find(st => !st.done && st.text)?.text || "";
    setIsFocusMode(false);
    onOpenCoach?.({ stuck: { title: activeTask.title, step } });
  };

  // 59g: "Restart with a new length" — a fresh block in the same session.
  const handleRestartFocus = (minutes) => {
    // A pause that ran out closes the session instead (59j): no restart.
    if (changeFocusDuration(minutes)) setIsTimerRunning(true);
  };

  // K4's "Stop here". The minutes are already banked, so this is only a
  // question about what happens next — but it still has to END the session,
  // not merely leave the screen. onExit alone set isFocusMode false, which
  // both left the session open and flipped shouldShowFocusCompletionPrompt
  // back to true: the user was taken from the inline hold straight into the
  // global modal D3 exists to remove.
  const handleStopHere = () => {
    const ended = endFocusSession("user_abandoned");
    dismissSessionComplete();
    setIsTimerRunning(false);
    setIsFocusMode(false);
    setFocusSessionActive(false);
    // Use ended.task, not activeTask — a pin moved mid-session without
    // ending it would otherwise misattribute this to the newer task. Same
    // reasoning as every other terminal write in this file.
    if (ended?.task) {
      writeActivityEvents(eventPatch(uid, buildFocusTerminalEvent(
        "focus_abandoned", ended.task, ended.focusSessionId, { ...ended, windows, now: Date.now() }
      )));
    }
    return ended;
  };


  // 59h: End session. The minutes are saved (Stop here); "Where did you
  // stop?" becomes the task's next step, ahead of the steps still open; "End
  // and move to tomorrow" moves it there, with Today's Undo.
  const handleEndSession = ({ note = "", tomorrow = false } = {}) => {
    // The session's own task, not the pin now (Codex review of #434).
    const ended = handleStopHere();
    const task = ended?.task ? tasks.find(t => t.uuid === ended.task.uuid) || null : activeTask;
    if (!task) return;
    const now = Date.now();
    const result = endSessionTasks(tasks, task, { note, tomorrow, tomorrowStr: nextDateStr(todayStr), now });
    if (!result) return;
    savePayload({ ...payload, tasks: result.tasks });
    if (tomorrow) setUndo({ kind: "tomorrow", task, before: result.before, at: now });
  };

  const handleToggleMVD = (task) => {
    savePayload({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? { ...t, isMVD: !t.isMVD, lastUpdated: Date.now() } : t) });
  };

  const handleDeleteTask = (task) => {
    // Built now (synchronously, at the actual action moment) rather than
    // inside the .then() below — that only runs once savePayloadAsync's
    // debounced write confirms (up to 1500ms, more with retries), which
    // could stamp the event's lociDateString on the wrong side of a
    // Loci-day boundary if the action happened right before one.
    const actionAt = Date.now();
    const event = buildTaskMutationEvent("task_deleted", task, { windows, now: actionAt });
    // Deleting the actively focused task drops it out of activeTask
    // (isDeleted-filtered) without ever clearing isNowFocus itself — end its
    // session here or it's left open with no terminal event.
    let endedFocusSession = null;
    if (task.isNowFocus) {
      endedFocusSession = endFocusSession("user_abandoned");
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    savePayloadAsync({ ...payload, tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isDeleted: true, deletedAt: Date.now(), lastUpdated: Date.now() } : t) })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          // Use endedFocusSession.task, not `task` — if the pin moved to
          // `task` via a path that never ended the PREVIOUS session, this
          // call actually closed out that older session, which may belong to
          // a different task entirely (same fix as handleToggleComplete).
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    setUndo({ kind: "delete", task, at: Date.now() });
  };

  // Split (45d): the original is replaced by the steps, in its place; the pin
  // moves to the first. Undo (5s) brings the original back and removes them.
  const handleSplit = (steps) => {
    const original = tasks.find(t => t.uuid === splitTask?.uuid && !t.isDeleted);
    const fromStuck = splitFromStuckRef.current;
    splitFromStuckRef.current = false;
    setSplitTask(null);
    if (!original || steps.length < 2) { if (fromStuck) setIsFocusMode(true); return; }
    const actionAt = Date.now();
    // Q39.2: from I'm stuck, the session is held (not ended) and focus comes
    // back on piece 1; Undo lives on the focus page.
    if (fromStuck && original.isNowFocus && focusSessionId && focusSessionTaskUuid === original.uuid) {
      const { tasks: nextTasks, created } = buildSplit(tasks, original, steps, { now: actionAt, makeId: safeUUID });
      const events = [
        buildTaskMutationEvent("task_deleted", original, { windows, now: actionAt }),
        ...created.map(t => buildTaskMutationEvent("task_created", t, { windows, now: actionAt })),
      ];
      setSplitFresh({ pieceUuid: created[0].uuid, n: created.length, heldSessionId: focusSessionId, original, created: created.map(t => t.uuid), until: actionAt + 5000 });
      setIsFocusMode(true);
      // The pin moves to piece 1 while the session is held: keep its time.
      keepTimerOnTaskChange?.(true);
      savePayloadAsync({ ...payload, tasks: nextTasks })
        .then(() => writeActivityEvents(eventsPatch(uid, events)))
        .catch(() => keepTimerOnTaskChange?.(false));
      return;
    }
    let endedFocusSession = null;
    if (original.isNowFocus) {
      endedFocusSession = endFocusSession("user_abandoned");
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    const { tasks: nextTasks, created } = buildSplit(tasks, original, steps, { now: actionAt, makeId: safeUUID });
    const events = [
      buildTaskMutationEvent("task_deleted", original, { windows, now: actionAt }),
      ...created.map(t => buildTaskMutationEvent("task_created", t, { windows, now: actionAt })),
    ];
    if (endedFocusSession) {
      events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt }));
    }
    setUndo({ kind: "split", task: original, created: created.map(t => t.uuid), at: actionAt });
    savePayloadAsync({ ...payload, tasks: nextTasks })
      .then(() => writeActivityEvents(eventsPatch(uid, events)))
      .catch(() => {});
  };


  // Moves to another horizon (the task sheet's Horizon picker) act at
  // once with Undo. Undo puts back the horizon and place it had, and the pin
  // if it was the one thing and nothing else has been pinned since.
  const handleMoveWithUndo = (task, horizon) => {
    setUndo({ kind: "move", task, to: horizon, wasPinned: !!task.isNowFocus, at: Date.now() });
    handleMoveToHorizon(task, horizon);
  };

  // — A task, opened (turn 50): the sheet/drawer's writes. Autosave commits
  // can land a render late (on unmount, after ↑/↓), so they read the latest
  // payload, not this render's. —
  const latestPayloadRef = useRef(payload);
  latestPayloadRef.current = payload;
  const handlePatchTask = (uuid, patch) => {
    const latest = latestPayloadRef.current;
    const current = (latest.tasks || []).find(t => t.uuid === uuid && !t.isDeleted);
    if (!current) return;
    if (patch.horizonLevel && patch.horizonLevel !== current.horizonLevel) {
      handleMoveWithUndo(current, patch.horizonLevel);
      return;
    }
    if ("frontId" in patch) {
      handlePutOnFront(current, patch.frontId);
      return;
    }
    savePayload({ ...latest, tasks: (latest.tasks || []).map(t => t.uuid === uuid ? { ...t, ...patch, lastUpdated: Date.now() } : t) });
  };
  // A task's steps, written as a whole (the sheet and the row's steps). A
  // removed step has Undo (52: Undo, not confirm), and the first step stays
  // step 1 (taskSteps).
  const handleSetSteps = (uuid, steps, meta) => {
    const latest = latestPayloadRef.current;
    const current = (latest.tasks || []).find(t => t.uuid === uuid);
    if (!current) return;
    const patch = stepsPatch(current, steps);
    savePayload({ ...latest, tasks: (latest.tasks || []).map(t => (t.uuid === uuid ? applyStepsPatch(t, patch) : t)) });
    if (meta?.removed) setUndo({ kind: "step", task: current, step: meta.removed, atIndex: meta.atIndex, at: Date.now() });
  };

  // "Make this the one thing" (50c–d): the task takes the NOW spot; the old
  // one goes back to the top of the list with its steps, a 2-second tint and
  // Undo.
  const [tintUuid, setTintUuid] = useState(null);
  useEffect(() => {
    if (!tintUuid) return undefined;
    const t = setTimeout(() => setTintUuid(null), 2000);
    return () => clearTimeout(t);
  }, [tintUuid]);
  // Minimum day (57b answer 6): once confirmed on the Day map, its tasks
  // carry MIN in the list, for today only.
  const minimumDayIds = new Set(confirmedMinimumDay(config, todayStr) || []);
  const handleMakeOneThing = (task) => {
    // Q31: something at a set time (a call) is never the one thing.
    if (isEventTask(task)) return;
    // From the goal record (Q57.2) the task may be in Plan: it moves to Today
    // first, and Undo puts it back where it was.
    // A task moved to tomorrow is on the Today horizon but not on today: it
    // comes back for now, and Undo returns it to tomorrow (Codex review of #466).
    const fromPlan = !isOnToday(task, todayStr)
      ? { horizonLevel: task.horizonLevel ?? null, orderIndex: task.orderIndex ?? null, deferredUntil: task.deferredUntil ?? null }
      : null;
    const base = fromPlan ? tasks.map(t => (t.uuid === task.uuid ? { ...t, horizonLevel: "today", lastUpdated: Date.now() } : t)) : tasks;
    const { tasks: pinned, previous } = makeOneThing(base, task.uuid);
    if (pinned === base) return;
    // On the Day map it moves to NOW: the route flows on from its end, fixed
    // stops stay (53–56). Undo puts the stops and the route's start back.
    const nowMinutes = currentDayMinutes(windows);
    const moved = oneThingToNow(pinned, String(task.uuid), {
      todayStr, nowMinutes, breaks: routeBreaks(windows, config, todayStr),
    });
    const next = moved ? moved.tasks : pinned;
    const route = moved && {
      before: base.filter(t => moved.ids.includes(String(t.uuid || t.id))),
      config: { dayMapDate: config.dayMapDate, dayMapAnchorMinutes: config.dayMapAnchorMinutes },
    };
    // The pin moving off a task with an open session ends that session, as
    // any other re-pin does (handlePinTask).
    const endedFocusSession = previous ? endFocusSession("user_abandoned") : null;
    if (endedFocusSession) {
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    const now = Date.now();
    const nextConfig = moved ? { ...config, dayMapDate: todayStr, dayMapAnchorMinutes: nowMinutes, lastUpdated: now } : config;
    savePayloadAsync({ ...payload, tasks: next, config: nextConfig })
      .then(() => {
        if (endedFocusSession) {
          writeActivityEvents(eventPatch(uid, buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now })));
        }
      })
      .catch(() => {});
    if (previous) setTintUuid(previous.uuid);
    setUndo({ kind: "swap", task, previous, route, fromPlan, at: now });
  };

  // Tomorrow (50b, T): leaves today for the next Loci day, first in line there.
  // moveToTomorrow unpins it, so a session running on it ends here, recorded,
  // as Delete, Park and Done end theirs.
  const handleTomorrow = (task) => {
    const actionAt = Date.now();
    let endedFocusSession = null;
    if (task.isNowFocus) {
      endedFocusSession = endFocusSession("user_abandoned");
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    const { tasks: next, before } = moveToTomorrow(tasks, [String(task.uuid || task.id)], nextDateStr(todayStr));
    savePayloadAsync({ ...payload, tasks: next })
      .then(() => {
        if (endedFocusSession) {
          writeActivityEvents(eventPatch(uid, buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt })));
        }
      })
      .catch(() => {});
    setUndo({ kind: "tomorrow", task, before, at: actionAt });
  };
  // The Day map column's "Move N to tomorrow" (50k): the stops past the day's
  // end, never the one thing, with Today's own Undo.
  const handleMoveManyToTomorrow = (ids) => {
    if (!ids.length) return;
    const { tasks: next, before } = moveToTomorrow(tasks, ids, nextDateStr(todayStr));
    savePayload({ ...payload, tasks: next });
    setUndo({ kind: "tomorrow", count: ids.length, before, at: Date.now() });
  };
  // Bring back (50h): to its old spot in today's list, tinted, with Undo.
  const handleBringBack = (task) => {
    const { tasks: next, before } = bringBack(tasks, String(task.uuid || task.id));
    if (!before.length) return;
    savePayload({ ...payload, tasks: next });
    setTintUuid(task.uuid);
    setUndo({ kind: "bringback", task, before, at: Date.now() });
  };
  const [movedOpen, setMovedOpen] = useState(false);
  // Parked (62d): Restore puts the task at the bottom of Today's list.
  const [parkedOpen, setParkedOpen] = useState(false);
  // 58.6 (67c): on the phone, Done today is a fold.
  const [doneOpen, setDoneOpen] = useState(false);
  const handleRestoreParked = (task) => {
    const { tasks: next, before } = restoreParked(tasks, task.uuid);
    if (!before) return;
    const event = buildTaskMutationEvent("task_unparked", task, { windows });
    savePayloadAsync({ ...payload, tasks: next })
      .then(() => writeActivityEvents(eventPatch(uid, event)))
      .catch(() => {});
    setUndo({ kind: "restore", task, before, at: Date.now() });
  };
  // Q59 (70d): Park N from Won't fit today, with one Undo.
  const handleParkMany = (ids) => {
    if (!ids.length) return;
    const now = Date.now();
    const parked = new Set(ids);
    savePayload({ ...payload, tasks: tasks.map(t => parked.has(String(t.uuid || t.id))
      ? { ...t, isParked: true, parkedAt: now, isNowFocus: false, lastUpdated: now } : t) });
    setUndo({ kind: "parkmany", ids, at: now });
  };
  const handleParkWithUndo = (task) => {
    setUndo({ kind: "park", task, wasPinned: !!task.isNowFocus, at: Date.now() });
    handleParkTask(task);
  };

  // "Put on a front": the swipe's Front and the menu item open this picker.
  const [frontPickerTask, setFrontPickerTask] = useState(null);
  // Focus goes back where it came from when the picker closes — or, if that
  // control is gone (the menu item, the swipe's Front), to the row's Options.
  const pickerOpenerRef = useRef(null);
  const openFrontPicker = (task) => {
    pickerOpenerRef.current = { el: document.activeElement, uuid: task.uuid };
    setFrontPickerTask(task);
  };
  useEffect(() => {
    if (frontPickerTask || !pickerOpenerRef.current) return;
    const { el, uuid } = pickerOpenerRef.current;
    pickerOpenerRef.current = null;
    // The swipe's Front stays mounted once the row closes, only hidden.
    const back = el && el.isConnected && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden"
      ? el
      : document.querySelector(`[data-testid="today-tasks-list"] [data-task-uuid="${uuid}"]`);
    back?.focus?.();
  }, [frontPickerTask]);
  const handlePutOnFront = (task, frontId) => {
    setFrontPickerTask(null);
    const current = tasks.find(t => t.uuid === task.uuid && !t.isDeleted);
    if (!current || (current.frontId || null) === (frontId || null)) return;
    setUndo({ kind: "front", task: current, to: frontId || null, at: Date.now() });
    savePayload({ ...payload, tasks: tasks.map(t => t.uuid === current.uuid ? { ...t, frontId: frontId || null, lastUpdated: Date.now() } : t) });
  };

  const undoMessage = (u) => {
    if (u.count) return `${u.count} ${u.count === 1 ? "task" : "tasks"} moved to tomorrow`;
    if (u.kind === "parkmany") return `${u.ids.length} parked`;
    if (u.kind === "reorder") return `Doesn’t fit before ${formatClock24(u.fixedAt)} · placed after`;
    if (u.kind === "step") return `Step removed: ${u.step.text}`;
    const title = u.task.title;
    if (u.kind === "move") {
      // Its name as Plan shows it: renamed and custom horizons too.
      const label = horizonChoices(config, todayStr).find(c => c.id === u.to)?.name || ROADMAP_HORIZONS.find(h => h.key === u.to)?.label || u.to;
      return `Moved to ${label}: ${title}`;
    }
    if (u.kind === "split") return `Split into ${u.created.length} tasks: ${title}`;
    if (u.kind === "front") {
      const front = frontsFromConfig(config).find(f => f.id === u.to);
      return front ? `Put on ${front.name}: ${title}` : `Off its front: ${title}`;
    }
    if (u.kind === "swap") return u.previous ? `${u.previous.title} is back at the top of the list.` : `${u.fromPlan ? "Moved to Today and made the one thing" : "Made the one thing"}: ${title}`;
    return `${{ done: "Marked done", delete: "Deleted", tomorrow: "Moved to tomorrow", bringback: "Brought back", park: "Parked", restore: "Restored", unpin: "Unpinned" }[u.kind]}: ${title}`;
  };
  const undoText = undo ? undoMessage(undo) : "";

  // Leaving Today ends a review's mark (Q48.1); undoing that brings it back.
  const reviewMark = (t) => (t.reviewFrom ? { reviewFrom: t.reviewFrom } : {});
  const handleUndo = () => {
    if (!undo) return;
    const { kind, task, wasPinned } = undo;
    setUndo(null);
    if (kind === "step") {
      // Back where it was; steps added since stay where they are.
      const current = tasks.find(t => t.uuid === task.uuid && !t.isDeleted);
      if (!current) return;
      const steps = [...taskSteps(current)];
      if (steps.some(st => st.id === undo.step.id)) return;
      steps.splice(Math.min(undo.atIndex, steps.length), 0, undo.step);
      handleSetSteps(current.uuid, steps);
      return;
    }
    if (kind === "delete") {
      const event = buildTaskMutationEvent("task_restored", task, { windows });
      savePayloadAsync({ ...payload, tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isDeleted: false, deletedAt: null, ...reviewMark(task), lastUpdated: Date.now() } : t) })
        .then(() => writeActivityEvents(eventPatch(uid, event)))
        .catch(() => {});
      return;
    }
    if (kind === "move") {
      const current = tasks.find(t => t.uuid === task.uuid && !t.isDeleted);
      if (!current || current.horizonLevel !== undo.to) return;
      const now = Date.now();
      const otherPinned = tasks.some(t => t.isNowFocus && t.uuid !== task.uuid && !t.isDeleted && !t.isCompleted);
      const event = buildTaskMutationEvent("task_moved", current, {
        fromState: { horizonLevel: undo.to }, toState: { horizonLevel: task.horizonLevel }, windows, now,
      });
      savePayloadAsync({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? {
        ...t,
        horizonLevel: task.horizonLevel,
        orderIndex: task.orderIndex,
        ...reviewMark(task),
        ...(wasPinned && !otherPinned ? { isNowFocus: true } : {}),
        lastUpdated: now,
      } : t) })
        .then(() => writeActivityEvents(eventPatch(uid, event)))
        .catch(() => {});
      return;
    }
    if (kind === "split") {
      const now = Date.now();
      const made = tasks.filter(t => undo.created.includes(t.uuid) && !t.isDeleted);
      const events = [
        buildTaskMutationEvent("task_restored", task, { windows, now }),
        ...made.map(t => buildTaskMutationEvent("task_deleted", t, { windows, now })),
      ];
      // Undoing a split into four or more removes three or more tasks at once,
      // which the sync drop guard blocks unless it is told they are expected.
      savePayloadAsync({ ...payload, tasks: undoSplit(tasks, task, undo.created, now) }, { expectedRemovals: undo.created })
        .then(() => writeActivityEvents(eventsPatch(uid, events)))
        .catch(() => {});
      return;
    }
    if (kind === "front") {
      const current = tasks.find(t => t.uuid === task.uuid && !t.isDeleted);
      if (!current || (current.frontId || null) !== undo.to) return;
      savePayload({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? { ...t, frontId: task.frontId || null, lastUpdated: Date.now() } : t) });
      return;
    }
    if (kind === "unpin") {
      // Re-pin only if it is still here and nothing else became the one thing.
      const current = tasks.find(t => t.uuid === task.uuid && !t.isDeleted && !t.isCompleted);
      if (current && !current.isNowFocus && !tasks.some(t => t.isNowFocus && !t.isDeleted && !t.isCompleted)) {
        handlePinTask(current);
      }
      return;
    }
    if (kind === "swap") {
      // The route comes back only with the pin: if the pin has moved on
      // since, undoOneThing leaves it, and so does this.
      const stillPinned = tasks.some(t => t.uuid === task.uuid && t.isNowFocus);
      const unpinnedOnly = undoOneThing(tasks, task.uuid, undo.previous);
      // A task brought in from Plan goes back there, if the pin hasn't moved on.
      const unpinned = undo.fromPlan && stillPinned
        ? unpinnedOnly.map(t => (t.uuid === task.uuid ? { ...t, ...undo.fromPlan, lastUpdated: Date.now() } : t))
        : unpinnedOnly;
      if (!undo.route || !stillPinned) {
        savePayload({ ...payload, tasks: unpinned });
        return;
      }
      const { dayMapDate, dayMapAnchorMinutes } = undo.route.config;
      const restoredConfig = { ...config, lastUpdated: Date.now() };
      if (dayMapDate === undefined) delete restoredConfig.dayMapDate; else restoredConfig.dayMapDate = dayMapDate;
      if (dayMapAnchorMinutes === undefined) delete restoredConfig.dayMapAnchorMinutes; else restoredConfig.dayMapAnchorMinutes = dayMapAnchorMinutes;
      // Timed again from the start it had, or now if that has passed.
      const now = currentDayMinutes(windows);
      const anchorMinutes = dayMapDate === todayStr && dayMapAnchorMinutes != null ? Math.max(now, Number(dayMapAnchorMinutes)) : now;
      savePayload({
        ...payload,
        tasks: restoreRoute(unpinned, undo.route.before, {
          todayStr, anchorMinutes, breaks: routeBreaks(windows, config, todayStr),
        }),
        config: restoredConfig,
      });
      return;
    }
    if (kind === "tomorrow" || kind === "bringback" || kind === "reorder") {
      savePayload({ ...payload, tasks: restoreSchedule(tasks, undo.before) });
      return;
    }
    if (kind === "restore") {
      savePayload({ ...payload, tasks: undoRestoreParked(tasks, task.uuid, undo.before) });
      return;
    }
    if (kind === "parkmany") {
      // Back to Today, only those still parked.
      const ids = new Set(undo.ids);
      savePayload({ ...payload, tasks: tasks.map(t => ids.has(String(t.uuid || t.id)) && t.isParked && !t.isDeleted
        ? { ...t, isParked: false, lastUpdated: Date.now() } : t) });
      return;
    }
    if (kind === "park") {
      const current = tasks.find(t => t.uuid === task.uuid && !t.isDeleted);
      if (!current?.isParked) return;
      const otherPinned = tasks.some(t => t.isNowFocus && t.uuid !== task.uuid && !t.isDeleted && !t.isCompleted);
      savePayload({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? {
        ...t, isParked: false, ...(wasPinned && !otherPinned ? { isNowFocus: true } : {}), lastUpdated: Date.now(),
      } : t) });
      return;
    }
    // Reopen only what is still done: a task reopened or deleted by another
    // path in those 5 seconds is left as it is.
    const current = tasks.find(t => t.uuid === task.uuid && !t.isDeleted);
    if (current?.isCompleted) handleToggleComplete(current, { restorePin: wasPinned });
  };

  // Re-check auto-show eligibility when the app/tab regains visibility or
  // focus, so a Morning Ritual window that opened while the app was
  // backgrounded (e.g. a PWA left open overnight) is picked up without a
  // full reload.
  const [visibilityTick, setVisibilityTick] = useState(0);
  useEffect(() => {
    const bump = () => setVisibilityTick(t => t + 1);
    document.addEventListener("visibilitychange", bump);
    window.addEventListener("focus", bump);
    return () => {
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener("focus", bump);
    };
  }, []);

  // 55d–e: Close the day replaces the evening reflection (Addendum B: no
  // prompt opens on its own). Today's line and the Day map's button open it;
  // a tapped evening notification does too, while it's still due.
  useEffect(() => {
    if (pendingCheckinSlot !== "reflection") return;
    setPendingCheckinSlot(null);
    if (shouldShowReflection(new Date(), windows, config, anchorTodayStr)) onOpenCloseDay?.();
  }, [pendingCheckinSlot, visibilityTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // The proactive nudge no longer appears here. J3: "It never appears
  // unprompted on Today. The same logic renders as the first line of the Coach
  // transcript when Coach is opened." A card that interrupts the execution
  // screen on its own is the class Addendum B removes. CoachTab now derives it
  // itself rather than waiting to be handed one, so nothing is lost by the card
  // going away.

  const handleBreakdown = async (task) => {
    setBreakdownErrorUuid(null);
    setBreakdownNoKeyUuid(null);
    if (!hasAIKey()) {
      setBreakdownNoKeyUuid(task.uuid);
      return;
    }
    setBreakdownLoadingUuid(task.uuid);
    const { groqKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
    try {
      const raw = await callAI({
        groqKey, geminiKey, cerebrasKey, zaiKey,
        systemPrompt: "You are a productivity coach. Respond ONLY with a valid JSON array of strings, no markdown, no explanation.",
        messages: [{
          role: "user",
          content: `Break this task into 3–5 tiny, concrete micro-steps that each take under 5 minutes and feel easy to start.\n\nTask: "${task.title}"\nConcrete step: "${task.concreteStep || ""}"\nTime estimate: ${task.timeEstimateMinutes || 25} minutes\n\nReturn ONLY a JSON array of short strings (each under 12 words). Example: ["Open the document", "Write one sentence", "Save the file"]`
        }],
        maxTokens: 200
      });
      const steps = extractJsonArray(raw);
      const validSteps = steps.filter(s => typeof s === "string" && s.trim());
      if (validSteps.length === 0) throw new Error("bad response");
      const subSteps = validSteps.slice(0, 5).map(text => ({ id: safeUUID(), text: text.trim(), done: false }));
      savePayload({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? { ...t, subSteps, lastUpdated: Date.now() } : t) });
    } catch (_) {
      setBreakdownErrorUuid(task.uuid);
    } finally {
      setBreakdownLoadingUuid(null);
    }
  };

  const handleSubStepToggle = (task, stepId) => {
    const steps = taskSteps(task).map(st => (st.id === stepId ? { ...st, done: !st.done } : st));
    handleSetSteps(task.uuid, steps);
  };

  const handleMoveToHorizon = (task, horizon) => {
    const count = tasks.filter(t => t.horizonLevel === horizon && !t.isDeleted).length;
    const actionAt = Date.now();
    const event = buildTaskMutationEvent("task_moved", task, {
      fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: horizon }, windows, now: actionAt,
    });
    // Moving the focused task off Today clears its isNowFocus flag below —
    // if left unhandled, that orphans the open focus session (no terminal
    // event, later wrongly auto-closed as "abandoned" attributed to a later
    // session). End it here, same as handleToggleComplete does for completion.
    let endedFocusSession = null;
    if (task.isNowFocus) {
      endedFocusSession = endFocusSession("user_abandoned");
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    savePayloadAsync({ ...payload, tasks: tasks.map(t =>
      t.uuid === task.uuid ? { ...t, horizonLevel: horizon, isNowFocus: false, orderIndex: count, lastUpdated: Date.now() } : t
    )})
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          // Use endedFocusSession.task, not `task` — see handleToggleComplete.
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
  };

  const handleParkTask = (task) => {
    const actionAt = Date.now();
    const event = buildTaskMutationEvent("task_parked", task, { windows, now: actionAt });
    // buildParkTaskTasks clears isNowFocus on the parked task — end its
    // session here if it was the one actively focused, same as delete/move.
    let endedFocusSession = null;
    if (task.isNowFocus) {
      endedFocusSession = endFocusSession("user_abandoned");
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    savePayloadAsync({ ...payload, tasks: buildParkTaskTasks(tasks, task.uuid) })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          // Use endedFocusSession.task, not `task` — see handleToggleComplete.
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
  };

  const getTaskKey = (t) => t.uuid || String(t.id);

  const handleDragEnd = ({ active, over }) => {
    setActiveTaskId(null);
    if (!over || active.id === over.id) return;
    const oldIndex = remainingTasks.findIndex(t => getTaskKey(t) === active.id);
    const newIndex = remainingTasks.findIndex(t => getTaskKey(t) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove([...remainingTasks], oldIndex, newIndex);
    const orderMap = new Map(reordered.map((t, i) => [getTaskKey(t), i]));
    // The Day map follows: one order for both.
    const next = routeFollowsList(tasks.map(t =>
      orderMap.has(getTaskKey(t)) ? { ...t, orderIndex: orderMap.get(getTaskKey(t)), lastUpdated: Date.now() } : t
    ), todayStr, { config, nowMinutes: currentDayMinutes(windows), breaks: routeBreaks(windows, config, todayStr) });
    savePayload({ ...payload, tasks: next });
    // Q1 (69c): dropped above a fixed time it can't finish before, a task
    // goes after it whole (never split), and says so, with Undo.
    const fixedNext = reordered.slice(newIndex + 1).find(t => isFixedStop(t) && t.dayMapDate === todayStr);
    const moved = next.find(t => getTaskKey(t) === active.id);
    if (fixedNext && moved?.dayMapStartMinutes != null && Number(moved.dayMapStartMinutes) > Number(fixedNext.dayMapFixedMinutes)) {
      setUndo({ kind: "reorder", fixedAt: Number(fixedNext.dayMapFixedMinutes), before: todayTasksAll, at: Date.now() });
    }
  };

  // One bounded subscription for both figures the wall needs from the ledger:
  // the done line's minutes (J2b) and Momentum's days (J4).
  // Thirty days rather than seven: the strip needs only five bars, but the
  // sentence counts a run, and a run longer than the window fetched would be
  // silently truncated. It undercounts at the edge rather than guessing.
  const { raw: ledgerRaw, status: ledgerStatus } = useFocusLedger(uid, 30, windows);


  // A task moved to tomorrow (deferral.js) is not today's until then.
  const todayTasksAll = tasks.filter((t) => isOnToday(t, todayStr) && !t.isDeleted && !t.isParked);
  const pinnedFocusTask = todayTasksAll.find(t => t.isNowFocus && !t.isCompleted && !t.isDeleted) || null;
  const listMotionActive = () => !!pinnedFocusTask && listMotionMode() !== "none";

  // Half height leaves the task and its Start focus in view above the sheet
  // (37b): its top edge sits just under Start focus, kept between 30% and 70%
  // of the space between the header and the tab bar. Full height fills that
  // space. Measured, because the title wraps to as many lines as it needs.
  const sheetOpen = peekOpen && !!pinnedFocusTask;
  const wallCovered = sheetOpen && sheetFull && sheetViewport;
  useLayoutEffect(() => {
    if (!wallCovered) return;
    const sheet = sheetRef.current;
    if (sheet && !sheet.contains(document.activeElement)) {
      sheet.querySelector(".today-sheet-grabber")?.focus();
    }
  }, [wallCovered]);
  useLayoutEffect(() => {
    if (!sheetOpen) return undefined;
    const el = sheetRef.current;
    if (!el) return undefined;
    const measure = () => {
      const tab = document.querySelector(".tab-bar");
      const tabTop = tab ? tab.getBoundingClientRect().top : window.innerHeight;
      const head = document.querySelector(".shell-header");
      const headBottom = head ? Math.max(0, head.getBoundingClientRect().bottom) : 0;
      const start = document.querySelector(".wall-primary");
      const avail = tabTop - headBottom;
      const underStart = start ? tabTop - (start.getBoundingClientRect().bottom + 12) : avail * 0.5;
      const half = Math.min(Math.max(underStart, avail * 0.3), avail * 0.7);
      el.style.setProperty("--sheet-half", `${Math.round(half)}px`);
      // When even the smallest half sheet reaches over Start focus (a short
      // phone, large text, a long title), the NOW card with its own Start
      // shows at half height too, so the one action is never hidden.
      el.dataset.coversStart = half > underStart + 1 ? "1" : "0";
      el.style.setProperty("--sheet-full", `${Math.round(avail - 8)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    // The wall changes size when another task becomes the one thing (a
    // longer title, a first step) — re-measure then too.
    const wall = document.querySelector(".today-wall");
    const ro = wall && typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(wall);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [sheetOpen, pinnedFocusTask?.uuid]);

  // The wall's task edited off Today (Split it opens the task editor, which
  // can change the horizon). AddTaskDialog's edit-save spreads ...editTask,
  // so isNowFocus survives the move: the task would stay the app's active
  // focus task with its session orphaned, while no longer on Today at all.
  // Let go of it the way handleMoveToHorizon does for the row menu. Only the
  // task that was on the wall is watched — a Coach pin on another horizon
  // never was, and is left alone.
  const wallTaskUuidRef = useRef(null);
  if (pinnedFocusTask) {
    wallTaskUuidRef.current = pinnedFocusTask.uuid;
  } else if (wallTaskUuidRef.current && !tasks.some(t => t.uuid === wallTaskUuidRef.current && t.isNowFocus)) {
    // Let go of by any other path: forget it, so a later deliberate pin of
    // the same task elsewhere is not undone here.
    wallTaskUuidRef.current = null;
  }
  const leftToday = wallTaskUuidRef.current
    ? tasks.find(t => t.uuid === wallTaskUuidRef.current && t.isNowFocus && !t.isDeleted && !t.isCompleted && t.horizonLevel !== "today")
    : null;
  useEffect(() => {
    if (!leftToday) return;
    wallTaskUuidRef.current = null;
    const actionAt = Date.now();
    const endedFocusSession = endFocusSession("user_abandoned");
    setIsTimerRunning(false);
    setIsFocusMode(false);
    setFocusSessionActive(false);
    savePayloadAsync({ ...payload, tasks: tasks.map(t =>
      t.uuid === leftToday.uuid ? { ...t, isNowFocus: false, lastUpdated: Date.now() } : t
    )})
      .then(() => {
        if (endedFocusSession) {
          writeActivityEvents(eventPatch(
            uid,
            buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt })
          ));
        }
      })
      .catch(() => {});
  }, [leftToday?.uuid]); // eslint-disable-line react-hooks/exhaustive-deps
  // Must-do is the list's one filter (Y4).
  const todayTasksFiltered = isMVDMode ? todayTasksAll.filter(t => t.isMVD) : todayTasksAll;
  // — values the wall's header and kicker read —
  // The kicker is the front name OR nothing. Never "Uncategorised": a task with
  // no front is a first-class task (Addendum C).
  const wallFronts = frontsFromConfig(config);
  // — J2b: the commitment, finished —
  //
  // Completing clears isNowFocus, so pinnedFocusTask is null by the time this
  // renders. What survives is dailyCommitmentTaskIds, which App's observer
  // writes for every pin; the done state is the last of today's commitments
  // that is actually finished today.
  const doneCommitment = (() => {
    if (pinnedFocusTask) return null;
    const ids = committedTaskIdsForDay(config, todayStr);
    for (let i = ids.length - 1; i >= 0; i--) {
      const t = todayTasksAll.find(x => x.uuid === ids[i]);
      if (t && t.isCompleted && t.dateCompletedString === todayStr) return t;
    }
    return null;
  })();
  // The done state has no pinned task — completion clears the flag — so the
  // header would otherwise resolve against the legacy Key Deadline and the
  // countdown would jump to an unrelated one, or vanish, the instant the task
  // was finished. It follows the task the wall is actually showing.
  const wallFront = frontForCommitment(pinnedFocusTask || doneCommitment, wallFronts);
  // L1: front first, then the Key Deadline the user already set, then nothing.
  const wallKickerFront = commitmentKickerFront(wallFront, config);
  // J3 reads "MEMBRANE PAPER · 11d" — one front, and its own count. Taking the
  // count from the legacy config.deadlineDate while the kicker named a
  // different front put one front's days beside another's name, and hid the
  // named front's own dueAt. The count belongs to whatever the kicker names;
  // with no front, that is the legacy key deadline, as the deleted strip
  // showed. An overdue deadline is not "days left".
  const wallDaysLeft = commitmentDaysLeft(wallKickerFront, new Date());
  // The goal band (Addendum M): the same front, with its done/total when it
  // has tasks on it. With no front and no Key Deadline there is no band.
  // Q49: its Target ("3 job apply + PRINCE2") is the Key Deadline's own, so
  // it shows only when the band is the Key Deadline, not another front.
  const wallGoal = wallKickerFront
    ? {
      name: wallKickerFront.name, daysLeft: wallDaysLeft, ...frontProgress(tasks, wallKickerFront.id),
      target: wallKickerFront.id === LEGACY_DEADLINE_FRONT_ID ? wallKickerFront.nextMove || null : null,
    }
    : null;
  // Q57.2: the band opens the goal record. Its days follow the Loci day, as
  // completions are stamped with it.
  const goalRecordProps = wallKickerFront
    ? {
      record: buildGoalRecord({
        tasks, goalId: wallKickerFront.id, todayStr,
        startDay: goalStartDay(wallKickerFront, config), mode: config.goalDaysMode,
      }),
      weekdays: config.goalDaysMode === "weekdays",
      next: nextGoalTask({ tasks, goalId: wallKickerFront.id, todayStr, horizons: horizonsFromConfig(config, todayStr) }),
      doneToday: goalTaskDoneToday(tasks, wallKickerFront.id, todayStr),
      onMakeOneThing: (task) => handleMakeOneThing(task),
    }
    : null;
  // A session left running behind the overlay is REOPENED by the wall, not
  // restarted (see startFocusAndLog) — so the chip has to name the time that
  // tap will actually resume, not the task's estimate. Advertising 25:00 and
  // resuming 08:12 is the same lie as a button whose label doesn't match its
  // handler.
  const wallSessionLive = !!(pinnedFocusTask && focusSessionId && focusSessionTaskUuid === pinnedFocusTask.uuid);
  const wallLiveTimerLabel = wallSessionLive && Number.isFinite(timerSecondsLeft)
    ? `${String(Math.floor(Math.max(0, timerSecondsLeft) / 60)).padStart(2, "0")}:${String(Math.max(0, timerSecondsLeft) % 60).padStart(2, "0")}`
    : null;

  // Q7: tasks moved here from yesterday arrive at the top (moveToTomorrow
  // gave them the lowest orders) and are then ordinary rows in the one
  // order, tagged FROM YESTERDAY for this Loci day.
  const isFromYesterday = (t) => t.deferredUntil === todayStr;
  // The list reads in the route's order (Q59): one order, with fixed times
  // where they fall; a task not on the route yet goes by its own order.
  const route = useDayRoute({ payload, savePayload });
  const routeIndex = new Map(route.routeTasks.map((t, i) => [getTaskId(t), i]));
  const remainingTasks = todayTasksFiltered
    .filter((t) => !t.isCompleted && t.uuid !== pinnedFocusTask?.uuid)
    .sort((a, b) => ((routeIndex.get(getTaskId(a)) ?? Infinity) - (routeIndex.get(getTaskId(b)) ?? Infinity))
      || ((a.orderIndex ?? 0) - (b.orderIndex ?? 0)));
  // Q59 (70a): the Day ends line in the list, the rows past it muted, then
  // "N won't fit · M min · Sort in Day map ›".
  const cut = routeCut(route.routeTasks, route.plan);
  const firstOver = remainingTasks.findIndex(t => cut.overIds.has(getTaskId(t)));
  // 59d, Switch to the next task: the list's first, never one at a set time.
  // The session ends (its minutes are saved); the next task is the one thing,
  // not yet started, and this one heads the list.
  const stuckNext = activeTask ? remainingTasks.find(t => t.uuid !== activeTask.uuid && !isEventTask(t)) || null : null;
  const handleSwitchNext = () => {
    const task = activeTask;
    if (!task || !stuckNext) return;
    handleStopHere();
    savePayload({ ...payload, tasks: switchToNextTasks(tasks, task, stuckNext) });
  };
  // 50g–h: what was moved to tomorrow, listed under a quiet line at the end.
  const movedToTomorrow = tasks
    .filter((t) => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted && !t.isParked && isDeferred(t, todayStr))
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  // — A task, opened (50a–b), and the list's keyboard (50b): one tab stop,
  // ↑/↓ or J/K to move, Enter to open, D / T / P / E / ⌫ to act. —
  // The one thing opens here too (its title on the wall, or E): it is the
  // only way to edit or let go of it now the list has no NOW row.
  const detailIsNow = !!detailUuid && detailUuid === pinnedFocusTask?.uuid;
  // A Day map stop the Must-do filter hides opens too (52), from all of Today.
  const detailTask = detailUuid ? (detailIsNow ? pinnedFocusTask : remainingTasks.find(t => t.uuid === detailUuid)
    || (isMVDMode && todayTasksAll.find(t => t.uuid === detailUuid && !t.isCompleted)) || null) : null;
  const detailIndex = detailTask && !detailIsNow ? remainingTasks.indexOf(detailTask) : -1;
  const detailHidden = !!detailTask && !detailIsNow && detailIndex === -1;
  useEffect(() => {
    // Done, moved, parked or deleted: the task left the list, so it closes.
    if (detailUuid && !detailTask) setDetailUuid(null);
  }, [detailUuid, detailTask]);
  useEffect(() => {
    if (editTitle && editTitle.uuid !== detailUuid) setEditTitle(null);
  }, [detailUuid, editTitle]);
  const rovingUuid = remainingTasks.some(t => t.uuid === rowFocusUuid) ? rowFocusUuid : remainingTasks[0]?.uuid;
  const focusRow = (uuid) => {
    if (!uuid) return;
    setRowFocusUuid(uuid);
    requestAnimationFrame(() => document.querySelector(`[data-testid="today-tasks-list"] [data-task-uuid="${uuid}"]`)?.focus());
  };
  // Opened from the Day map column (50k): Esc goes back to that stop.
  const detailOpenerRef = useRef(null);
  const openDetail = (task) => { detailOpenerRef.current = null; setRowFocusUuid(task.uuid); setDetailUuid(task.uuid); };
  const openFromDayMap = (task) => {
    detailOpenerRef.current = document.activeElement;
    if (remainingTasks.some(t => t.uuid === task.uuid)) setRowFocusUuid(task.uuid);
    setDetailUuid(task.uuid);
  };
  const closeDetail = () => {
    const back = detailUuid;
    const wasNow = detailIsNow;
    const opener = detailOpenerRef.current;
    detailOpenerRef.current = null;
    setDetailUuid(null);
    if (opener?.isConnected) { requestAnimationFrame(() => opener.focus()); return; }
    if (wasNow) requestAnimationFrame(() => document.querySelector(".wall-title")?.focus());
    else if (back) focusRow(back);
  };
  // Letting go of the one thing, from its sheet, with Undo.
  const handleUnpinWithUndo = (task) => {
    setUndo({ kind: "unpin", task, at: Date.now() });
    handlePinTask(task);
  };
  // The row after (or before) this one, for focus once this one leaves.
  const neighbourOf = (task) => {
    const i = remainingTasks.findIndex(t => t.uuid === task.uuid);
    return remainingTasks[i + 1]?.uuid || remainingTasks[i - 1]?.uuid || null;
  };
  // Keys shared by a focused row and the open task.
  // The row (or the open task) leaves for the wall: the detail closes and
  // focus goes to the task's new place, from P and the footer button alike.
  const makeOneThingAndFollow = (task) => {
    handleMakeOneThing(task);
    setDetailUuid(null);
    requestAnimationFrame(() => document.querySelector(".wall-title")?.focus({ preventScroll: true }));
  };
  const actOnTask = (task, key) => {
    if (key === "d") { const next = neighbourOf(task); handleToggleComplete(task); focusRow(next); return true; }
    if (key === "t") { const next = neighbourOf(task); handleTomorrow(task); focusRow(next); return true; }
    if (key === "p") { makeOneThingAndFollow(task); return true; }
    if (key === "e") { openDetail(task); setEditTitle(prev => ({ uuid: task.uuid, n: (prev?.n || 0) + 1 })); return true; }
    if (key === "backspace" || key === "delete") { const next = neighbourOf(task); handleDeleteTask(task); focusRow(next); return true; }
    return false;
  };
  const stepTask = (task, dir) => {
    const i = remainingTasks.findIndex(t => t.uuid === task.uuid);
    // From a task the filter hides, ↑/↓ step into the filtered list.
    if (i < 0 && !(detailHidden && task.uuid === detailUuid)) return false;
    const next = i < 0 ? remainingTasks[dir > 0 ? 0 : remainingTasks.length - 1] : remainingTasks[i + dir];
    if (!next) return false;
    if (detailUuid) setDetailUuid(next.uuid);
    focusRow(next.uuid);
    return true;
  };
  const onListKeyDown = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const row = e.target;
    if (!row?.matches?.('[data-testid="task-row"]')) return;
    const task = remainingTasks.find(t => t.uuid === row.dataset.taskUuid);
    if (!task) return;
    const key = e.key.toLowerCase();
    // The laptop drawer is not modal, so focus can stay on the row: Esc closes
    // the open task first, and the list's own Escape stands down.
    if (key === "escape" && detailTask) { e.preventDefault(); e.stopPropagation(); closeDetail(); return; }
    let handled = false;
    if (key === "arrowdown" || key === "j") handled = stepTask(task, 1) || true;
    else if (key === "arrowup" || key === "k") handled = stepTask(task, -1) || true;
    else if (key === "enter") { openDetail(task); handled = true; }
    else handled = actOnTask(task, key);
    if (handled) e.preventDefault();
  };
  const onDetailKeyDown = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !detailTask) return;
    const key = e.key.toLowerCase();
    if (key === "escape") { e.preventDefault(); e.stopPropagation(); closeDetail(); return; }
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    let handled = false;
    if (key === "arrowdown") handled = stepTask(detailTask, 1);
    else if (key === "arrowup") handled = stepTask(detailTask, -1);
    else if (drawerViewport) handled = actOnTask(detailTask, key);
    if (handled) e.preventDefault();
  };
  // Finished today — the same set the header's "N done" counts. A task done
  // on an earlier day keeps the Today horizon until something moves it, and
  // showing it here put "0 done" above a list of done rows.
  const parkedList = parkedTasks(tasks);
  const completedTasks = todayTasksFiltered.filter((t) => t.isCompleted && t.dateCompletedString === todayStr);
  // 58.6: the phone's sheet under the one thing is "Up next".
  const upNext = sheetViewport && !!pinnedFocusTask;
  // The wall's two figures are claims about the whole day, so they come from
  // todayTasksAll — the Must-Do and Low Energy filters narrow the LIST below,
  // not the day. Reading them off the filtered list let the wall say "0 more
  // today" on a Low Energy day with a full Today list behind it.
  //
  // "N done" is also a claim about TODAY specifically: a completed task keeps
  // the Today horizon until something moves it, so counting them all reported
  // last week's finished work as this morning's progress.
  const wallRemainingCount = todayTasksAll.filter((t) => !t.isCompleted && t.uuid !== pinnedFocusTask?.uuid).length;
  // The open rows the list holds — what the sheet's accessible name reports.
  // The one thing has no row of its own any more (50a: it lives on the wall).
  const listOpenRows = remainingTasks.length;
  // App's floating timer (shown for a session left running behind the
  // overlay) sits over the sheet's bottom edge; the sheet makes room for it.
  // The list header's figures (41a: "11 · 0 done", "All · 11", "Must-do · 2").
  // "Done" is done TODAY — a finished task keeps the Today horizon until
  // something moves it.
  const listAllCount = wallRemainingCount;
  const listMustCount = todayTasksAll.filter((t) => t.isMVD && !t.isCompleted && t.uuid !== pinnedFocusTask?.uuid).length;
  const listDoneCount = todayTasksAll.filter((t) => t.isCompleted && t.dateCompletedString === todayStr).length;
  // What the empty wall's "Or pick one" rows draw from — the same pool the
  // peek shows, so the near-duplicate the user is about to retype is the one
  // they would have seen anyway.
  // K2: minutes on THAT task today, not the day's total. An unreadable ledger
  // (demo mode has no uid, a refused read) yields 0, which renders as a bare
  // "Done." — the same as a genuine zero, and never a figure that isn't real.
  const doneMinutes = doneCommitment ? minutesForTaskOn(ledgerRaw, doneCommitment.uuid, todayStr) : 0;
  // K3: the proposal is the next open item, and "Not now" holds until the Loci
  // day turns over — a reload, a relaunch or a theme switch must not resurrect
  // it. With nothing left to propose it simply does not render; no "nothing
  // left" celebration replaces it.
  const proposalDismissed = config.wallProposalDismissedDate === todayStr;
  const wallProposal = (doneCommitment && !proposalDismissed)
    ? todayTasksAll
        // Q36.3: never proposes something at a set time (Codex review of #431).
        .filter(t => !t.isCompleted && t.uuid !== doneCommitment.uuid && !isEventTask(t))
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))[0] || null
    : null;

  const momentum = buildMomentum(ledgerRaw, new Date(), windows);

  // The wall is asking the question itself (J2a), so the legacy first-run
  // panel — brain illustration, six steps, "tap + to add your first task" —
  // must not render beneath it. Two competing creation flows on first launch
  // is the screen this redesign exists to remove.
  const wallIsAsking = !pinnedFocusTask && !doneCommitment;



  const setRescueTaskAsNowFocus = ({ close = false, target = rescueTask } = {}) => {
    if (close) setRescueActive(false);
    const rescueTask = target;
    // Q36.3: something at a set time is never the focus (Codex review of #431).
    if (!rescueTask || isEventTask(rescueTask)) return Promise.resolve();
    const now = Date.now();
    // Retargeting focus to rescueTask clears isNowFocus on whichever task
    // currently holds it — end that task's open session first, or it's left
    // orphaned with no terminal event (same gap fixed for Coach's focus chips).
    const previouslyFocused = tasks.find(t => t.uuid !== rescueTask.uuid && t.isNowFocus);
    const endedFocusSession = previouslyFocused ? endFocusSession("user_abandoned") : null;
    // Retargeting to a DIFFERENT task doesn't make activeTask null, so the
    // hook's own "stop timer when activeTask disappears" effects never fire —
    // without this, a real running timer would keep ticking, silently
    // retargeted to rescueTask with no backing session.
    if (endedFocusSession) {
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    // This can also unpark rescueTask (see below) — record that transition too.
    const wasParked = !!rescueTask.isParked;
    return savePayloadAsync({ ...payload, tasks: tasks.map(t => {
      const newFocus = t.uuid === rescueTask.uuid;
      if (!newFocus) {
        if (!t.isNowFocus) return t;
        return { ...t, isNowFocus: false, lastUpdated: now };
      }
      // Also clear isParked — a task Rescue parked earlier in the same
      // session (or previously) would otherwise become a hidden focus task:
      // todayTasksAll filters parked tasks out of view, but useFocusTimer
      // still treats any non-deleted, non-completed isNowFocus task as active.
      if (t.isNowFocus && !t.isParked) return t;
      return { ...t, isNowFocus: true, isParked: false, lastUpdated: now };
    }) })
      .then(() => {
        const events = [];
        if (endedFocusSession) {
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
        }
        if (wasParked) {
          events.push(buildTaskMutationEvent("task_unparked", rescueTask, { windows, now }));
        }
        if (events.length > 0) writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
  };

  // ── Rescue's actions (Q55.3) ──
  // A state picked on Mind Box opens Rescue here, once: the request is then
  // cleared so a later visit to Today doesn't open it again.
  useEffect(() => {
    if (!rescueRequest?.at) return;
    openRescueMode(rescueRequest.state || null, true);
    onRescueRequestOpened?.();
  }, [rescueRequest?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeRescue = () => {
    setRescueActive(false);
    if (rescueFromMindBox) onRescueClosed?.();
  };
  // Rescue works on the task as it is now: after Clear my day moves it off
  // Today (or Undo brings it back), the stored copy is stale.
  const rescueTaskLive = rescueTask
    ? tasks.find(t => t.uuid === rescueTask.uuid && !t.isDeleted && !t.isParked && isOnToday(t, todayStr)) || null
    : null;
  // Back to it / One thing, N minutes: the one thing, pinned if it isn't yet,
  // then a focus block of that length.
  const startRescueFocus = (minutes) => {
    setRescueActive(false);
    const target = rescueTaskLive;
    if (!target || isEventTask(target)) return;
    const pin = target.isNowFocus ? null : setRescueTaskAsNowFocus({ target });
    startFocusAndLog(target, pin, { plannedSeconds: minutes * 60 });
  };
  // Clear my day (Q52): Today's open tasks only, with Undo.
  const handleClearMyDay = (dest, keepUuid) => {
    const now = Date.now();
    const result = clearMyDay(tasks, { dest, todayStr, keepUuid, now });
    if (!result) return null;
    const movedOne = !keepUuid && result.before.some(t => t.isNowFocus);
    const endedFocusSession = movedOne && focusSessionId ? endFocusSession("user_abandoned") : null;
    if (endedFocusSession) {
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    const fromState = { horizonLevel: "today" };
    const toState = { horizonLevel: dest === "week" ? "week" : "today" };
    const events = result.before.map(t => buildTaskMutationEvent(dest === "park" ? "task_parked" : "task_moved", t, {
      ...(dest === "park" ? {} : { fromState, toState }),
      windows, now,
    }));
    if (endedFocusSession) {
      events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
    }
    savePayloadAsync({ ...payload, tasks: result.tasks })
      .then(() => writeActivityEvents(eventsPatch(uid, events)))
      .catch(() => {});
    return {
      count: result.ids.length,
      // Undo logs the way back for each task it restores, so the activity
      // ledger doesn't keep them as moved or parked.
      undo: () => {
        const current = latestPayloadRef.current.tasks || [];
        const restored = new Set(current.filter(t => t.lastUpdated === result.appliedAt).map(t => t.uuid));
        const back = result.before.filter(t => restored.has(t.uuid));
        savePayloadAsync({ ...latestPayloadRef.current, tasks: undoClearMyDay(current, result) })
          .then(() => {
            if (!back.length) return;
            const at = Date.now();
            writeActivityEvents(eventsPatch(uid, back.map(t => buildTaskMutationEvent(dest === "park" ? "task_unparked" : "task_moved", t, {
              ...(dest === "park" ? {} : { fromState: toState, toState: fromState }),
              windows, now: at,
            }))));
          })
          .catch(() => {});
      },
    };
  };
  const handleRescueThought = (text) => {
    const added = addThought(payload, text);
    if (!added) return false;
    savePayload(added.payload);
    return true;
  };
  const handleRescueFirstStep = (text) => {
    if (!rescueTask) return;
    savePayload({ ...payload, tasks: withNextStep(tasks, rescueTask, text) });
  };
  // Pick the easiest task: the smallest open task on Today becomes the one thing.
  const handlePickEasiest = () => {
    const open = todayTasksAll.filter(t => !t.isCompleted && !isEventTask(t));
    const est = (t) => (Number(t.timeEstimateMinutes) > 0 ? Number(t.timeEstimateMinutes) : 25);
    const easiest = [...open].sort((a, b) => est(a) - est(b) || (a.orderIndex ?? 0) - (b.orderIndex ?? 0))[0];
    if (!easiest) return null;
    if (!easiest.isNowFocus) setRescueTaskAsNowFocus({ target: easiest });
    setRescueTask(easiest);
    return easiest;
  };

  const parkRescueTask = () => {
    if (!rescueTask) return;
    const now = Date.now();
    const event = buildTaskMutationEvent("task_parked", rescueTask, { windows, now });
    // Rescue is often opened on the actively focused task (rescueTask ===
    // activeTask) — parking it clears isNowFocus below without ending its
    // session, same gap fixed for the row-menu park action.
    let endedFocusSession = null;
    if (rescueTask.isNowFocus) {
      endedFocusSession = endFocusSession("user_abandoned");
      setIsTimerRunning(false);
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
    savePayloadAsync({ ...payload, tasks: tasks.map(t => (
      t.uuid === rescueTask.uuid
        ? { ...t, isParked: true, parkedAt: now, isNowFocus: false, lastUpdated: now }
        : t
    )) })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
  };

  // Laptop keys for Today (37l, 41a, 49): Space starts focus, D marks done,
  // S splits, N adds a task, L shows or hides the list.
  // Never while typing, Space never on a focused control,
  // never with a modifier, and never while anything is open over Today.
  // Escape puts the sheet away wherever focus is — opening it from the peek
  // or with L leaves focus behind it. Not while something sits over Today
  // (a dialog, a row menu handles its own Escape first).
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onEsc = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // An Escape that starts inside a dialog or menu belongs to it. Checked by
      // where the key came from, not by state: closing that layer re-renders
      // before this listener runs, so its state already reads "closed".
      if (e.target?.closest?.('[role="dialog"], .modal-card, [data-testid="task-options-menu"]')) return;
      if (isFocusMode || splitTask || isAddTaskDialogOpen || rescueActive || frontPickerTask) return;
      closeSheet();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  });

  const wallKeysBlocked = isFocusMode || isAddTaskDialogOpen || (!!detailUuid && !drawerViewport)
    || rescueActive || !!frontPickerTask || !!splitTask || moreOpen || (!!dayClosed && !focusSessionActive);
  useEffect(() => {
    if (wallKeysBlocked) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // A focused row or the open task has its own keys (50b).
      if (el?.closest?.('[data-testid="task-row"], [data-testid="task-detail"]')) return;
      const isNative = el && /^(BUTTON|A)$/.test(el.tagName);
      // Any other focused control — a row in Drag anywhere mode is a
      // focusable <div> whose keys drive a keyboard reorder, not the wall.
      if (el && !isNative && el !== document.body && el !== document.documentElement && el.tabIndex >= 0) return;
      const key = e.key.toLowerCase();
      // On a button or link only Space would also press it; letters would
      // not, and a tap on a control leaves focus on it.
      if (key === " " && isNative) return;
      if (key === "n" && onOpenAddTask) {
        e.preventDefault();
        onOpenAddTask();
        return;
      }
      if (key === "m" && onOpenDayMap) {
        e.preventDefault();
        onOpenDayMap();
        return;
      }
      if (!pinnedFocusTask) return;
      if (key === "e") {
        e.preventDefault();
        setDetailUuid(pinnedFocusTask.uuid);
        return;
      }
      if (key === "l") {
        if (listMotionActive()) toggleList(!peekOpenRef.current);
        else setPeekOpen(v => !v);
      } else if (key === " ") {
        e.preventDefault();
        startWallFocus(pinnedFocusTask);
      } else if (key === "d") {
        handleToggleComplete(pinnedFocusTask);
      } else if (key === "s") {
        setSplitTask(pinnedFocusTask);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const listShown = peekOpen || !pinnedFocusTask;

  const closedView = !!dayClosed && !isFocusMode && !focusSessionActive;
  const doneTodayTasks = closedView ? tasks.filter(t => t.isCompleted && !t.isDeleted && t.dateCompletedString === todayStr) : [];
  return (
    <>
      {/* 57f: a review waiting — one line above the day until it's done. */}
      {reviewLine && (
        <button type="button" className="today-review-line" onClick={reviewLine.onOpen}>
          {reviewLine.text} · <span className="today-review-go">Review</span>
        </button>
      )}
      {closeLine && !dayClosed && (
        <button type="button" className="today-review-line" onClick={closeLine.onOpen}>
          {closeLine.text} · <span className="today-review-go">Close the day</span>
        </button>
      )}
      {/* ── Today (turns 37, 41, 54). From 1024px the task has a column of its
           own with the list or the Day map beside it (54a, 54c, 54e); on
           phones and tablets the task and the list stack. ── */}
      {/* 47.3: a closed day shows only this, the two actions and what got
          done — until a session runs (Start anyway), or it's reopened. */}
      {closedView && (
        <section className="today-closed" aria-labelledby="today-closed-title">
          <h2 className="today-closed-title" id="today-closed-title">
            Day closed.{dayClosed.firstTitle ? ` Tomorrow starts with ${dayClosed.firstTitle}.` : ""}
          </h2>
          <div className="today-closed-actions">
            {dayClosed.onStartAnyway && <button type="button" className="eh-btn" onClick={dayClosed.onStartAnyway}>Start anyway</button>}
            <button type="button" className="eh-btn" onClick={dayClosed.onReopen}>Reopen the day</button>
          </div>
          {doneTodayTasks.length > 0 && (
            <details className="today-closed-done">
              <summary>Done today · {doneTodayTasks.length}</summary>
              <ul>{doneTodayTasks.map(t => <li key={t.uuid}>{t.title}</li>)}</ul>
            </details>
          )}
        </section>
      )}
      <div ref={layoutRef} style={closedView ? { display: "none" } : undefined} className={`today-layout${listShown ? " is-list-open" : ""}`}>
      <div className="today-layout-main" inert={wallCovered ? "" : undefined} aria-hidden={wallCovered ? "true" : undefined}>
      <TodayWall
        task={pinnedFocusTask}
        goal={wallGoal}
        onOpenGoal={wallKickerFront && wallKickerFront.id !== LEGACY_DEADLINE_FRONT_ID
          ? (onOpenFront ? () => onOpenFront(wallKickerFront.id) : null)
          : onOpenKeyDeadline}
        goalRecord={goalRecordProps}
        anchors={config.anchorsOnToday === "off" ? [] : anchors.filter(a => a && typeof a.text === "string" && a.text.trim())}
        focusMinutes={focusBlockSeconds(config) / 60}
        startChoice={config.focusStartChoice}
        onChooseStart={(choice) => saveConfigPatch({ focusStartChoice: choice })}
        peekOpen={peekOpen}
        onTogglePeek={() => (listMotionActive() ? toggleList(!peekOpen) : setPeekOpen(v => !v))}
        onAdd={onOpenAddTask}
        onOpenDayMap={onOpenDayMap}
        onOpenTask={() => pinnedFocusTask && setDetailUuid(pinnedFocusTask.uuid)}
        remainingCount={wallRemainingCount}
        nextTitle={remainingTasks[0]?.title || null}
        onStepDone={(stepId) => pinnedFocusTask && handleSubStepToggle(pinnedFocusTask, stepId)}
        timerLabel={wallLiveTimerLabel}
        live={wallSessionLive ? {
          secondsLeft: timerSecondsLeft, maxSeconds: timerMaxSeconds, running: isTimerRunning, onPauseResume: () => setIsTimerRunning(r => !r),
          // Q41: block end in place — done, the break, Break's over.
          blockEnd, blockNumber: focusBlockNumber, onStartBreak: startBreak, onStartNext: () => startNextBlock(),
        } : null}
        onStartFocus={() => pinnedFocusTask && startWallFocus(pinnedFocusTask)}
        onMarkDone={() => pinnedFocusTask && handleToggleComplete(pinnedFocusTask)}
        onSplit={() => pinnedFocusTask && setSplitTask(pinnedFocusTask)}
        doneTask={doneCommitment}
        doneMinutes={doneMinutes}
        proposal={wallProposal}
        onCommitProposal={() => wallProposal && handlePinTask(wallProposal)}
        onDismissProposal={() => saveConfigPatch({ wallProposalDismissedDate: todayStr })}
        commitBlocked={isEveningGuardBlocked(config)}
        onCommitNewTask={handleCommitNewTask}
        mindBoxCount={(payload.brainDump || []).length}
        onOpenMindBox={onOpenMindBox}
        onScattered={onScattered}
        onRescue={openRescueMode}
        nowCount={pinnedFocusTask ? todayTasksAll.filter(t => !t.isCompleted).length : 0}
        onMore={pinnedFocusTask ? () => setMoreOpen(true) : null}
      />

      </div>

      {/* ── After that: the rest of today (41a, 37b, 49c). The peek IS this
           section. Closed is the default — that is the wall. With no
           commitment there is no wall to look at, so the list stays visible
           rather than leaving the screen empty. */}
      <section
        ref={sheetRef}
        className={`tasks-section today-list${pinnedFocusTask ? " is-sheet" : ""}${sheetFull ? " is-full" : ""}`}
        aria-label={`Today's list, ${listOpenRows} ${listOpenRows === 1 ? "task" : "tasks"}`}
        // Conditional INLINE, not via a class: an inline display beats any
        // class rule, and this element needs one for the open state.
        style={{ display: !peekOpen && pinnedFocusTask ? "none" : "flex" }}
      >
        {/* Phones and tablets under 840 (37b/37c): the open list is a sheet
            over the wall, at half or full height. The grabber drags between
            them; a tap on it toggles. From 840 these are hidden and the list
            is inline. */}
        {pinnedFocusTask && (
          <>
            <button
              type="button"
              className="today-sheet-grabber"
              aria-label={sheetFull ? "Collapse the list" : "Expand the list"}
              aria-expanded={sheetFull}
              onPointerDown={onSheetPointerDown}
              onClick={onSheetGrabberClick}
            >
              <span aria-hidden="true" />
            </button>
            <span className="sr-only" aria-live="polite">{sheetFull ? "List at full height" : "List at half height"}</span>
            {/* 37c: at full height a compact NOW card keeps the task in view. */}
            <div className="today-sheet-now">
              <span className="today-sheet-now-kicker">NOW</span>
              <span className="today-sheet-now-title">{pinnedFocusTask.title}</span>
              {/* Names what a tap does: an open session is resumed, as on the
                  wall's "Resume focus". */}
              <button type="button" className="today-sheet-now-start" onClick={() => startFocusAndLog(pinnedFocusTask)}>
                {wallSessionLive ? "Resume" : "Start"}
              </button>
            </div>
          </>
        )}
        {/* One header row on a laptop (51a): title, count, the filter, Hide
            list. Phones and tablets keep the tools on a second line under it
            (37b). */}
        <div className="today-list-top">
        <div className="today-list-head">
          <h2 className="today-list-title">{upNext ? "Up next" : "After that"}</h2>
          <span className="today-list-count">{listAllCount} · {listDoneCount} done</span>
          <span className="today-list-head-end">
            {onOpenAddTask && (
              <button type="button" className="today-list-add" onClick={onOpenAddTask}>
                + Add <kbd className="wall-key" aria-hidden="true">N</kbd>
              </button>
            )}
            {pinnedFocusTask && (
              <button type="button" className="today-list-hide" onClick={() => (listMotionActive() ? toggleList(false) : closeSheet())}>
                Hide list <kbd className="wall-key" aria-hidden="true">L</kbd>
              </button>
            )}
          </span>
        </div>

        <div className="today-list-tools">
          {/* Must-do is a filter on the list (Y4). */}
          <div className="today-seg" role="group" aria-label="Show">
            <button type="button" className="today-seg-opt" aria-pressed={!isMVDMode} onClick={() => setIsMVDMode(false)}>
              All · {listAllCount}
            </button>
            <button type="button" className="today-seg-opt" aria-pressed={isMVDMode} onClick={() => setIsMVDMode(true)}>
              Must-do · {listMustCount}
            </button>
          </div>
        </div>
        </div>

        {/* Q59: List | Day map, two views of one plan. */}
        <div className="today-view-switch" role="group" aria-label="View">
          <button type="button" className="today-view-opt" aria-pressed={listView === "list"} onClick={() => setListView("list")}>List</button>
          <button type="button" className="today-view-opt" aria-pressed={listView === "daymap"} onClick={() => setListView("daymap")}>Day map</button>
        </div>
        {listView === "daymap" ? (
          <DayMapColumn
            route={route}
            onOpenDayMap={onOpenDayMap}
            onOpenTask={openFromDayMap}
            onDone={(task) => handleToggleComplete(task)}
            onMoveToTomorrow={handleMoveManyToTomorrow}
            onPark={handleParkMany}
          />
        ) : (<>
        <div className="tasks-list" data-testid="today-tasks-list" onKeyDown={onListKeyDown}>
          {!wallIsAsking && todayTasksAll.length === 0 && (
            <p className="today-list-empty">Nothing else on Today.</p>
          )}
          {/* A light day (57b answer 17): the one thing is all that is open. */}
          {pinnedFocusTask && !isMVDMode && remainingTasks.length === 0 && (
            <p className="today-list-empty">
              One task today. Add another, or{" "}
              {onOpenPlan
                ? <button type="button" className="today-list-empty-link" onClick={onOpenPlan}>pull from This week ›</button>
                : "pull from This week."}
            </p>
          )}
          {todayTasksAll.length > 0 && todayTasksFiltered.length === 0 && isMVDMode && (
            <p className="today-list-empty">No must-dos yet. Open a task and turn on Must-do.</p>
          )}
          {todayTasksFiltered.length > 0 && (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={({ active }) => setActiveTaskId(active.id)}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setActiveTaskId(null)}
              >
                <SortableContext
                  items={remainingTasks.map(t => getTaskKey(t))}
                  strategy={verticalListSortingStrategy}
                >
                  {remainingTasks.map((task, idx) => (
                    <React.Fragment key={getTaskKey(task)}>
                      {idx === firstOver && (
                        <p className="today-dayend" aria-label={`Day ends at ${formatClock24(route.plan.dayEnd)}`}>DAY ENDS {formatClock24(route.plan.dayEnd)}</p>
                      )}
                      <SortableTaskItem id={getTaskKey(task)} isOver={firstOver !== -1 && idx >= firstOver} disabled={isFixedStop(task) && task.dayMapDate === todayStr}>
                        {({ dragHandleListeners, dragHandleAttributes, dragActivatorRef }) => (
                          <TaskRow
                            task={task}
                            onToggleComplete={handleToggleComplete}
                            onDelete={handleDeleteTask}
                            onOpen={openDetail}
                            onMakeOneThing={handleMakeOneThing}
                            isMin={minimumDayIds.has(String(task.uuid))}
                            fromTag={task.reviewFrom?.day === todayStr ? task.reviewFrom.label : null}
                            fromYesterday={isFromYesterday(task)}
                            fixedAt={task.dayMapDate === todayStr ? task.dayMapFixedMinutes ?? null : null}
                            minutes={getEstimate(task)}
                            overActions={cut.overIds.has(getTaskId(task)) && !task.isNowFocus ? { onTomorrow: handleTomorrow, onPark: handleParkWithUndo } : null}
                            tabStop={task.uuid === rovingUuid}
                            isTinted={task.uuid === tintUuid}
                            onSwipeDone={handleToggleComplete}
                            onSwipeTomorrow={handleTomorrow}
                            onPutOnFront={openFrontPicker}
                            onBreakdown={handleBreakdown}
                            isBreakingDown={breakdownLoadingUuid === task.uuid}
                            breakdownError={breakdownErrorUuid === task.uuid}
                            breakdownNoKey={breakdownNoKeyUuid === task.uuid}
                            dragHandleListeners={dragHandleListeners}
                            dragHandleAttributes={dragHandleAttributes}
                            dragActivatorRef={dragActivatorRef}
                            interactionStyle={taskRowInteractionStyle}
                            isGoal={!!wallKickerFront && task.frontId === wallKickerFront.id}
                          />
                        )}
                      </SortableTaskItem>
                    </React.Fragment>
                  ))}
                </SortableContext>
                {firstOver === -1 && remainingTasks.length > 0 && route.scheduledTasks.length > 0 && (
                  <p className="today-dayend">DAY ENDS {formatClock24(route.plan.dayEnd)}{cut.spare > 0 ? ` · ${formatSpanCaps(cut.spare)} SPARE` : ""}</p>
                )}
                {firstOver !== -1 && (
                  <p className="today-wontfit-line">
                    {cut.overIds.size} won’t fit · {formatSpanCaps(cut.wontFitMinutes).toLowerCase()}
                    {" · "}<button type="button" className="today-list-empty-link" onClick={() => setListView("daymap")}>Sort in Day map ›</button>
                  </p>
                )}
                <DragOverlay dropAnimation={null}>
                  {activeTaskId ? (() => {
                    const activeTask = remainingTasks.find(t => getTaskKey(t) === activeTaskId);
                    if (!activeTask) return null;
                    return (
                      <div style={{
                        background: "var(--bg-card)",
                        border: "1.5px solid var(--accent)",
                        borderRadius: "12px",
                        padding: "12px 14px",
                        boxShadow: "0 12px 40px rgba(0,0,0,0.28)",
                        transform: "rotate(1deg) scale(1.02)",
                        opacity: 0.96,
                        fontSize: "14px",
                        fontWeight: "700",
                        color: "var(--text-primary)",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px"
                      }}>
                        <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>⠿</span>
                        {activeTask.title}
                      </div>
                    );
                  })() : null}
                </DragOverlay>
              </DndContext>
            </>
          )}
          {/* 62d: parked tasks fold at the bottom of the list, above the
              done ones; each is restored to Today or dropped. */}
          {parkedList.length > 0 && (
            <div className="today-parked">
              <button type="button" className="today-parked-line" aria-expanded={parkedOpen} onClick={() => setParkedOpen(o => !o)}>
                <span className="today-parked-kicker">Parked · {parkedList.length} {parkedOpen ? "▾" : "▸"}</span>
                {parkedSince(parkedList[0]) > 0 && (
                  <span className="today-parked-since">since {new Date(parkedSince(parkedList[0])).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                )}
              </button>
              {parkedOpen && (
                <ul className="today-parked-list">
                  {parkedList.map(task => (
                    <li key={task.uuid} className="today-parked-row">
                      <span className="today-parked-title">{task.title}</span>
                      <button type="button" className="today-parked-restore" aria-label={`Restore: ${task.title}`} onClick={() => handleRestoreParked(task)}>Restore</button>
                      <button type="button" className="today-parked-drop" aria-label={`Drop: ${task.title}`} onClick={() => handleDeleteTask(task)}>Drop</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {completedTasks.length > 0 && (upNext ? (
            <div className="today-parked today-done-fold">
              <button type="button" className="today-parked-line" aria-expanded={doneOpen} onClick={() => setDoneOpen(o => !o)}>
                <span className="today-parked-kicker">Done today · {completedTasks.length} {doneOpen ? "▾" : "▸"}</span>
              </button>
              {doneOpen && completedTasks.map(task => (
                <TaskRow key={task.uuid} task={task} onToggleComplete={handleToggleComplete} onDelete={handleDeleteTask} />
              ))}
            </div>
          ) : (
            <>
              <div className="completed-section-title">Completed</div>
              {completedTasks.map(task => (
                <TaskRow key={task.uuid} task={task} onToggleComplete={handleToggleComplete} onDelete={handleDeleteTask} />
              ))}
            </>
          ))}
          {/* 50g–h: the list closes with a quiet line for what was moved to
              tomorrow; it opens in place, each with Bring back. */}
          {movedToTomorrow.length > 0 && (
            <div className="today-moved">
              <button type="button" className="today-moved-line" aria-expanded={movedOpen} onClick={() => setMovedOpen(o => !o)}>
                <span>{movedToTomorrow.length} moved to tomorrow</span>
                <span className="today-moved-toggle">{movedOpen ? "Hide" : "Show"}</span>
              </button>
              {movedOpen && (
                <ul className="today-moved-list">
                  {movedToTomorrow.map(task => (
                    <li key={task.uuid} className="today-moved-row">
                      {task.priority && <span className="task-row-priority" aria-label={`Priority ${task.priority.replace(/\D/g, "")}`}>{task.priority}</span>}
                      <span className="today-moved-title">{task.title}</span>
                      <button type="button" className="today-moved-back" aria-label={`Bring back: ${task.title}`} onClick={() => handleBringBack(task)}>Bring back</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        </>)}
        {/* Laptop (51a): the list's last line adds to Today. It pins to the
            bottom of the card when the list is longer than the screen. */}
        {onOpenAddTask && (
          <div className="today-list-addbar">
            <button type="button" className="today-list-addrow" onClick={() => onOpenAddTask()} aria-label="Add a task to Today">
              <IconPlus size={18} />
              <span className="today-list-addrow-label">Add a task</span>
              <span className="today-list-addrow-where" aria-hidden="true">to Today</span>
              <kbd className="wall-key" aria-hidden="true">N</kbd>
            </button>
          </div>
        )}
      </section>
      </div>

      {/* ── Momentum (J4). Below the ledger, never beside the hero. Hidden
           entirely by the Settings switch, and absent on its own with no
           history — an empty frame is a scoreboard of what you haven't done. ── */}
      {config.momentumEnabled !== false && momentum && (
        <Momentum bars={momentum.bars} sentence={momentum.sentence} />
      )}

      {/* ── Full-Screen Focus Mode Overlay */}
      {isFocusMode && activeTask && (() => {
        // Q39.2: piece 1 of a split, not started — Start begins its session.
        const fresh = splitFresh && splitFresh.pieceUuid === activeTask.uuid ? splitFresh : null;
        const block = focusBlockSeconds(config);
        return (
        <FocusModePage
          task={activeTask}
          secondsLeft={fresh ? block : timerSecondsLeft}
          maxSeconds={fresh ? block : timerMaxSeconds}
          isRunning={fresh ? false : isTimerRunning}
          onPlayPause={fresh ? startSplitPiece : () => setIsTimerRunning(r => !r)}
          splitNote={fresh ? { n: fresh.n, onUndo: fresh.heldSessionId ? undoStuckSplit : null } : null}
          onDone={() => { handleToggleComplete(activeTask); setIsFocusMode(false); }}
          onExit={() => setIsFocusMode(false)}
          onRestart={handleRestartFocus}
          onEndSession={fresh ? null : handleEndSession}
          onToggleStep={(stepId) => handleSubStepToggle(activeTask, stepId)}
          blockNumber={fresh ? 1 : focusBlockNumber}
          clockMode={config.focusClock === "numbers" ? "numbers" : "ring"}
          // Q37.2: the task's earlier sessions today; this one counts live.
          taskMinutesToday={ledgerStatus === "ready" ? minutesForTaskOn(ledgerRaw, activeTask.uuid, todayStr, { exceptSessionId: focusSessionId }) : 0}
          keysOff={rescueActive}
          onKeepGoing={extendTimer}
          onAddTime={fresh ? null : addTimeToSession}
          // 59i: block end — "Another" is a block of the usual length; the
          // break, Break's over and the 60 s wait are the timer's (Q41).
          blockMinutes={focusBlockSeconds(config) / 60}
          blockEnd={blockEnd}
          onStartBreak={startBreak}
          onStartNext={startNextBlock}
          onSetNextLen={setNextLen}
          onHoldBlockEnd={setBlockEndHeld}
          dayKey={todayStr}
          onReestimate={(m) => savePayload({ ...payload, tasks: tasks.map(t => t.uuid === activeTask.uuid ? { ...t, timeEstimateMinutes: m, lastUpdated: Date.now() } : t) })}
          startedAt={fresh ? null : focusStartedAt}
          elapsedSeconds={fresh ? 0 : focusElapsedSeconds}
          onAddBrainDump={handleFocusBrainDump}
          parkedCount={parked.sessionId === focusSessionId ? parked.n : 0}
          onSmallerStep={handleSmallerStep}
          onSplit={handleStuckSplit}
          onSwitchNext={stuckNext ? handleSwitchNext : null}
          nextTitle={stuckNext?.title}
          onTalkToCoach={handleStuckCoach}
          openStuck={stuckPending}
          onStuckShown={onStuckShown}
          pipOpen={pipOpen}
          onOpenPiP={handleOpenPiP}
          selectedTrack={selectedTrack}
          volume={volume}
          trackLoadState={trackLoadState}
          selectTrack={selectTrack}
          selectCategory={selectCategory}
          reshuffleTrack={reshuffleTrack}
          changeVolume={changeVolume}
        />
        );
      })()}

      {/* ── Put on a front (the swipe's Front, and the row menu) */}
      {frontPickerTask && (() => {
        const fronts = frontsFromConfig(config).filter(f => !f.parked);
        const currentId = tasks.find(t => t.uuid === frontPickerTask.uuid)?.frontId || null;
        return (
          <div className="focus-now-backdrop" onClick={() => setFrontPickerTask(null)}>
            <div
              className="focus-now-sheet front-picker"
              role="dialog"
              aria-modal="true"
              aria-label={`Put ${frontPickerTask.title} on a front`}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === "Escape") { setFrontPickerTask(null); return; }
                // Modal: Tab and Shift+Tab stay among the picker's buttons.
                if (e.key !== "Tab") return;
                const items = [...e.currentTarget.querySelectorAll("button")];
                if (items.length === 0) return;
                const i = items.indexOf(document.activeElement);
                const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
                e.preventDefault();
                items[next].focus();
              }}
            >
              <div className="focus-now-sheet-header">
                <span className="focus-now-sheet-title">Put on a front</span>
              </div>
              <div className="focus-now-sheet-body front-picker-body">
                {fronts.length === 0 && (
                  <p className="front-picker-empty">No fronts yet. Add one in Plan.</p>
                )}
                {fronts.map((f, i) => (
                  <button
                    key={f.id}
                    type="button"
                    className="front-picker-opt"
                    aria-pressed={currentId === f.id}
                    autoFocus={i === 0}
                    onClick={() => handlePutOnFront(frontPickerTask, f.id)}
                  >
                    {f.name}
                  </button>
                ))}
                {currentId && (
                  <button type="button" className="front-picker-opt is-off" onClick={() => handlePutOnFront(frontPickerTask, null)}>
                    Not on a front
                  </button>
                )}
                <button type="button" className="front-picker-cancel" autoFocus={fronts.length === 0} onClick={() => setFrontPickerTask(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── The one thing's More sheet (Q58, 67d) */}
      {moreOpen && pinnedFocusTask && (
        <MoreSheet
          task={pinnedFocusTask}
          onSplit={() => setSplitTask(pinnedFocusTask)}
          onDetails={() => setDetailUuid(pinnedFocusTask.uuid)}
          hiddenHorizons={horizonsFromConfig(config, todayStr).filter(h => h.hidden).map(h => h.id)}
          onMove={(dest) => (dest === "tomorrow" ? actOnTask(pinnedFocusTask, "t") : handleMoveWithUndo(pinnedFocusTask, dest))}
          onPark={() => handleParkWithUndo(pinnedFocusTask)}
          onUnpin={() => handleUnpinWithUndo(pinnedFocusTask)}
          onDelete={() => actOnTask(pinnedFocusTask, "delete")}
          onClose={() => setMoreOpen(false)}
        />
      )}

      {/* ── A task, opened (50a–b) */}
      {detailTask && !drawerViewport && <div className="task-detail-scrim" onClick={closeDetail} aria-hidden="true" />}
      {detailTask && (
        <div onKeyDown={onDetailKeyDown}>
          <TaskDetail
            key={detailTask.uuid}
            task={detailTask}
            horizonChoices={horizonChoices(config, todayStr)}
            index={detailIndex}
            isNow={detailIsNow}
            total={remainingTasks.length}
            variant={drawerViewport ? "drawer" : "sheet"}
            isGoal={!!wallKickerFront && detailTask.frontId === wallKickerFront.id}
            fronts={frontsOnOffer(frontsFromConfig(config), detailTask.frontId)}
            editTitleSignal={editTitle?.uuid === detailTask.uuid ? editTitle.n : 0}
            onClose={closeDetail}
            onPatch={patch => handlePatchTask(detailTask.uuid, patch)}
            onToggleMVD={() => handleToggleMVD(detailTask)}
            onSetSteps={(steps, meta) => handleSetSteps(detailTask.uuid, steps, meta)}
            onMakeOneThing={() => makeOneThingAndFollow(detailTask)}
            onLetGo={detailIsNow ? () => { handleUnpinWithUndo(detailTask); setDetailUuid(null); } : undefined}
            onDone={() => actOnTask(detailTask, "d")}
            onTomorrow={() => actOnTask(detailTask, "t")}
            onPark={() => { const next = neighbourOf(detailTask); handleParkWithUndo(detailTask); focusRow(next); }}
            onDelete={() => actOnTask(detailTask, "delete")}
            onShowAll={detailHidden ? () => setIsMVDMode(false) : undefined}
          />
        </div>
      )}

      {/* ── Undo (done, delete, move, front, split, swap, tomorrow, park) */}
      <UndoAnnouncer message={undoText} />
      {undo && (
        <UndoToast
          key={undo.at}
          message={undoText}
          onUndo={handleUndo}
          onClose={() => setUndo(null)}
        />
      )}

      {splitTask && (
        <SplitTaskSheet task={splitTask} onClose={closeSplitSheet} onSplit={handleSplit} />
      )}
      {/* Rescue Mode — triggered by the Rescue chip or Deep Focus's Stuck? button */}
      {rescueActive && (
        <RescueMode
          task={rescueTaskLive}
          allTasks={tasks}
          firstName={(config.userName || "").split(" ")[0] || "friend"}
          config={config}
          entryPoint={rescueEntryPoint}
          includeMemory={!(isSyncingFromCache || syncWarning === "offline")}
          isSyncingFromCache={isSyncingFromCache}
          syncWarning={syncWarning}
          initialState={rescueInitialState}
          todayStr={todayStr}
          onStartFocus={startRescueFocus}
          onClearDay={handleClearMyDay}
          onRememberDest={(dest) => { if (config.clearMyDayDest !== dest) saveConfigPatch?.({ clearMyDayDest: dest }); }}
          onSaveThought={handleRescueThought}
          onSetFirstStep={handleRescueFirstStep}
          onPickEasiest={handlePickEasiest}
          onDismiss={closeRescue}
          onHandoffSummary={(summary) => saveConfigPatch?.({ rescueHandoffSummary: summary })}
          onSetNowFocus={() => setRescueTaskAsNowFocus()}
          onParkTask={parkRescueTask}
          onAccept={() => setRescueTaskAsNowFocus({ close: true })}
        />
      )}
    </>
  );
}
