import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import TaskRow, { ROADMAP_HORIZONS } from "./TaskRow";
import AddTaskDialog from "./AddTaskDialog";
import TodayWall from "./TodayWall";
import Momentum from "./Momentum";
import { frontsFromConfig, commitmentDaysLeft, commitmentKickerFront, frontForCommitment, frontProgress } from "../utils/fronts";
import { useFocusLedger } from "../hooks/useFocusLedger";
import { minutesForTaskOn, sessionsOnDay } from "../utils/focusLedger";
import { buildMomentum } from "../utils/momentum";
import { isEveningGuardBlocked } from "../utils/eveningGuard";
import FocusModePage from "./FocusModePage";
import RescueMode from "./RescueMode";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { buildToggleCompletedTasks, byPriorityThenOrder } from "../utils/taskOps";
import { buildParkTaskTasks } from "../utils/coachActions";
import { shouldStopFocusOnComplete } from "../utils/focusSession";
import { getAIKeys, callAI, extractJsonArray, hasAIKey } from "../utils/aiCall";
import { celebrate } from "../utils/celebrations";
import { track } from "../firebase";
import { scheduleReminder, cancelReminder, formatReminderLabel } from "../utils/reminders";
import { getLociDayStr } from "../utils/dailyAnchors";
import { getFocusWindows } from "../utils/focusWindows";
import { buildTaskMutationEvent, buildFocusStartedEvent, buildFocusTerminalEvent, eventPatch, eventsPatch } from "../utils/activityLog";
import {
  getValidCommittedTaskIds, committedTaskIdsForDay,
  shouldShowReflection, buildEndOfDaySummary, buildReflectionSave, buildReflectionSnooze, REFLECTION_MOODS,
} from "../utils/dailyCoachCheckins";
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

// Addendum A: on a Low Energy day the wall offers a smaller start instead of
// "split it". Five minutes, the same length ScatteredFlow's "Just 5 minutes"
// starts — not the task's own estimate.
const LOW_ENERGY_SESSION_SECONDS = 5 * 60;

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
  </svg>
);

function SortableTaskItem({ id, interactionStyle, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
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
        dragActivatorRef: interactionStyle === "dragAnywhere" ? setActivatorNodeRef : undefined,
      })}
    </div>
  );
}

export default function TodayTab({
  payload, savePayload, savePayloadAsync, saveConfigPatch, onOpenDayMap, onOpenMindBox, onOpenCoach, onScattered, onOpenAddTask,
  activeTask, isTimerRunning, setIsTimerRunning, timerSecondsLeft, setTimerSecondsLeft,
  timerMaxSeconds, setTimerMaxSeconds, isFocusMode, setIsFocusMode,
  focusSessionActive, setFocusSessionActive, sessionCompletePending,
  pipOpen, handleOpenPiP, isAddTaskDialogOpen, startFocusSession, endFocusSession, focusSessionId, focusSessionTaskUuid, changeFocusDuration,
  extendTimer, dismissSessionComplete, focusStartedAt, focusElapsedSeconds,
  selectedTrack, volume, trackLoadState, selectTrack, selectCategory, reshuffleTrack, changeVolume,
  isSyncingFromCache = false,
  pendingCheckinSlot, setPendingCheckinSlot,
  syncWarning = null,
  uid, writeActivityEvents,
}) {
  const { tasks = [], config = {}, contributions = [] } = payload;
  const taskRowInteractionStyle = config.taskRowInteractionStyle === "dragAnywhere" ? "dragAnywhere" : "classic";
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
  // `options` is passed straight to startFocusSession — the wall's low-energy
  // action uses it to start a genuine five-minute session rather than one at
  // the task's own estimate.
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
      setIsTimerRunning(true);
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

  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
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
  useEffect(() => { if (!peekOpen) setSheetFull(false); }, [peekOpen]);
  const sheetRef = useRef(null);
  const sheetDragRef = useRef(null);
  const closeSheet = () => setPeekOpen(false);
  // Dragging the grabber moves the sheet with the finger (no re-render per
  // move), then settles on the nearest height: up to full, down to half, or
  // far enough down to close. A drag that barely moves is left to the click.
  const onSheetPointerDown = (e) => {
    const el = sheetRef.current;
    if (!el) return;
    sheetDragRef.current = null;
    const startY = e.clientY;
    const wasFull = sheetFull;
    let dy = 0;
    const move = (ev) => {
      dy = ev.clientY - startY;
      if (Math.abs(dy) < 6) return;
      sheetDragRef.current = true;
      el.style.transition = "none";
      el.style.transform = `translateY(${Math.max(dy, wasFull ? 0 : -el.offsetHeight)}px)`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.style.transition = "";
      el.style.transform = "";
      if (!sheetDragRef.current) return;
      // Cleared after the click that may follow this pointerup; a drag that
      // ends off the grabber fires no click at all.
      setTimeout(() => { sheetDragRef.current = null; }, 0);
      if (dy < -60) setSheetFull(true);
      else if (wasFull && dy > 60 && dy < 240) setSheetFull(false);
      else if (dy > (wasFull ? 240 : 80)) closeSheet();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const onSheetGrabberClick = () => {
    // The click that ends a drag is not a tap.
    if (sheetDragRef.current) { sheetDragRef.current = null; return; }
    setSheetFull(v => !v);
  };
  useEffect(() => {
    try { localStorage.setItem("loci_today_peek_open", peekOpen ? "1" : "0"); } catch { /* private mode */ }
  }, [peekOpen]);

  // The one surviving scheduled prompt: "reflection" (Day Close). Addendum B
  // deleted the morning commitment and the midday progress check outright.
  const [dailyCheckinSlot, setDailyCheckinSlot] = useState(null);
  const [showDailyCheckin, setShowDailyCheckin] = useState(false);
  const [reflectionMood, setReflectionMood] = useState(null);
  const [reflectionNote, setReflectionNote] = useState("");

  const dailyCheckinCardStyle = {
    background: "var(--accent-light)",
    border: "1px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  };

  const dailyCheckinDismissStyle = {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    fontSize: "14px",
    cursor: "pointer",
    padding: "0 2px",
    lineHeight: 1,
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const openRescueMode = () => {
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
      const candidates = todayTasksAll.filter(t => !t.isCompleted);
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

  useEffect(() => {
    const container = document.querySelector('.screen-content');
    if (!container) return;
    const onScroll = () => setIsScrolled(container.scrollTop > 15);
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const [breakdownLoadingUuid, setBreakdownLoadingUuid] = useState(null);
  const [breakdownErrorUuid, setBreakdownErrorUuid] = useState(null);
  const [breakdownNoKeyUuid, setBreakdownNoKeyUuid] = useState(null);

  const [editingTask, setEditingTask] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  // The one Undo toast: { kind: "done" | "delete" | "unpin" | "move" | "front",
  // task (as it was), to, wasPinned, at }.
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
    let nextXp = Number(config.totalXp) || 0;
    let nextContributions = [...contributions];
    if (isCompleted) {
      nextXp += 100;
      nextContributions = incrementContribution(nextContributions, todayDateStr);
    } else {
      nextXp = Math.max(0, nextXp - 100);
      const contrIdx = nextContributions.findIndex((c) => c.dateString === todayDateStr);
      if (contrIdx !== -1 && nextContributions[contrIdx].count > 0) {
        nextContributions[contrIdx] = { ...nextContributions[contrIdx], count: nextContributions[contrIdx].count - 1, lastUpdated: Date.now() };
      }
    }
    savePayloadAsync({ ...payload, tasks: updatedTasks, config: { ...config, totalXp: nextXp, lastUpdated: Date.now() }, contributions: nextContributions })
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

  const handleFocusBrainDump = (text) => {
    if (!text.trim()) return;
    const newItem = { id: `bd_${Date.now()}`, text: text.trim(), createdAt: Date.now() };
    savePayload({ ...payload, brainDump: [...(payload.brainDump || []), newItem] });
  };

  const handleChangeFocusDuration = (minutes) => {
    changeFocusDuration(minutes);
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
    savePayloadAsync({ ...payload, tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t) })
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

  // Unpin from the list's NOW row: acts at once, with Undo like the rest.
  const handleUnpinWallTask = (task) => {
    if (!task.isNowFocus) return handlePinTask(task);
    setUndo({ kind: "unpin", task, at: Date.now() });
    return handlePinTask(task);
  };

  // Moves from a row (the swipe's "This week", and the menu's horizons) act at
  // once with Undo. Undo puts back the horizon and place it had, and the pin
  // if it was the one thing and nothing else has been pinned since.
  const handleMoveWithUndo = (task, horizon) => {
    setUndo({ kind: "move", task, to: horizon, wasPinned: !!task.isNowFocus, at: Date.now() });
    handleMoveToHorizon(task, horizon);
  };

  // "Put on a front": the swipe's Front and the menu item open this picker.
  const [frontPickerTask, setFrontPickerTask] = useState(null);
  const handlePutOnFront = (task, frontId) => {
    setFrontPickerTask(null);
    const current = tasks.find(t => t.uuid === task.uuid && !t.isDeleted);
    if (!current || (current.frontId || null) === (frontId || null)) return;
    setUndo({ kind: "front", task: current, to: frontId || null, at: Date.now() });
    savePayload({ ...payload, tasks: tasks.map(t => t.uuid === current.uuid ? { ...t, frontId: frontId || null, lastUpdated: Date.now() } : t) });
  };

  const undoMessage = (u) => {
    const title = u.task.title;
    if (u.kind === "move") {
      const label = u.to === "week" ? "This week" : (ROADMAP_HORIZONS.find(h => h.key === u.to)?.label || u.to);
      return `Moved to ${label}: ${title}`;
    }
    if (u.kind === "front") {
      const front = frontsFromConfig(config).find(f => f.id === u.to);
      return front ? `Put on ${front.name}: ${title}` : `Off its front: ${title}`;
    }
    return `${{ done: "Marked done", delete: "Deleted", unpin: "Unpinned" }[u.kind]}: ${title}`;
  };
  const undoText = undo ? undoMessage(undo) : "";

  const handleUndo = () => {
    if (!undo) return;
    const { kind, task, wasPinned } = undo;
    setUndo(null);
    if (kind === "delete") {
      const event = buildTaskMutationEvent("task_restored", task, { windows });
      savePayloadAsync({ ...payload, tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isDeleted: false, lastUpdated: Date.now() } : t) })
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
        ...(wasPinned && !otherPinned ? { isNowFocus: true } : {}),
        lastUpdated: now,
      } : t) })
        .then(() => writeActivityEvents(eventPatch(uid, event)))
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

  // ── Day Close auto-show — the one scheduled interruption, at day's end ──
  useEffect(() => {
    if (isFocusMode || editingTask || sessionCompletePending || isAddTaskDialogOpen || showDailyCheckin || rescueActive) return;
    const now = new Date();
    // Addendum B: the morning commitment and the midday progress check are
    // gone, and so is the morning ritual popup — "an app that interrupts an
    // overwhelmed person to ask how they are is part of the problem". Day Close
    // is the one surviving prompt, and it becomes the Evening Review; until
    // that screen exists it stays here rather than leaving a gap.
    const dueSlots = {
      reflection: shouldShowReflection(now, windows, config, anchorTodayStr),
    };
    // A tapped check-in notification names a slot — honour it if still due.
    let slot = null;
    if (pendingCheckinSlot && dueSlots[pendingCheckinSlot]) {
      slot = pendingCheckinSlot;
    } else if (dueSlots.reflection) {
      slot = "reflection";
    }
    if (!slot) {
      // Consumed (or no longer due) — don't let it keep overriding priority order.
      if (pendingCheckinSlot) setPendingCheckinSlot(null);
      return;
    }
    setDailyCheckinSlot(slot);
    if (slot === "reflection") { setReflectionMood(null); setReflectionNote(""); }
    // Clear pendingCheckinSlot only once the modal actually opens — clearing it now
    // would change a dependency of this effect, canceling this timer (via cleanup)
    // and re-running with the override gone before it ever fires.
    const timer = setTimeout(() => {
      setShowDailyCheckin(true);
      if (pendingCheckinSlot) setPendingCheckinSlot(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [
    anchorTodayStr, isFocusMode, !!editingTask, sessionCompletePending, isAddTaskDialogOpen,
    showDailyCheckin, rescueActive, pendingCheckinSlot, config.anchorsSnoozeUntil,
    visibilityTick,
    config.dailyCommitmentDate, config.dailyCommitmentSkippedDate, config.dailyCommitmentSnoozeUntil, config.dailyCommitmentTaskIds,
    config.dailyMiddayCheckDate, config.dailyMiddayCheckSnoozeUntil, config.dailyReflectionDate, config.dailyReflectionSnoozeUntil, config.dailyCheckinsEnabled,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Daily Coach Check-in handlers ──────────────────────────────────────────
  const closeDailyCheckin = () => {
    setDailyCheckinSlot(null);
    setShowDailyCheckin(false);
  };

  // Day Close (end-of-day reflection)
  const finishReflection = () => {
    saveConfigPatch((latestConfig) => buildReflectionSave(latestConfig, { mood: reflectionMood, note: reflectionNote }, anchorTodayStr));
    closeDailyCheckin();
  };

  const handleReflectionSnooze = () => {
    saveConfigPatch((latestConfig) => buildReflectionSnooze(latestConfig));
    closeDailyCheckin();
  };

  const handleReflectionBreakdown = (task) => {
    finishReflection();
    handleBreakdown(task);
  };

  const handleReflectionCleanSlate = () => {
    finishReflection();
    onOpenMindBox?.();
  };

  const handleReflectionTalkToCoach = () => {
    finishReflection();
    onOpenCoach?.();
  };

  // The proactive nudge no longer appears here. J3: "It never appears
  // unprompted on Today. The same logic renders as the first line of the Coach
  // transcript when Coach is opened." A card that interrupts the execution
  // screen on its own is the class Addendum B removes. CoachTab now derives it
  // itself rather than waiting to be handed one, so nothing is lost by the card
  // going away.

  const handleStartEdit = (task) => setEditingTask(task);

  const handleBreakdown = async (task) => {
    setBreakdownErrorUuid(null);
    setBreakdownNoKeyUuid(null);
    if (!hasAIKey()) {
      setBreakdownNoKeyUuid(task.uuid);
      return;
    }
    setBreakdownLoadingUuid(task.uuid);
    const { groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
    try {
      const raw = await callAI({
        groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey,
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
    const updatedTasks = tasks.map(t => {
      if (t.uuid !== task.uuid) return t;
      const newSubSteps = (t.subSteps || []).map(s => s.id === stepId ? { ...s, done: !s.done } : s);
      return { ...t, subSteps: newSubSteps, lastUpdated: Date.now() };
    });
    savePayload({ ...payload, tasks: updatedTasks });
  };

  // Only the pending step's identity is stored in confirmation state — never
  // an onConfirm closure capturing `tasks`/`payload` from the moment the "×"
  // was tapped. If another tab/device syncs a change while the dialog is
  // open, a stale closure could write a stale full payload over the newer
  // one; re-reading `tasks`/`payload` fresh at confirm time (below) avoids
  // that, since this component re-renders on every incoming sync update.
  const handleDeleteSubStep = (task, stepId) => {
    const step = (task.subSteps || []).find(s => s.id === stepId);
    setConfirmDialog({ taskUuid: task.uuid, stepId, stepText: step?.text || null });
  };

  const handleConfirmDeleteSubStep = () => {
    if (!confirmDialog) return;
    const { taskUuid, stepId } = confirmDialog;
    const task = tasks.find(t => t.uuid === taskUuid);
    const stepStillExists = !!task && (task.subSteps || []).some(s => s.id === stepId);
    if (!stepStillExists) {
      setConfirmDialog(null);
      return;
    }
    const updatedTasks = tasks.map(t => {
      if (t.uuid !== taskUuid) return t;
      return { ...t, subSteps: (t.subSteps || []).filter(s => s.id !== stepId), lastUpdated: Date.now() };
    });
    savePayload({ ...payload, tasks: updatedTasks });
    setConfirmDialog(null);
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

  const handleMoveTask = (task, direction) => {
    const list = [...remainingTasks];
    const idx = list.findIndex(t => t.uuid === task.uuid);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    [list[idx], list[swapIdx]] = [list[swapIdx], list[idx]];
    // Re-assign clean sequential orderIndex to all visible tasks — heals any existing drift
    const orderMap = new Map(list.map((t, i) => [t.uuid, i]));
    savePayload({ ...payload, tasks: tasks.map(t =>
      orderMap.has(t.uuid) ? { ...t, orderIndex: orderMap.get(t.uuid), lastUpdated: Date.now() } : t
    )});
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
    savePayload({ ...payload, tasks: tasks.map(t =>
      orderMap.has(getTaskKey(t)) ? { ...t, orderIndex: orderMap.get(getTaskKey(t)), lastUpdated: Date.now() } : t
    )});
  };

  // One bounded subscription for both figures the wall needs from the ledger:
  // the done line's minutes (J2b) and Momentum's days (J4).
  // Thirty days rather than seven: the strip needs only five bars, but the
  // sentence counts a run, and a run longer than the window fetched would be
  // silently truncated. It undercounts at the edge rather than guessing.
  const { raw: ledgerRaw, status: ledgerStatus } = useFocusLedger(uid, 30, windows);

  // "SESSION N" — which session of today this is.
  //
  // Two things it must not do. It must not add one to a session already in
  // the ledger: the bell banks the open session, the live subscription picks
  // it up, and an unconditional +1 would tick the same overlay from N to N+1
  // at 00:00 without a new session having begun. And it must not answer at
  // all from an unreadable ledger — useFocusLedger reports loading, refused
  // and unavailable alike as raw: null, and treating that as "no sessions
  // yet" asserts SESSION 1 to someone who may have done four. Zero here
  // hides the label, which is the honest answer to "I don't know".
  const focusSessionOrdinal = ledgerStatus === "ready"
    ? sessionsOnDay(ledgerRaw, todayStr) + (sessionCompletePending ? 0 : 1)
    : 0;

  const todayTasksAll = tasks.filter((t) => t.horizonLevel === "today" && !t.isDeleted && !t.isParked);
  const pinnedFocusTask = todayTasksAll.find(t => t.isNowFocus && !t.isCompleted && !t.isDeleted) || null;

  // Half height leaves the task and its Start focus in view above the sheet
  // (37b): its top edge sits just under Start focus, kept between 30% and 70%
  // of the space between the header and the tab bar. Full height fills that
  // space. Measured, because the title wraps to as many lines as it needs.
  const sheetOpen = peekOpen && !!pinnedFocusTask;
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
      el.style.setProperty("--sheet-full", `${Math.round(avail - 8)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [sheetOpen]);

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
  // Must-do is the list's one filter (Y4). Low energy changes how a task
  // starts, not which tasks show: "Small starts drop to 5 min" (37b).
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
  const wallGoal = wallKickerFront
    ? { name: wallKickerFront.name, daysLeft: wallDaysLeft, ...frontProgress(tasks, wallKickerFront.id) }
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

  const remainingTasks = todayTasksFiltered.filter((t) => !t.isCompleted && t.uuid !== pinnedFocusTask?.uuid).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const completedTasks = todayTasksFiltered.filter((t) => t.isCompleted);
  // The wall's two figures are claims about the whole day, so they come from
  // todayTasksAll — the Must-Do and Low Energy filters narrow the LIST below,
  // not the day. Reading them off the filtered list let the wall say "0 more
  // today" on a Low Energy day with a full Today list behind it.
  //
  // "N done" is also a claim about TODAY specifically: a completed task keeps
  // the Today horizon until something moves it, so counting them all reported
  // last week's finished work as this morning's progress.
  const wallRemainingCount = todayTasksAll.filter((t) => !t.isCompleted && t.uuid !== pinnedFocusTask?.uuid).length;
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
        .filter(t => !t.isCompleted && t.uuid !== doneCommitment.uuid)
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))[0] || null
    : null;

  const momentum = buildMomentum(ledgerRaw, new Date(), windows);

  // The wall is asking the question itself (J2a), so the legacy first-run
  // panel — brain illustration, six steps, "tap + to add your first task" —
  // must not render beneath it. Two competing creation flows on first launch
  // is the screen this redesign exists to remove.
  const wallIsAsking = !pinnedFocusTask && !doneCommitment;

  const progressRatio = timerMaxSeconds > 0 ? timerSecondsLeft / timerMaxSeconds : 0;
  const strokeDashoffset = 439.8 * (1 - progressRatio);
  const formatTimerMinutes = Math.floor(timerSecondsLeft / 60);
  const formatTimerSeconds = String(timerSecondsLeft % 60).padStart(2, "0");


  const setRescueTaskAsNowFocus = ({ close = false } = {}) => {
    if (close) setRescueActive(false);
    if (!rescueTask) return;
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
    savePayloadAsync({ ...payload, tasks: tasks.map(t => {
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
        ? { ...t, isParked: true, isNowFocus: false, lastUpdated: now }
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
  const wallKeysBlocked = isFocusMode || !!editingTask || isAddTaskDialogOpen || !!confirmDialog
    || rescueActive || showDailyCheckin || sessionCompletePending || !!frontPickerTask;
  useEffect(() => {
    if (wallKeysBlocked) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
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
      if (!pinnedFocusTask) return;
      if (key === "l") {
        setPeekOpen(v => !v);
      } else if (key === " ") {
        e.preventDefault();
        startFocusAndLog(pinnedFocusTask);
      } else if (key === "d") {
        handleToggleComplete(pinnedFocusTask);
      } else if (key === "s" && !config.isLowEnergyMode) {
        setEditingTask(pinnedFocusTask);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      {/* ── Today (turns 37, 41). On a laptop the wall is a 420px column with
           the list beside it once the list is open (41a); on phones and
           tablets the two stack. ── */}
      <div className={`today-layout${peekOpen || !pinnedFocusTask ? " is-list-open" : ""}`}>
      <div className="today-layout-main">
      <TodayWall
        task={pinnedFocusTask}
        goal={wallGoal}
        anchors={anchors.filter(a => a && typeof a.text === "string" && a.text.trim())}
        focusMinutes={Number(pinnedFocusTask?.timeEstimateMinutes) > 0 ? Number(pinnedFocusTask.timeEstimateMinutes) : 25}
        peekOpen={peekOpen}
        onTogglePeek={() => setPeekOpen(v => !v)}
        onAdd={onOpenAddTask}
        remainingCount={wallRemainingCount}
        lowEnergy={!!config.isLowEnergyMode}
        timerLabel={wallLiveTimerLabel}
        onStartFocus={() => pinnedFocusTask && startFocusAndLog(pinnedFocusTask)}
        onMarkDone={() => pinnedFocusTask && handleToggleComplete(pinnedFocusTask)}
        onSplit={() => pinnedFocusTask && setEditingTask(pinnedFocusTask)}
        onStartSmall={() => pinnedFocusTask && startFocusAndLog(pinnedFocusTask, null, { plannedSeconds: LOW_ENERGY_SESSION_SECONDS })}
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
      />

      {/* ── Day Close (end-of-day reflection) ─────────────────────── */}
      {showDailyCheckin && dailyCheckinSlot === "reflection" && (() => {
        const summary = buildEndOfDaySummary(tasks, config, anchorTodayStr);
        const committedIds = config.dailyCommitmentDate === anchorTodayStr ? getValidCommittedTaskIds(tasks, config.dailyCommitmentTaskIds) : [];
        const breakdownTask = committedIds.map(id => todayTasksAll.find(t => t.uuid === id)).find(t => t && !t.isCompleted)
          || todayTasksAll.find(t => !t.isCompleted) || null;
        return (
          <div data-testid="daily-checkin-card" style={dailyCheckinCardStyle}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" aria-label="Dismiss daily check-in" style={dailyCheckinDismissStyle} onClick={handleReflectionSnooze}>✕</button>
            </div>
              <div className="morning-ritual-header">
                <div className="morning-ritual-title">{summary.title}</div>
                <div className="morning-ritual-line">{summary.verdict}</div>
              </div>
              <div className="morning-ritual-nudge">
                {summary.committedTotal > 0 ? `Commitment: ${summary.committedDone} of ${summary.committedTotal} done. ` : ""}
                {`Completed today: ${summary.totalCompletedToday}.`}
                {summary.hasKeyDeadline ? (summary.deadlineMoveDone ? " Key deadline move: done." : " Key deadline move: not yet.") : ""}
              </div>
              <div className="morning-ritual-nudge">How does today feel?</div>
              <div className="anchor-chips morning-ritual-chips">
                {REFLECTION_MOODS.map(m => (
                  <button
                    key={m.key}
                    className={`anchor-chip${reflectionMood === m.key ? " anchor-chip--checked" : ""}`}
                    onClick={() => setReflectionMood(m.key)}
                  >
                    {reflectionMood === m.key ? "✓ " : ""}{m.label}
                  </button>
                ))}
              </div>
              <textarea
                className="daily-checkin-note"
                placeholder="One sentence for tomorrow (optional)"
                value={reflectionNote}
                maxLength={280}
                onChange={e => setReflectionNote(e.target.value)}
              />
              <div className="morning-ritual-actions">
                <button className="morning-ritual-btn-primary" onClick={finishReflection}>Done</button>
                {breakdownTask && (
                  <div className="morning-ritual-actions-row">
                    <button className="morning-ritual-btn-ghost" onClick={() => handleReflectionBreakdown(breakdownTask)}>Break one task down</button>
                  </div>
                )}
                <div className="morning-ritual-actions-row">
                  <button className="morning-ritual-btn-ghost" onClick={handleReflectionCleanSlate}>Clean Slate</button>
                  <button className="morning-ritual-btn-ghost" onClick={handleReflectionTalkToCoach}>Talk to Coach</button>
                </div>
              </div>
          </div>
        );
      })()}

      </div>

      {/* ── After that: the rest of today (41a, 37b, 49c). The peek IS this
           section. Closed is the default — that is the wall. With no
           commitment there is no wall to look at, so the list stays visible
           rather than leaving the screen empty. */}
      <section
        ref={sheetRef}
        className={`tasks-section today-list${pinnedFocusTask ? " is-sheet" : ""}${sheetFull ? " is-full" : ""}`}
        aria-label={`Today's list, ${listAllCount} ${listAllCount === 1 ? "task" : "tasks"}`}
        onKeyDown={(e) => { if (e.key === "Escape" && pinnedFocusTask) { e.stopPropagation(); closeSheet(); } }}
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
              <button type="button" className="today-sheet-now-start" onClick={() => startFocusAndLog(pinnedFocusTask)}>
                Start
              </button>
            </div>
          </>
        )}
        <div className="today-list-head">
          <h2 className="today-list-title">After that</h2>
          <span className="today-list-count">{listAllCount} · {listDoneCount} done</span>
          <span className="today-list-head-end">
            {onOpenDayMap && (
              <button type="button" className="today-list-link" onClick={onOpenDayMap}>Day map →</button>
            )}
            {onOpenAddTask && (
              <button type="button" className="today-list-add" onClick={onOpenAddTask}>
                + Add <kbd className="wall-key" aria-hidden="true">N</kbd>
              </button>
            )}
            {pinnedFocusTask && (
              <button type="button" className="today-list-hide" onClick={() => setPeekOpen(false)}>
                Hide list <kbd className="wall-key" aria-hidden="true">L</kbd>
              </button>
            )}
          </span>
        </div>

        <div className="today-list-tools">
          {/* Must-do is a filter on the list (Y4); Low energy is not. */}
          <div className="today-seg" role="group" aria-label="Show">
            <button type="button" className="today-seg-opt" aria-pressed={!isMVDMode} onClick={() => setIsMVDMode(false)}>
              All · {listAllCount}
            </button>
            <button type="button" className="today-seg-opt" aria-pressed={isMVDMode} onClick={() => setIsMVDMode(true)}>
              Must-do · {listMustCount}
            </button>
          </div>
          <label className="today-energy">
            <span className="today-energy-text">
              <span className="today-energy-label">Low energy</span>
              <span className="today-energy-caption">Small starts drop to 5 min</span>
            </span>
            <button
              type="button"
              role="switch"
              className="today-energy-switch"
              aria-checked={!!config.isLowEnergyMode}
              aria-label="Low energy"
              onClick={() => saveConfigPatch({ isLowEnergyMode: !config.isLowEnergyMode })}
            />
          </label>
        </div>

        <div className="tasks-list" data-testid="today-tasks-list">
          {/* The wall's one thing heads the open list, marked NOW, so its row
              menu can unpin it — the wall itself has no unpin. Not counted
              in "After that", and not draggable. */}
          {pinnedFocusTask && (
            <TaskRow
              task={pinnedFocusTask}
              onToggleComplete={handleToggleComplete}
              onPin={handleUnpinWallTask}
              onDelete={handleDeleteTask}
              onEdit={handleStartEdit}
              onMoveToHorizon={handleMoveWithUndo}
              onSwipeDone={handleToggleComplete}
              onSwipeWeek={t => handleMoveWithUndo(t, "week")}
              onPutOnFront={setFrontPickerTask}
              onPark={handleParkTask}
              onBreakdown={handleBreakdown}
              onSubStepToggle={handleSubStepToggle}
              onDeleteSubStep={handleDeleteSubStep}
              isBreakingDown={breakdownLoadingUuid === pinnedFocusTask.uuid}
              breakdownError={breakdownErrorUuid === pinnedFocusTask.uuid}
              breakdownNoKey={breakdownNoKeyUuid === pinnedFocusTask.uuid}
              onToggleMVD={handleToggleMVD}
              isGoal={!!wallKickerFront && pinnedFocusTask.frontId === wallKickerFront.id}
            />
          )}
          {!wallIsAsking && todayTasksAll.length === 0 && (
            <p className="today-list-empty">Nothing else on Today.</p>
          )}
          {todayTasksAll.length > 0 && todayTasksFiltered.length === 0 && isMVDMode && (
            <p className="today-list-empty">No must-dos yet. Tap a task and choose “Mark as must-do”.</p>
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
                      <SortableTaskItem key={getTaskKey(task)} id={getTaskKey(task)} interactionStyle={taskRowInteractionStyle}>
                        {({ dragHandleListeners, dragHandleAttributes, dragActivatorRef }) => (
                          <TaskRow
                            task={task}
                            onToggleComplete={handleToggleComplete}
                            onPin={handlePinTask}
                            onDelete={handleDeleteTask}
                            onEdit={handleStartEdit}
                            onMoveUp={idx > 0 ? t => handleMoveTask(t, "up") : undefined}
                            onMoveDown={idx < remainingTasks.length - 1 ? t => handleMoveTask(t, "down") : undefined}
                            onMoveToHorizon={handleMoveWithUndo}
                            onSwipeDone={handleToggleComplete}
                            onSwipeWeek={t => handleMoveWithUndo(t, "week")}
                            onPutOnFront={setFrontPickerTask}
                            onPark={handleParkTask}
                            onBreakdown={handleBreakdown}
                            onSubStepToggle={handleSubStepToggle}
                            onDeleteSubStep={handleDeleteSubStep}
                            isBreakingDown={breakdownLoadingUuid === task.uuid}
                            breakdownError={breakdownErrorUuid === task.uuid}
                            breakdownNoKey={breakdownNoKeyUuid === task.uuid}
                            onToggleMVD={handleToggleMVD}
                            dragHandleListeners={dragHandleListeners}
                            dragHandleAttributes={dragHandleAttributes}
                            dragActivatorRef={dragActivatorRef}
                            interactionStyle={taskRowInteractionStyle}
                            isGoal={!!wallKickerFront && task.frontId === wallKickerFront.id}
                          />
                        )}
                      </SortableTaskItem>
                  ))}
                </SortableContext>
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
              {completedTasks.length > 0 && (
                <>
                  <div className="completed-section-title">Completed</div>
                  {completedTasks.map(task => (
                    <TaskRow key={task.uuid} task={task} onToggleComplete={handleToggleComplete} onDelete={handleDeleteTask} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </section>
      </div>

      {/* ── Momentum (J4). Below the ledger, never beside the hero. Hidden
           entirely by the Settings switch, and absent on its own with no
           history — an empty frame is a scoreboard of what you haven't done. ── */}
      {config.momentumEnabled !== false && momentum && (
        <Momentum bars={momentum.bars} sentence={momentum.sentence} />
      )}

      {/* ── Full-Screen Focus Mode Overlay */}
      {isFocusMode && activeTask && (
        <FocusModePage
          task={activeTask}
          secondsLeft={timerSecondsLeft}
          maxSeconds={timerMaxSeconds}
          isRunning={isTimerRunning}
          onPlayPause={() => setIsTimerRunning(r => !r)}
          onReset={() => { setIsTimerRunning(false); setTimerSecondsLeft(timerMaxSeconds); }}
          onDone={() => { handleToggleComplete(activeTask); setIsFocusMode(false); }}
          onExit={() => setIsFocusMode(false)}
          onChangeDuration={handleChangeFocusDuration}
          onKeepGoing={extendTimer}
          onStopHere={handleStopHere}
          startedAt={focusStartedAt}
          elapsedSeconds={focusElapsedSeconds}
          sessionNumber={focusSessionOrdinal}
          onAddBrainDump={handleFocusBrainDump}
          onRescue={openRescueMode}
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
      )}

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
              onKeyDown={e => { if (e.key === "Escape") setFrontPickerTask(null); }}
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

      {/* ── Undo (done, delete, unpin, move, front) */}
      <UndoAnnouncer message={undoText} />
      {undo && (
        <UndoToast
          key={undo.at}
          message={undoText}
          onUndo={handleUndo}
          onClose={() => setUndo(null)}
        />
      )}

      {editingTask && (
        <AddTaskDialog
          email={payload.config?.userId || ""}
          payload={payload}
          savePayload={savePayload}
          savePayloadAsync={savePayloadAsync}
          defaultHorizon="today"
          editTask={editingTask}
          onClose={() => setEditingTask(null)}
          uid={uid}
          writeActivityEvents={writeActivityEvents}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.stepText ? `Remove this step?\n\n"${confirmDialog.stepText}"` : "Remove this step?"}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          danger
          onConfirm={handleConfirmDeleteSubStep}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Rescue Mode — triggered by the Rescue chip or Deep Focus's Stuck? button */}
      {rescueActive && (
        <RescueMode
          task={rescueTask}
          allTasks={tasks}
          firstName={(config.userName || "").split(" ")[0] || "friend"}
          config={config}
          entryPoint={rescueEntryPoint}
          includeMemory={!(isSyncingFromCache || syncWarning === "offline")}
          isSyncingFromCache={isSyncingFromCache}
          syncWarning={syncWarning}
          onDismiss={() => setRescueActive(false)}
          onHandoffSummary={(summary) => saveConfigPatch?.({ rescueHandoffSummary: summary })}
          onSetNowFocus={() => setRescueTaskAsNowFocus()}
          onParkTask={parkRescueTask}
          onAccept={() => setRescueTaskAsNowFocus({ close: true })}
        />
      )}
    </>
  );
}
