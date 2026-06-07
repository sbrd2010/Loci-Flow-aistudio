import React, { useState, useEffect, useRef } from "react";
import TaskRow from "./TaskRow";
import ConfirmDialog from "./ConfirmDialog";
import AddTaskDialog from "./AddTaskDialog";
import FocusModePage from "./FocusModePage";
import { safeUUID } from "../utils/uuid";
import { requestNotifPermission, notifyFocusComplete } from "../utils/focusNotifications";
import { getAIKeys, callAI } from "../utils/aiCall";
import { celebrate } from "../utils/celebrations";
import { track } from "../firebase";
import { scheduleReminder, cancelReminder, formatReminderLabel } from "../utils/reminders";
import { getCurrentFocusQuote } from "../utils/focusQuotes";
import { formatCountdown, formatTodayCountdown, isDailyDone } from "../utils/deadlineCountdown";
import "../styles/focusNow.css";
import {
  DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, DragOverlay
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableTaskItem({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
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
      {children({ dragHandleListeners: listeners, dragHandleAttributes: attributes })}
    </div>
  );
}

export default function TodayTab({ payload, savePayload, onOpenDayMap, autoOpenFocus = false, onAutoOpenFocusDone }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  const [confirmDialog, setConfirmDialog] = useState(null);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showRescue, setShowRescue] = useState(false);
  const [rescueStep, setRescueStep] = useState(0);
  const [isMVDMode, setIsMVDMode] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [focusNowMode, setFocusNowMode] = useState(false);
  const [focusNowTaskId, setFocusNowTaskId] = useState(null);
  const [showFocusNowPicker, setShowFocusNowPicker] = useState(false);
  const [showTodayHoursPicker, setShowTodayHoursPicker] = useState(false);
  const [showCustomHoursInput, setShowCustomHoursInput] = useState(false);
  const [customHoursValue, setCustomHoursValue] = useState("");

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const rescueSteps = [
    "Take one deep breath. Breathe in for 4, hold for 4, out for 4.",
    "What is the laughably smallest first step? A single sentence counts.",
    "Close all tabs that aren't this task right now.",
    "Commit to just 2 minutes. You can stop after that.",
  ];

  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [timerMaxSeconds, setTimerMaxSeconds] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const timerIntervalRef = useRef(null);
  // Absolute deadline for the running timer — lets us snap to correct time on tab-show
  const deadlineRef = useRef(null);

  const activeTask = tasks.find((t) => t.isNowFocus && !t.isDeleted && !t.isCompleted);

  useEffect(() => {
    if (activeTask) {
      const rawMins = Number(activeTask.timeEstimateMinutes);
      const taskSecs = (rawMins > 0 ? rawMins : 25) * 60;
      setTimerMaxSeconds(taskSecs);
      if (!isTimerRunning) setTimerSecondsLeft(taskSecs);
    } else {
      const rawMins = Number(config.pomodoroDurationMinutes);
      const defaultSecs = (rawMins > 0 ? rawMins : 25) * 60;
      setTimerMaxSeconds(defaultSecs);
      if (!isTimerRunning) setTimerSecondsLeft(defaultSecs);
    }
  }, [activeTask?.uuid, activeTask?.timeEstimateMinutes, config.pomodoroDurationMinutes]);

  useEffect(() => {
    if (isTimerRunning) {
      // Anchor to wall-clock time so background tabs / GC pauses don't cause drift
      const targetEndTime = Date.now() + timerSecondsLeft * 1000;
      deadlineRef.current = targetEndTime;
      timerIntervalRef.current = setInterval(() => {
        const remaining = Math.ceil((targetEndTime - Date.now()) / 1000);
        setTimerSecondsLeft(remaining <= 0 ? 0 : remaining);
      }, 1000);
      // Snap to correct remaining time the moment the tab becomes visible again —
      // background timers are throttled so the display may be stale after switching back.
      const handleVisible = () => {
        if (document.visibilityState === "visible") {
          const remaining = Math.ceil((targetEndTime - Date.now()) / 1000);
          setTimerSecondsLeft(remaining <= 0 ? 0 : remaining);
        }
      };
      document.addEventListener("visibilitychange", handleVisible);
      return () => {
        clearInterval(timerIntervalRef.current);
        document.removeEventListener("visibilitychange", handleVisible);
        deadlineRef.current = null;
      };
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      deadlineRef.current = null;
    }
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [isTimerRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop timer automatically if the focused task is deleted or completed mid-session
  useEffect(() => {
    if (isTimerRunning && !activeTask) setIsTimerRunning(false);
  }, [activeTask, isTimerRunning]);

  // Auto-exit focus mode when activeTask is removed externally
  useEffect(() => {
    if (!activeTask) setIsFocusMode(false);
  }, [activeTask]);

  // Open focus mode immediately when arriving from Day Map Start Focus
  useEffect(() => {
    if (autoOpenFocus && activeTask) {
      setIsFocusMode(true);
      onAutoOpenFocusDone?.();
    }
  }, [autoOpenFocus, activeTask?.uuid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isTimerRunning && timerSecondsLeft === 0) {
      setIsTimerRunning(false);
      handlePomodoroCompletion();
      notifyFocusComplete(activeTask?.title);
    }
  }, [timerSecondsLeft, isTimerRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab title: countdown while running, paused label in overlay, restore on exit
  useEffect(() => {
    const taskLabel = activeTask?.title || "Deep Focus";
    const mins = Math.floor(timerSecondsLeft / 60);
    const secs = String(timerSecondsLeft % 60).padStart(2, "0");
    if (isTimerRunning && timerSecondsLeft > 0) {
      document.title = `${mins}:${secs} · ${taskLabel}`;
    } else if (isFocusMode && !isTimerRunning && timerSecondsLeft > 0) {
      document.title = `Paused · ${mins}:${secs} · Loci`;
    } else {
      document.title = "Loci";
    }
  }, [timerSecondsLeft, isTimerRunning, isFocusMode, activeTask?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore title on unmount (e.g. user navigates away while timer is running)
  useEffect(() => () => { document.title = "Loci"; }, []);

  // Expose timer state on window so the Document PiP mini-window can poll it
  useEffect(() => {
    window.__lociTimer = {
      secondsLeft: timerSecondsLeft,
      isRunning: isTimerRunning,
      taskTitle: activeTask?.title || "Deep Focus",
    };
  }, [timerSecondsLeft, isTimerRunning, activeTask?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { window.__lociTimer = null; }, []);

  // Request notification permission when focus overlay opens (already a user interaction)
  useEffect(() => {
    if (isFocusMode) requestNotifPermission();
  }, [isFocusMode]);

  // Auto-exit Focus Now if the selected task is deleted externally
  useEffect(() => {
    if (focusNowMode && focusNowTaskId && !tasks.find(t => t.uuid === focusNowTaskId && !t.isDeleted)) {
      setFocusNowMode(false);
      setFocusNowTaskId(null);
    }
  }, [tasks, focusNowMode, focusNowTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentQuote = getCurrentFocusQuote();

  const [deadlineCountdown, setDeadlineCountdown] = useState(null);
  useEffect(() => {
    if (!config.deadlineDate) { setDeadlineCountdown(null); return; }
    const tick = () => {
      const target = new Date(config.deadlineDate + "T23:59:59");
      setDeadlineCountdown(formatCountdown(target - Date.now()));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [config.deadlineDate]);

  const [todayCountdown, setTodayCountdown] = useState(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
      setTodayCountdown(formatTodayCountdown(midnight - now));
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  const _tsd = new Date();
  const todayStr = `${_tsd.getFullYear()}-${String(_tsd.getMonth() + 1).padStart(2, "0")}-${String(_tsd.getDate()).padStart(2, "0")}`;
  const isDoneToday = isDailyDone(config.deadlineDailyDoneDate, todayStr);
  const handleDeadlineDoneToday = () => {
    savePayload({ ...payload, config: { ...config, deadlineDailyDoneDate: todayStr, lastUpdated: Date.now() } });
  };

  const handleDeadlineReopenToday = () => {
    savePayload({ ...payload, config: { ...config, deadlineDailyDoneDate: null, lastUpdated: Date.now() } });
  };

  const handleDeadlineTodayHours = (hours) => {
    savePayload({ ...payload, config: { ...config, deadlineTodayHours: hours, deadlineTodayDate: todayStr, lastUpdated: Date.now() } });
    setShowTodayHoursPicker(false);
    setShowCustomHoursInput(false);
    setCustomHoursValue("");
  };

  const isTodayDate = (dateStr) => dateStr === todayStr;

  const todayAvailableDisplay = (() => {
    if (!isTodayDate(config.deadlineTodayDate)) return null;
    const ms = (config.deadlineTodayHours || 0) * 3600 * 1000;
    return formatTodayCountdown(ms);
  })();

  const [timelineProgress, setTimelineProgress] = useState(0.5);
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [currentDateStr, setCurrentDateStr] = useState("");

  const formatHourLabel = (h) => {
    const h24 = h % 24;
    const isAM = h24 < 12 || h24 === 0;
    const displayH = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
    return `${displayH}${isAM ? "am" : "pm"}`;
  };

  const updateTimeline = () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    const amPmStr = hour >= 12 ? "PM" : "AM";
    setCurrentTimeStr(`${displayHour}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")} ${amPmStr}`);
    setCurrentDateStr(now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
    const startHour = config.dayStartHour ?? 7;
    const endHour = config.dayEndHour ?? 26;
    const currentHourFloat = hour + minute / 60;
    const adjustedHour = hour < startHour ? currentHourFloat + 24 : currentHourFloat;
    setTimelineProgress(Math.max(0, Math.min(1, (adjustedHour - startHour) / (endHour - startHour))));
  };

  useEffect(() => {
    updateTimeline();
    const interval = setInterval(updateTimeline, 1000);
    return () => clearInterval(interval);
  }, [config.dayStartHour, config.dayEndHour]);

  useEffect(() => {
    const container = document.querySelector('.screen-content');
    if (!container) return;
    const onScroll = () => setIsScrolled(container.scrollTop > 15);
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const [breakdownLoadingUuid, setBreakdownLoadingUuid] = useState(null);

  const [editingTask, setEditingTask] = useState(null);
  const [undoTask, setUndoTask] = useState(null);
  const undoTimeoutRef = useRef(null);

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

  const handleToggleComplete = (task) => {
    const todayDateStr = getTodayDateString();
    const isCompleted = !task.isCompleted;
    if (isCompleted && task.reminderAt) cancelReminder(task.uuid);
    const updatedTasks = tasks.map((t) =>
      t.uuid === task.uuid ? { ...t, isCompleted, isNowFocus: false, dateCompletedString: isCompleted ? todayDateStr : null, lastUpdated: Date.now() } : t
    );
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
    savePayload({ ...payload, tasks: updatedTasks, config: { ...config, totalXp: nextXp, lastUpdated: Date.now() }, contributions: nextContributions });
  };

  const handlePinTask = (task) => {
    const now = Date.now();
    const isPinning = !task.isNowFocus;
    savePayload({ ...payload, tasks: tasks.map((t) => {
      const newFocus = isPinning && t.uuid === task.uuid;
      if (t.isNowFocus === newFocus) return t;
      return { ...t, isNowFocus: newFocus, lastUpdated: now };
    })});
    if (isPinning) setIsFocusMode(true);
  };

  const handleFocusBrainDump = (text) => {
    if (!text.trim()) return;
    const newItem = { id: `bd_${Date.now()}`, text: text.trim(), createdAt: Date.now() };
    savePayload({ ...payload, brainDump: [...(payload.brainDump || []), newItem] });
  };

  const handleChangeFocusDuration = (minutes) => {
    setIsTimerRunning(false);
    const secs = minutes * 60;
    setTimerSecondsLeft(secs);
    setTimerMaxSeconds(secs);
  };

  const handleToggleMVD = (task) => {
    savePayload({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? { ...t, isMVD: !t.isMVD, lastUpdated: Date.now() } : t) });
  };

  const handleDeleteTask = (task) => {
    savePayload({ ...payload, tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t) });
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoTask(task);
    undoTimeoutRef.current = setTimeout(() => setUndoTask(null), 5000);
  };

  const handleUndoDelete = () => {
    if (!undoTask) return;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    savePayload({ ...payload, tasks: tasks.map((t) => t.uuid === undoTask.uuid ? { ...t, isDeleted: false, lastUpdated: Date.now() } : t) });
    setUndoTask(null);
  };

  const handlePomodoroCompletion = () => {
    if (activeTask) {
      const todayDateStr = getTodayDateString();
      const task = activeTask;
      setConfirmDialog({
        message: `⏱️ Focus block complete!\n\nDid you fully finish:\n"${task.title}"?`,
        confirmLabel: "Done! +120 XP",
        cancelLabel: "+50 XP, keep going",
        onConfirm: () => {
          celebrate();
          savePayload({
            ...payload,
            tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isCompleted: true, isNowFocus: false, dateCompletedString: todayDateStr, lastUpdated: Date.now() } : t),
            config: { ...config, totalXp: (Number(config.totalXp) || 0) + 120, lastUpdated: Date.now() },
            contributions: incrementContribution([...contributions], todayDateStr)
          });
          setConfirmDialog(null);
        },
        onCancel: () => {
          savePayload({ ...payload, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() } });
          setConfirmDialog(null);
        }
      });
    } else {
      savePayload({ ...payload, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() } });
    }
  };

  const handleEnergyToggle = () => {
    savePayload({ ...payload, config: { ...config, isLowEnergyMode: !config.isLowEnergyMode, lastUpdated: Date.now() } });
  };

  const handleStartEdit = (task) => setEditingTask(task);

  const handleBreakdown = async (task) => {
    setBreakdownLoadingUuid(task.uuid);
    const { groqKey, geminiKey } = getAIKeys();
    try {
      const raw = await callAI({
        groqKey, geminiKey,
        systemPrompt: "You are a productivity coach. Respond ONLY with a valid JSON array of strings, no markdown, no explanation.",
        messages: [{
          role: "user",
          content: `Break this task into 3–5 tiny, concrete micro-steps that each take under 5 minutes and feel easy to start.\n\nTask: "${task.title}"\nConcrete step: "${task.concreteStep || ""}"\nTime estimate: ${task.timeEstimateMinutes || 25} minutes\n\nReturn ONLY a JSON array of short strings (each under 12 words). Example: ["Open the document", "Write one sentence", "Save the file"]`
        }],
        maxTokens: 200
      });
      const cleaned = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
      const steps = JSON.parse(cleaned);
      if (!Array.isArray(steps) || steps.length === 0) throw new Error("bad response");
      const subSteps = steps.slice(0, 5).map(text => ({ id: safeUUID(), text: String(text).trim(), done: false }));
      savePayload({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? { ...t, subSteps, lastUpdated: Date.now() } : t) });
    } catch (_) {
      // silently fail — user can retry via menu
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

  const handleDeleteSubStep = (task, stepId) => {
    const updatedTasks = tasks.map(t => {
      if (t.uuid !== task.uuid) return t;
      return { ...t, subSteps: (t.subSteps || []).filter(s => s.id !== stepId), lastUpdated: Date.now() };
    });
    savePayload({ ...payload, tasks: updatedTasks });
  };

  const handleMoveToHorizon = (task, horizon) => {
    const count = tasks.filter(t => t.horizonLevel === horizon && !t.isDeleted).length;
    savePayload({ ...payload, tasks: tasks.map(t =>
      t.uuid === task.uuid ? { ...t, horizonLevel: horizon, isNowFocus: false, orderIndex: count, lastUpdated: Date.now() } : t
    )});
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

  const todayTasksAll = tasks.filter((t) => t.horizonLevel === "today" && !t.isDeleted && !t.isParked);
  const _d = new Date();
  const _todayStr = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const _dayMapActive = todayTasksAll.filter(t => !t.isCompleted);
  const dayMapTotal = _dayMapActive.length;
  const dayMapPlaced = _dayMapActive.filter(t => t.dayMapDate === _todayStr && t.dayMapPeriod).length;
  const todayTasksFiltered = isMVDMode
    ? todayTasksAll.filter(t => t.isMVD)
    : config.isLowEnergyMode
      ? todayTasksAll.filter(t => t.priority === "P4")
      : todayTasksAll;
  const remainingTasks = todayTasksFiltered.filter((t) => !t.isCompleted).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const completedTasks = todayTasksFiltered.filter((t) => t.isCompleted);

  // Focus Now: first incomplete task in Day Map order for today (shown as "Recommended")
  const dayMapNextTask = todayTasksAll
    .filter(t => !t.isCompleted && t.dayMapDate === _todayStr && t.dayMapOrder != null)
    .sort((a, b) => (a.dayMapOrder ?? 999) - (b.dayMapOrder ?? 999))[0] || null;

  // All incomplete today tasks for the picker (unfiltered by mode chips)
  const focusNowPickerTasks = todayTasksAll
    .filter(t => !t.isCompleted)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  // The currently selected Focus Now task (null if deleted mid-session)
  const focusNowTask = (focusNowMode && focusNowTaskId)
    ? tasks.find(t => t.uuid === focusNowTaskId && !t.isDeleted)
    : null;

  const progressRatio = timerMaxSeconds > 0 ? timerSecondsLeft / timerMaxSeconds : 0;
  const strokeDashoffset = 439.8 * (1 - progressRatio);
  const formatTimerMinutes = Math.floor(timerSecondsLeft / 60);
  const formatTimerSeconds = String(timerSecondsLeft % 60).padStart(2, "0");

  return (
    <>
      {/* ── Day header: style switchable via Settings → Header Style ── */}
      {(() => {
        const startHour = config.dayStartHour ?? 7;
        const endHour = config.dayEndHour ?? 26;
        const daySpan = endHour - startHour;
        const labelCount = daySpan > 10 ? 5 : 3;
        const timeLabels = Array.from({ length: labelCount }, (_, i) =>
          formatHourLabel(startHour + Math.round((daySpan / (labelCount - 1)) * i))
        );
        const nowHour = new Date().getHours();
        const greeting = nowHour < 12 ? "Good morning" : nowHour < 17 ? "Good afternoon" : "Good evening";
        const firstName = (config.userName || "").split(" ")[0];
        const headerStyle = config.headerStyle || "full";

        // Option E: Auto-hide — wraps the full card, collapses on scroll
        if (headerStyle === "autohide") {
          const fullCard = (
            <section className="today-time-card" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
              {firstName ? (
                <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "8px", letterSpacing: "-0.01em" }}>
                  {greeting}, <span style={{ color: "var(--accent)" }}>{firstName}</span> 👋
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
                <div style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-mono)", lineHeight: 1 }}>{currentTimeStr}</div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>{currentDateStr}</div>
              </div>
              <p style={{ margin: 0, fontSize: "13px", fontStyle: "italic", color: "var(--accent)", lineHeight: 1.45, fontWeight: "600" }}>
                "{currentQuote.quote}" <span style={{ fontStyle: "normal", fontWeight: "400", color: "var(--text-muted)", fontSize: "11px" }}>— {currentQuote.author}</span>
              </p>
            </section>
          );
          return (
            <div className={`header-autohide-wrapper${isScrolled ? " header-collapsed" : ""}`}>
              {fullCard}
            </div>
          );
        }

        // Option C: Compact strip — tap ▾ to reveal full details
        if (headerStyle === "compact") {
          return (
            <section className="today-time-card" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 14px" }}>
              <div onClick={() => setHeaderExpanded(e => !e)} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
                <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-mono)", letterSpacing: "-0.02em", flexShrink: 0, flex: 1 }}>
                  {currentTimeStr}
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600", flexShrink: 0 }}>{currentDateStr}</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", flexShrink: 0 }}>{headerExpanded ? "▴" : "▾"}</span>
              </div>
              {headerExpanded && (
                <div style={{ marginTop: "10px" }}>
                  {firstName && (
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "8px" }}>
                      {greeting}, <span style={{ color: "var(--accent)" }}>{firstName}</span> 👋
                    </div>
                  )}
                  <p style={{ margin: 0, fontSize: "13px", fontStyle: "italic", color: "var(--accent)", lineHeight: 1.45, fontWeight: "600" }}>
                    "{currentQuote.quote}" <span style={{ fontStyle: "normal", fontWeight: "400", color: "var(--text-muted)", fontSize: "11px" }}>— {currentQuote.author}</span>
                  </p>
                </div>
              )}
            </section>
          );
        }

        // Option D: Frameless bar — no card border/padding, all info on two rows
        if (headerStyle === "frameless") {
          return (
            <div className="today-time-card" style={{ padding: "4px 2px 8px 2px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
                {firstName ? (
                  <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
                    {greeting}, <span style={{ color: "var(--accent)" }}>{firstName}</span> 👋
                  </span>
                ) : (
                  <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{currentTimeStr}</span>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                  {firstName && <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{currentTimeStr}</span>}
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>{currentDateStr}</span>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: "13px", fontStyle: "italic", color: "var(--accent)", lineHeight: 1.4, fontWeight: "600" }}>
                "{currentQuote.quote}" <span style={{ fontStyle: "normal", fontWeight: "400", color: "var(--text-muted)", fontSize: "11px" }}>— {currentQuote.author}</span>
              </p>
            </div>
          );
        }

        // Default ("full"): original 4-row card
        return (
          <section className="today-time-card" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
            {firstName ? (
              <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "8px", letterSpacing: "-0.01em" }}>
                {greeting}, <span style={{ color: "var(--accent)" }}>{firstName}</span> 👋
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
              <div style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {currentTimeStr}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>
                {currentDateStr}
              </div>
            </div>
            <p className="today-quote-secondary" style={{ margin: 0, fontSize: "13px", fontStyle: "italic", color: "var(--accent)", lineHeight: 1.45, fontWeight: "600" }}>
              "{currentQuote.quote}" <span style={{ fontStyle: "normal", fontWeight: "400", color: "var(--text-muted)", fontSize: "11px" }}>— {currentQuote.author}</span>
            </p>
          </section>
        );
      })()}

      {/* ── Key Deadline countdown strip */}
      {config.deadlineDate && (() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const target = new Date(config.deadlineDate + "T00:00:00");
        const days = Math.round((target - today) / 86400000);
        const label = (config.deadlineLabel || "Deadline").trim();
        const isExpired = days < 0;

        const isCritical = !isExpired && days <= 14;
        const isWarning  = !isExpired && days > 14 && days <= 30;
        const color = isExpired ? "var(--text-muted)"
          : isCritical ? "var(--danger)"
          : isWarning  ? "var(--warning)"
          : "var(--accent)";
        const bg = isExpired ? "rgba(255,255,255,0.04)"
          : isCritical ? "rgba(248,113,113,0.12)"
          : isWarning  ? "rgba(251,191,36,0.10)"
          : "var(--accent-light)";
        const icon = isExpired ? "✅"
          : days === 0 ? "🔴"
          : isCritical ? "⚡"
          : isWarning  ? "⏳"
          : "🎯";

        // Strip day prefix so TIME LEFT shows only intra-day precision (e.g. "03h 33m 46s")
        const intraCountdown = deadlineCountdown ? deadlineCountdown.replace(/^\d+d /, "") : null;

        // Shrinking bar: remaining / total window; falls back to days/365 if no start date
        let barPct = 50;
        if (!isExpired) {
          if (config.deadlineStartDate) {
            const start = new Date(config.deadlineStartDate + "T00:00:00");
            const total = target - start;
            const remaining = target - today;
            barPct = total > 0 ? Math.min(100, Math.max(2, (remaining / total) * 100)) : 50;
          } else {
            barPct = Math.min(98, Math.max(2, (days / 365) * 100));
          }
        } else {
          barPct = 2;
        }

        // ── Detailed card (7-row, full information) ──────────────────────────
        if (config.deadlineCardStyle === "detailed") {
          return (
            <div
              className="today-deadline-card"
              data-testid="deadline-card"
              style={{
                background: bg,
                border: `1px solid ${color}`,
                borderRadius: "var(--radius-sm)",
                padding: "10px 14px",
                display: "flex",
                flexDirection: "column",
                gap: "7px",
                animation: isCritical ? "deadline-pulse 2.5s ease-in-out infinite" : "none",
              }}
            >
              {/* Row 1: icon · eyebrow label · day count */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px", flexShrink: 0, lineHeight: 1 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "9px", fontWeight: "900", letterSpacing: "0.1em", textTransform: "uppercase", color, lineHeight: 1 }}>
                    KEY DEADLINE
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                    {label}
                  </div>
                </div>
                <span style={{ fontSize: "24px", fontWeight: "900", color, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", lineHeight: 1, flexShrink: 0 }}>
                  {isExpired ? "—" : days === 0 ? "TODAY" : `${days}d`}
                </span>
              </div>

              {/* Row 2: live ticking countdown OR expired notice */}
              {isExpired ? (
                <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted)" }}>
                  Deadline reached
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                  <span style={{ fontSize: "9px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", flexShrink: 0 }}>
                    Time left
                  </span>
                  <span className="deadline-countdown" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "14px", fontWeight: "700", color, letterSpacing: "0.02em" }}>
                    {intraCountdown || "--h --m --s"}
                  </span>
                </div>
              )}

              {/* Today checkpoint — only for active deadlines */}
              {!isExpired && (
                <>
                  <div style={{ height: "1px", background: "rgba(255,255,255,0.08)" }} />

                  {/* Today closes in */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <span style={{ fontSize: "9px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", flexShrink: 0 }}>
                      Today closes in
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "14px", fontWeight: "700", color: "var(--text-primary)", letterSpacing: "0.02em" }}>
                      {todayCountdown || "--h --m"}
                    </span>
                  </div>

                  {/* TODAY'S MOVE */}
                  {config.deadlineAction && (
                    <div style={{ fontSize: "11px", lineHeight: 1.4 }}>
                      <span style={{ fontWeight: "900", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "9px" }}>{"Today's Move: "}</span>
                      <span style={{ fontWeight: "700", color: "var(--text-primary)" }}>{config.deadlineAction}</span>
                    </div>
                  )}

                  {/* Done state or button */}
                  {isDoneToday ? (
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)" }}>
                      TODAY'S MOVE DONE ✓
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid="deadline-done-btn"
                      onClick={handleDeadlineDoneToday}
                      style={{ fontSize: "11px", fontWeight: "700", padding: "4px 10px", borderRadius: "20px", background: "transparent", border: `1px solid ${color}`, color, cursor: "pointer", lineHeight: 1.4, minHeight: "28px", whiteSpace: "nowrap", alignSelf: "flex-start" }}
                    >
                      Mark move done
                    </button>
                  )}
                </>
              )}

              {/* Shrinking progress bar */}
              <div style={{ height: "3px", background: "rgba(0,0,0,0.10)", borderRadius: "2px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${barPct}%`, background: color, borderRadius: "2px", transition: "width 1s linear" }} />
              </div>
            </div>
          );
        }

        // ── Compact card ──────────────────────────────────────────────────────────
        return (
          <div
            className="today-deadline-card"
            data-testid="deadline-card"
            style={{
              background: bg,
              border: `1px solid ${color}`,
              borderRadius: "var(--radius-sm)",
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              animation: isCritical ? "deadline-pulse 2.5s ease-in-out infinite" : "none",
            }}
          >
            {isExpired ? (
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted)" }}>
                🎯 {label} · Deadline reached
              </div>
            ) : (
              <>
                {/* Row 1: icon + eyebrow + label + countdown */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "16px", flexShrink: 0, lineHeight: 1.3 }}>🎯</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "9px", fontWeight: "900", letterSpacing: "0.10em", textTransform: "uppercase", color, lineHeight: 1 }}>
                      KEY DEADLINE
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                      {label}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "12px", fontWeight: "700", color, letterSpacing: "0.02em", marginTop: "4px" }}>
                      {deadlineCountdown ? `${deadlineCountdown} left` : `${days === 0 ? "TODAY" : `${days}d`} left`}
                    </div>
                  </div>
                </div>

                {/* Row 2: TODAY'S MOVE (primary anchor) + OPEN / STILL OPEN / DONE button */}
                {(() => {
                  const isStillOpen = !isDoneToday && timelineProgress >= 0.5;
                  const btnBg = isDoneToday ? "#15803D" : isStillOpen ? "#D97706" : "#EAB308";
                  const btnTextColor = isDoneToday ? "#ffffff" : "#1a1a1a";
                  const btnLabel = isDoneToday ? "DONE" : isStillOpen ? "STILL OPEN" : "OPEN";
                  const btnTitle = isDoneToday ? "Reopen today's move" : "Mark today's move done";
                  const rowLabel = isDoneToday ? "TODAY'S MOVE DONE ✓" : "TODAY'S MOVE";
                  const rowLabelColor = isDoneToday ? "#15803D" : "var(--text-muted)";
                  return (
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "9px", fontWeight: "900", letterSpacing: "0.08em", textTransform: "uppercase", color: rowLabelColor, lineHeight: 1 }}>
                          {rowLabel}
                        </div>
                        {config.deadlineAction && (
                          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", marginTop: "3px", lineHeight: 1.4 }}>
                            {config.deadlineAction}
                          </div>
                        )}
                        {/* Planned today sub-line */}
                        <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                          {todayAvailableDisplay ? (
                            `${todayAvailableDisplay} planned today`
                          ) : (
                            <>
                              — planned today{" "}
                              <button
                                type="button"
                                onClick={() => { setShowTodayHoursPicker(v => !v); setShowCustomHoursInput(false); }}
                                style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "11px", cursor: "pointer", padding: 0, fontWeight: "700" }}
                              >
                                · Set
                              </button>
                            </>
                          )}
                        </div>
                        {/* Inline hours picker */}
                        {showTodayHoursPicker && !todayAvailableDisplay && (
                          <div style={{ marginTop: "6px" }}>
                            {!showCustomHoursInput ? (
                              <div style={{ display: "flex", gap: "5px" }}>
                                {[1, 2, 4, 6].map(h => (
                                  <button
                                    key={h}
                                    type="button"
                                    onClick={() => handleDeadlineTodayHours(h)}
                                    style={{ flex: 1, padding: "7px 0", textAlign: "center", borderRadius: "14px", fontSize: "12px", fontWeight: "700", background: "var(--bg-secondary)", border: "1.5px solid var(--border)", color: "var(--text-primary)", cursor: "pointer" }}
                                  >
                                    {h}h
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setShowCustomHoursInput(true)}
                                  style={{ flex: 1, padding: "7px 0", textAlign: "center", borderRadius: "14px", fontSize: "12px", fontWeight: "700", background: "var(--bg-secondary)", border: "1.5px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer" }}
                                >
                                  Other…
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0.5"
                                  max="16"
                                  value={customHoursValue}
                                  onChange={e => setCustomHoursValue(e.target.value)}
                                  placeholder="e.g. 3.5"
                                  style={{ width: "70px", padding: "4px 8px", borderRadius: "8px", border: "1.5px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "12px" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => { const h = parseFloat(customHoursValue); if (h > 0) handleDeadlineTodayHours(h); }}
                                  style={{ padding: "4px 10px", borderRadius: "14px", fontSize: "11px", fontWeight: "700", background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer" }}
                                >
                                  Set
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        data-testid="deadline-done-btn"
                        onClick={isDoneToday ? handleDeadlineReopenToday : handleDeadlineDoneToday}
                        title={btnTitle}
                        style={{
                          fontSize: "11px", fontWeight: "900", letterSpacing: "0.08em", textTransform: "uppercase",
                          padding: "6px 14px", borderRadius: "20px", border: "none", cursor: "pointer",
                          flexShrink: 0, lineHeight: 1,
                          background: btnBg,
                          color: btnTextColor,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {btnLabel}
                      </button>
                    </div>
                  );
                })()}

                {/* Row 3: Day mini-timeline */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "600" }}>{formatHourLabel(config.dayStartHour ?? 7)}</span>
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "600" }}>{formatHourLabel(config.dayEndHour ?? 26)}</span>
                  </div>
                  <div style={{ height: "6px", background: "var(--bg-secondary)", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${timelineProgress * 100}%`, background: "var(--accent)", borderRadius: "3px", transition: "width 1s linear" }} />
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── Today's Focus — tasks dominate the screen */}
      <section className="tasks-section" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div className="section-header" style={{ gap: "8px", alignItems: "center", justifyContent: "flex-start" }}>
          <h2 className="section-title" style={{ flex: "0 0 auto", margin: 0 }}>
            Today's Focus
            {isMVDMode && (
              <span style={{ color: "var(--warning)", fontSize: "11px", fontWeight: "700", marginLeft: "8px" }}>
                ⭐ MUST-DOS
              </span>
            )}
            {!isMVDMode && config.isLowEnergyMode && (
              <span style={{ color: "var(--warning)", fontSize: "11px", fontWeight: "700", marginLeft: "8px" }}>
                ⚡ LOW ENERGY
              </span>
            )}
          </h2>
          <div className="focus-now-chip-shell">
            <div className="focus-now-chip-row">
              <button
                className={`stuck-btn focus-now-chip${focusNowMode ? " focus-now-chip--active" : ""}`}
                onClick={() => {
                  if (focusNowMode) {
                    setFocusNowMode(false);
                    setFocusNowTaskId(null);
                  } else {
                    setShowFocusNowPicker(true);
                  }
                }}
                title={focusNowMode ? "Exit Focus Now" : "Focus on one task"}
              >
                🎯 Focus Now
              </button>
              {onOpenDayMap && (
                <button
                  className={`stuck-btn day-map-nav-btn${dayMapPlaced > 0 ? " has-tasks" : ""}`}
                  onClick={onOpenDayMap}
                  title="Open Day Map"
                >
                  Day Map
                </button>
              )}
              <button
                className="stuck-btn"
                onClick={() => setIsMVDMode(m => !m)}
                title={isMVDMode ? "Must-Do mode ON — tap to show all" : "Show only must-do tasks"}
                style={{
                  background: isMVDMode ? "var(--warning)" : "var(--bg-secondary)",
                  color: isMVDMode ? "#fff" : "var(--text-secondary)"
                }}
              >
                ⭐ {isMVDMode ? "Must-Dos" : "Must-Do"}
              </button>
              <button
                className="stuck-btn"
                onClick={handleEnergyToggle}
                title={config.isLowEnergyMode ? "Low Energy ON — tap to disable" : "Enable Low Energy mode"}
                style={{
                  background: config.isLowEnergyMode ? "var(--success)" : "var(--bg-secondary)",
                  color: config.isLowEnergyMode ? "#fff" : "var(--text-secondary)"
                }}
              >
                🔋 {config.isLowEnergyMode ? "Low Energy ON" : "Low Energy"}
              </button>
            </div>
          </div>
        </div>

        <div className="tasks-list" data-testid="today-tasks-list">
          {/* ── Focus Now single-task view ─────────────────────────── */}
          {focusNowMode && focusNowTask && (
            <div className="focus-now-view">
              <p className="focus-now-headline">Stay here. This task. This moment.</p>

              {focusNowTask.isCompleted ? (
                <div className="focus-now-completed">
                  <div className="focus-now-completed-icon">✓</div>
                  <p className="focus-now-completed-text">Done. That&apos;s one down.</p>
                  <div className="focus-now-completed-actions">
                    <button
                      className="focus-now-btn focus-now-btn--done"
                      onClick={() => setShowFocusNowPicker(true)}
                    >
                      Pick next task
                    </button>
                    <button
                      className="focus-now-btn focus-now-btn--ghost"
                      onClick={() => { setFocusNowMode(false); setFocusNowTaskId(null); }}
                    >
                      Exit
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="focus-now-card">
                    <div className="focus-now-card-header">
                      <span className={`focus-now-priority ${(focusNowTask.priority || "P3").toLowerCase()}`}>
                        {focusNowTask.priority || "P3"}
                      </span>
                      {focusNowTask.timeEstimateMinutes > 0 && (
                        <span className="focus-now-card-dur">{focusNowTask.timeEstimateMinutes}m</span>
                      )}
                    </div>
                    <h3 className="focus-now-card-title">{focusNowTask.title}</h3>
                    {focusNowTask.concreteStep && (
                      <p className="focus-now-card-step">{focusNowTask.concreteStep}</p>
                    )}
                    {focusNowTask.subSteps && focusNowTask.subSteps.filter(s => !s.done).length > 0 && (
                      <div className="focus-now-substeps">
                        {focusNowTask.subSteps.filter(s => !s.done).slice(0, 3).map(s => (
                          <div key={s.id} className="focus-now-substep">· {s.text}</div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="focus-now-actions">
                    <button
                      className="focus-now-btn focus-now-btn--primary"
                      onClick={() => {
                        if (!focusNowTask.isNowFocus) {
                          handlePinTask(focusNowTask);
                        } else {
                          setIsFocusMode(true);
                        }
                      }}
                    >
                      ▶ Start Focus
                    </button>
                    <button
                      className="focus-now-btn focus-now-btn--done"
                      onClick={() => handleToggleComplete(focusNowTask)}
                    >
                      ✓ Done
                    </button>
                    <div className="focus-now-actions-row">
                      <button
                        className="focus-now-btn focus-now-btn--ghost"
                        onClick={() => setShowFocusNowPicker(true)}
                      >
                        Switch Task
                      </button>
                      <button
                        className="focus-now-btn focus-now-btn--ghost"
                        onClick={() => { setFocusNowMode(false); setFocusNowTaskId(null); }}
                      >
                        Exit
                      </button>
                    </div>
                  </div>
                </>
              )}

              <p className="focus-now-hidden-note">Other tasks are hidden while you focus.</p>
            </div>
          )}

          {/* ── Normal task list (hidden when Focus Now mode is active) ── */}
          {(!focusNowMode || !focusNowTask) && todayTasksAll.length === 0 && (() => {
            const hasEverHadTasks = tasks.filter(t => !t.isDeleted).length > 0;
            if (hasEverHadTasks) {
              return (
                <div style={{ textAlign: "center", padding: "24px 16px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--border)" }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>🎉</div>
                  <p style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "6px" }}>All clear for today!</p>
                  <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
                    No tasks scheduled for today. Tap <strong style={{ color: "var(--accent)" }}>+</strong> to add one, or check other horizons on the Plan tab.
                  </p>
                </div>
              );
            }
            return (
              <div style={{ padding: "20px 16px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--border)" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px", textAlign: "center" }}>🧠</div>
                <p style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "14px", textAlign: "center" }}>
                  Your first focus cycle
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                  {[
                    { n: "1", icon: "💭", text: "Dump what's on your mind", sub: "Tap 📝 above to capture thoughts" },
                    { n: "2", icon: "➕", text: "Add it as a task", sub: "Tap + below — AI breaks it into a micro-step" },
                    { n: "3", icon: "🎯", text: "Pick what matters Today", sub: "You're already on the right tab" },
                    { n: "4", icon: "📍", text: "Pin a task to start the timer", sub: "Tap ••• on any task → Pin to Focus" },
                    { n: "5", icon: "▶", text: "Work for 25 minutes", sub: "Use the focus timer — single task only" },
                    { n: "6", icon: "✓", text: "Done or reset gently", sub: "Complete it, or use Bad Day Reset — no shame" },
                  ].map(item => (
                    <div key={item.n} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                      <span style={{ fontSize: "10px", fontWeight: "900", color: "var(--accent)", minWidth: "14px", paddingTop: "3px" }}>{item.n}</span>
                      <span style={{ fontSize: "16px", lineHeight: "1", paddingTop: "1px" }}>{item.icon}</span>
                      <div>
                        <span style={{ fontSize: "12.5px", fontWeight: "700", color: "var(--text-primary)" }}>{item.text}</span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginTop: "1px" }}>{item.sub}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: "12px", color: "var(--accent)", fontWeight: "700", textAlign: "center" }}>
                  Start with step 2 — tap + to add your first task.
                </p>
              </div>
            );
          })()}
          {(!focusNowMode || !focusNowTask) && todayTasksAll.length > 0 && todayTasksFiltered.length === 0 && isMVDMode && (
            <div style={{ textAlign: "center", padding: "20px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "6px" }}>No must-do tasks marked yet.</p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                Tap ••• on any task and choose <strong>⭐ Mark as must-do</strong> to add it to your minimum viable day.
              </p>
            </div>
          )}
          {(!focusNowMode || !focusNowTask) && todayTasksAll.length > 0 && todayTasksFiltered.length === 0 && !isMVDMode && config.isLowEnergyMode && (
            <div style={{ textAlign: "center", padding: "20px 14px", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "6px" }}>No low-energy tasks available.</p>
              <p style={{ fontSize: "12px", lineHeight: "1.5" }}>
                Tag a task P4 to surface it here, or tap 🌱 Clean Slate in Mind Box for a fresh start.
              </p>
            </div>
          )}
          {(!focusNowMode || !focusNowTask) && todayTasksFiltered.length > 0 && (
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
                      <SortableTaskItem key={getTaskKey(task)} id={getTaskKey(task)}>
                        {({ dragHandleListeners, dragHandleAttributes }) => (
                          <TaskRow
                            task={task}
                            onToggleComplete={handleToggleComplete}
                            onPin={handlePinTask}
                            onDelete={handleDeleteTask}
                            onEdit={handleStartEdit}
                            onMoveUp={idx > 0 ? t => handleMoveTask(t, "up") : undefined}
                            onMoveDown={idx < remainingTasks.length - 1 ? t => handleMoveTask(t, "down") : undefined}
                            onMoveToHorizon={handleMoveToHorizon}
                            onBreakdown={handleBreakdown}
                            onSubStepToggle={handleSubStepToggle}
                            onDeleteSubStep={handleDeleteSubStep}
                            isBreakingDown={breakdownLoadingUuid === task.uuid}
                            onToggleMVD={handleToggleMVD}
                            dragHandleListeners={dragHandleListeners}
                            dragHandleAttributes={dragHandleAttributes}
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

      {/* ── Active Focus Block — only when a task is pinned and not in Focus Now mode */}
      {!focusNowMode && activeTask && (
        <section className="card focus-card">
          <div className="focus-top-bar">
            <div className="focus-live-indicator">
              <div className="live-dot"></div>
              ACTIVE FOCUS NOW
            </div>
            <button
              className="stuck-btn"
              onClick={() => { setRescueStep(0); setShowRescue(true); }}
              title="Feeling stuck? Get unstuck in 4 steps"
            >Stuck?</button>
            <button
              className="stuck-btn"
              onClick={() => {
                setIsTimerRunning(false);
                savePayload({ ...payload, tasks: tasks.map(t => t.uuid === activeTask.uuid ? { ...t, isNowFocus: false, lastUpdated: Date.now() } : t) });
              }}
              title="Unpin this task and close the timer"
              style={{ color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
            >✕ Unpin</button>
          </div>
          <div style={{ textAlign: "center", marginTop: "16px" }}>
            <h3 className="focus-title">{activeTask.title}</h3>
            <div className="step-badge">
              <span>⚡</span> First small step: {activeTask.concreteStep}
            </div>
            <div className="timer-circle-container">
              <svg className="timer-svg" viewBox="0 0 160 160">
                <circle className="timer-ring-bg" cx="80" cy="80" r="70" strokeWidth="8" />
                <circle className="timer-ring-progress" cx="80" cy="80" r="70" strokeWidth="8" style={{ strokeDashoffset }} />
              </svg>
              <div className="timer-text-container">
                <span className="timer-time">{formatTimerMinutes}:{formatTimerSeconds}</span>
                <span className="timer-est">EST: {activeTask.timeEstimateMinutes} MIN</span>
              </div>
            </div>
            <div className="timer-controls">
              <button
                className="control-btn control-btn-play"
                data-testid="timer-play-pause"
                onClick={() => {
                  if (!isTimerRunning) {
                    setIsTimerRunning(true);
                    setIsFocusMode(true);
                  } else {
                    setIsTimerRunning(false);
                  }
                }}
              >
                {isTimerRunning ? "⏸" : "▶"}
              </button>
              <button className="control-btn" onClick={() => { setIsTimerRunning(false); setTimerSecondsLeft(timerMaxSeconds); }}
                title="Reset timer" style={{ fontSize: "16px" }}>
                ↺
              </button>
              <button className="control-btn control-btn-done" onClick={() => handleToggleComplete(activeTask)}>✓</button>
            </div>
          </div>
          <div className="focus-coach-divider"></div>
          <p className="coach-statement">
            "{config.intentionMessage}" — {config.mentorName || "Marcus Aurelius"}
          </p>
        </section>
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
          onAddBrainDump={handleFocusBrainDump}
        />
      )}

      {/* ── Undo Delete Toast */}
      {undoTask && (
        <div style={{ position: "fixed", bottom: "calc(76px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "20px", padding: "10px 16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.35)", zIndex: 200, fontSize: "12.5px", whiteSpace: "nowrap", maxWidth: "90vw" }}>
          <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
            "{undoTask.title.length > 28 ? undoTask.title.substring(0, 28) + "…" : undoTask.title}" deleted
          </span>
          <button onClick={handleUndoDelete}
            style={{ background: "var(--accent)", color: "var(--btn-text, #fff)", border: "none", borderRadius: "12px", padding: "5px 14px", fontSize: "12px", fontWeight: "700", cursor: "pointer", flexShrink: 0 }}>
            Undo
          </button>
        </div>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {editingTask && (
        <AddTaskDialog
          email={payload.config?.userId || ""}
          payload={payload}
          savePayload={savePayload}
          defaultHorizon="today"
          editTask={editingTask}
          onClose={() => setEditingTask(null)}
        />
      )}

      {/* ── Focus Now: task picker bottom sheet ─────────────────── */}
      {showFocusNowPicker && (
        <div className="focus-now-backdrop" onClick={() => setShowFocusNowPicker(false)}>
          <div className="focus-now-sheet" onClick={e => e.stopPropagation()}>
            <div className="focus-now-sheet-header">
              <span className="focus-now-sheet-title">Pick one task</span>
              <button className="focus-now-sheet-close" onClick={() => setShowFocusNowPicker(false)} aria-label="Close picker">✕</button>
            </div>
            <div className="focus-now-sheet-body">
              {focusNowPickerTasks.length === 0 ? (
                <p className="focus-now-empty">No tasks to focus on yet. Add a task to get started.</p>
              ) : (
                <>
                  {dayMapNextTask && (
                    <>
                      <div className="focus-now-section-label">Recommended · Day Map</div>
                      <button
                        className={`focus-now-pick-row${focusNowTaskId === dayMapNextTask.uuid ? " is-selected" : ""}`}
                        onClick={() => { setFocusNowTaskId(dayMapNextTask.uuid); setFocusNowMode(true); setShowFocusNowPicker(false); }}
                      >
                        <span className={`focus-now-priority ${(dayMapNextTask.priority || "P3").toLowerCase()}`}>
                          {dayMapNextTask.priority || "P3"}
                        </span>
                        <span className="focus-now-pick-title">{dayMapNextTask.title}</span>
                        {dayMapNextTask.timeEstimateMinutes > 0 && (
                          <span className="focus-now-pick-dur">{dayMapNextTask.timeEstimateMinutes}m</span>
                        )}
                        <span className="focus-now-pick-recommended">Next up</span>
                      </button>
                    </>
                  )}
                  <div className="focus-now-section-label">
                    {dayMapNextTask ? "All tasks" : "Today's tasks"}
                  </div>
                  {focusNowPickerTasks
                    .filter(t => !dayMapNextTask || t.uuid !== dayMapNextTask.uuid)
                    .map(task => (
                      <button
                        key={task.uuid}
                        className={`focus-now-pick-row${focusNowTaskId === task.uuid ? " is-selected" : ""}`}
                        onClick={() => { setFocusNowTaskId(task.uuid); setFocusNowMode(true); setShowFocusNowPicker(false); }}
                      >
                        <span className={`focus-now-priority ${(task.priority || "P3").toLowerCase()}`}>
                          {task.priority || "P3"}
                        </span>
                        <span className="focus-now-pick-title">{task.title}</span>
                        {task.timeEstimateMinutes > 0 && (
                          <span className="focus-now-pick-dur">{task.timeEstimateMinutes}m</span>
                        )}
                      </button>
                    ))
                  }
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Inline rescue overlay — triggered by Stuck? button on focus card */}
      {showRescue && (
        <div className="rescue-overlay" onClick={() => setShowRescue(false)}>
          <div className="rescue-card card" onClick={e => e.stopPropagation()}>
            <span className="rescue-icon">⚠️</span>
            <h3 className="rescue-title">Getting Unstuck</h3>
            <span className="rescue-step-badge">Step {rescueStep + 1} of {rescueSteps.length}</span>
            <p className="rescue-step-text">{rescueSteps[rescueStep]}</p>
            <button
              className="btn"
              onClick={() => {
                if (rescueStep < rescueSteps.length - 1) setRescueStep(rescueStep + 1);
                else setShowRescue(false);
              }}
              style={{ width: "100%", marginTop: "10px" }}
            >
              {rescueStep === rescueSteps.length - 1 ? "I'm ready to try again" : "Next →"}
            </button>
            <button className="btn btn-cancel" onClick={() => setShowRescue(false)} style={{ width: "100%" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
