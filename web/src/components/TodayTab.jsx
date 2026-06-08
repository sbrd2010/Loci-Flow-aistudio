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
import { formatTodayCountdown, isDailyDone } from "../utils/deadlineCountdown";
import { getCurrentAnchorSlot, getAnchorVariant, getTodayCheckedIds, getTodayShownSlots, getLociDayStr } from "../utils/dailyAnchors";
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

function getWorkWindowEnd(dayStartHour, dayEndHour) {
  const now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;
  const end = new Date(now);
  if (dayEndHour >= 24) {
    const wrapH = dayEndHour - 24;
    if (nowH >= dayStartHour) {
      end.setDate(now.getDate() + 1);
      end.setHours(wrapH, 0, 0, 0);
    } else if (nowH < wrapH) {
      end.setHours(wrapH, 0, 0, 0);
    } else {
      return null;
    }
  } else {
    if (nowH < dayStartHour || nowH >= dayEndHour) return null;
    end.setHours(dayEndHour, 0, 0, 0);
  }
  return end;
}

// "before" = window hasn't started yet today, "during" = inside window, "after" = window closed
function getWorkWindowState(dayStartHour, dayEndHour) {
  const nowH = new Date().getHours() + new Date().getMinutes() / 60;
  if (dayEndHour >= 24) {
    const wrapH = dayEndHour - 24;
    if (nowH >= dayStartHour || nowH < wrapH) return "during";
    return "before";
  }
  if (nowH >= dayStartHour && nowH < dayEndHour) return "during";
  return nowH < dayStartHour ? "before" : "after";
}

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

export default function TodayTab({ payload, savePayload, onOpenDayMap, onOpenMindBox, autoOpenFocus = false, onAutoOpenFocusDone }) {
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
  const [showAnchorSheet, setShowAnchorSheet] = useState(false);

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
      onPlayPause: () => setIsTimerRunning(r => !r),
      onReset: () => { setIsTimerRunning(false); setTimerSecondsLeft(timerMaxSeconds); },
    };
  }, [timerSecondsLeft, isTimerRunning, activeTask?.title, timerMaxSeconds]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const [todayCountdown, setTodayCountdown] = useState(null);
  useEffect(() => {
    const tick = () => {
      const end = getWorkWindowEnd(config.dayStartHour ?? 7, config.dayEndHour ?? 26);
      setTodayCountdown(end ? formatTodayCountdown(end - Date.now()) : null);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [config.dayStartHour, config.dayEndHour]);

  const _tsd = new Date();
  const todayStr = `${_tsd.getFullYear()}-${String(_tsd.getMonth() + 1).padStart(2, "0")}-${String(_tsd.getDate()).padStart(2, "0")}`;
  const isDoneToday = isDailyDone(config.deadlineDailyDoneDate, todayStr);

  // ── Daily Anchors derived state ────────────────────────────────────────────
  const anchors = config.dailyAnchors || [];
  const anchorTodayStr = getLociDayStr(new Date(), config.dayStartHour ?? 7, config.dayEndHour ?? 26);
  const todayCheckedIds = getTodayCheckedIds(config, anchorTodayStr);
  const todayShownSlots = getTodayShownSlots(config, anchorTodayStr);
  const anchorsCheckedCount = anchors.filter(a => todayCheckedIds.includes(a.id)).length;
  const todayShownSlotsKey = todayShownSlots.join(",");
  const handleDeadlineDoneToday = () => {
    savePayload({ ...payload, config: { ...config, deadlineDailyDoneDate: todayStr, lastUpdated: Date.now() } });
  };

  const handleDeadlineReopenToday = () => {
    savePayload({ ...payload, config: { ...config, deadlineDailyDoneDate: null, lastUpdated: Date.now() } });
  };

  const [todayDeadlineRemaining, setTodayDeadlineRemaining] = useState(null);
  useEffect(() => {
    const tick = () => {
      if (!config.deadlineDate) { setTodayDeadlineRemaining(null); return; }
      const end = getWorkWindowEnd(config.dayStartHour ?? 7, config.dayEndHour ?? 26);
      setTodayDeadlineRemaining(end ? Math.max(0, end - Date.now()) : null);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [config.deadlineDate, config.dayStartHour, config.dayEndHour]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayLiveDisplay = todayDeadlineRemaining === null ? null
    : todayDeadlineRemaining === 0 ? "0h 00m"
    : formatTodayCountdown(todayDeadlineRemaining);

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
    const enabling = !config.isLowEnergyMode;
    if (enabling) setIsMVDMode(false);
    savePayload({ ...payload, config: { ...config, isLowEnergyMode: enabling, lastUpdated: Date.now() } });
  };

  const handleMVDModeToggle = () => {
    const enabling = !isMVDMode;
    if (enabling && config.isLowEnergyMode) {
      savePayload({ ...payload, config: { ...config, isLowEnergyMode: false, lastUpdated: Date.now() } });
    }
    setIsMVDMode(enabling);
  };

  // ── Daily Anchors auto-show ────────────────────────────────────────────────
  useEffect(() => {
    if (!anchors.length) return;
    if (focusNowMode || editingTask || showFocusNowPicker || confirmDialog) return;
    const slot = getCurrentAnchorSlot(new Date(), config.dayStartHour ?? 7, config.dayEndHour ?? 26);
    if (!slot) return;
    if (todayShownSlots.includes(slot)) return;
    const snoozeUntil = config.anchorsSnoozeUntil;
    if (snoozeUntil && Date.now() < snoozeUntil) return;
    const timer = setTimeout(() => setShowAnchorSheet(true), 2500);
    return () => clearTimeout(timer);
  }, [anchors.length, todayShownSlotsKey, focusNowMode, !!editingTask, showFocusNowPicker, !!confirmDialog, config.anchorsSnoozeUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnchorCheck = (id) => {
    const next = todayCheckedIds.includes(id)
      ? todayCheckedIds.filter(x => x !== id)
      : [...todayCheckedIds, id];
    savePayload({ ...payload, config: { ...config,
      anchorsCheckedIds: next, anchorsCheckedDate: anchorTodayStr, lastUpdated: Date.now()
    }});
  };

  const handleAnchorSheetDone = () => {
    const slot = getCurrentAnchorSlot(new Date(), config.dayStartHour ?? 7, config.dayEndHour ?? 26);
    const nextSlots = slot && !todayShownSlots.includes(slot) ? [...todayShownSlots, slot] : todayShownSlots;
    savePayload({ ...payload, config: { ...config,
      anchorsShownSlots: nextSlots, anchorsSlotsDate: anchorTodayStr,
      anchorsSnoozeUntil: null, lastUpdated: Date.now()
    }});
    setShowAnchorSheet(false);
  };

  const handleAnchorLater = () => {
    savePayload({ ...payload, config: { ...config,
      anchorsSnoozeUntil: Date.now() + 90 * 60 * 1000, lastUpdated: Date.now()
    }});
    setShowAnchorSheet(false);
  };

  const handleAnchorSkipToday = () => {
    savePayload({ ...payload, config: { ...config,
      anchorsShownSlots: ["morning", "afternoon", "evening"], anchorsSlotsDate: anchorTodayStr,
      anchorsSnoozeUntil: null, lastUpdated: Date.now()
    }});
    setShowAnchorSheet(false);
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
  const pinnedFocusTask = todayTasksAll.find(t => t.isNowFocus && !t.isCompleted && !t.isDeleted) || null;
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
  const remainingTasks = todayTasksFiltered.filter((t) => !t.isCompleted && t.uuid !== pinnedFocusTask?.uuid).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
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
        const headerStyle = config.headerStyle === "autohide" ? "frameless" : (config.headerStyle || "full");

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

        const windowState = getWorkWindowState(config.dayStartHour ?? 7, config.dayEndHour ?? 26);
        const startLabel = formatHourLabel(config.dayStartHour ?? 7);
        const endLabel = formatHourLabel(config.dayEndHour ?? 26);

        // ── Compact card ──────────────────────────────────────────────────────────
        return (
          <div
            className="today-deadline-card"
            data-testid="deadline-card"
            style={{
              background: bg,
              border: `1px solid ${color}`,
              borderRadius: "var(--radius-sm)",
              padding: "7px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "5px",
              animation: isCritical ? "deadline-pulse 2.5s ease-in-out infinite" : "none",
            }}
          >
            {isExpired ? (
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted)" }}>
                🎯 {label} · Deadline reached
              </div>
            ) : (
              <>
                {/* Row 1: icon + eyebrow LEFT · day count RIGHT */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <span style={{ fontSize: "14px", lineHeight: 1 }}>{icon}</span>
                    <span style={{ fontSize: "9px", fontWeight: "900", letterSpacing: "0.10em", textTransform: "uppercase", color }}>
                      KEY DEADLINE
                    </span>
                  </div>
                  <span className="dc-days" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "16px", fontWeight: "900", color: "#EF4444", letterSpacing: "0.02em", flexShrink: 0 }}>
                    {days === 0 ? "TODAY" : `${days}d`} left
                  </span>
                </div>

                {/* Row 2: deadline sentence */}
                <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {label}
                </div>

                {/* Row 3: TODAY'S MOVE + OPEN / STILL OPEN / DONE button */}
                {(() => {
                  const isStillOpen = !isDoneToday && timelineProgress >= 0.5;
                  const btnBg = isDoneToday ? "#15803D" : isStillOpen ? "#D97706" : "#EAB308";
                  const btnTextColor = isDoneToday ? "#ffffff" : "#1a1a1a";
                  const btnLabel = isDoneToday ? "DONE" : isStillOpen ? "STILL OPEN" : "OPEN";
                  const btnTitle = isDoneToday ? "Reopen today's move" : "Mark today's move done";
                  const rowLabel = isDoneToday ? "TODAY'S MOVE DONE ✓" : "TODAY'S MOVE";
                  const rowLabelColor = isDoneToday ? "#15803D" : "#D97706";
                  return (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "9px", fontWeight: "900", letterSpacing: "0.08em", textTransform: "uppercase", color: rowLabelColor }}>
                          {rowLabel}
                        </span>
                        {config.deadlineAction && (
                          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-primary)", marginLeft: "5px" }}>
                            {config.deadlineAction}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        data-testid="deadline-done-btn"
                        onClick={isDoneToday ? handleDeadlineReopenToday : handleDeadlineDoneToday}
                        title={btnTitle}
                        style={{
                          fontSize: "11px", fontWeight: "900", letterSpacing: "0.06em", textTransform: "uppercase",
                          padding: "5px 12px", borderRadius: "20px", border: "none", cursor: "pointer",
                          flexShrink: 0, lineHeight: 1,
                          background: btnBg, color: btnTextColor, whiteSpace: "nowrap",
                          minHeight: "30px",
                        }}
                      >
                        {btnLabel}
                      </button>
                    </div>
                  );
                })()}

                {/* Row 4: thin day-progress bar with window-state awareness */}
                <div style={{ marginTop: "1px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "600" }}>{startLabel}</span>
                    {windowState === "before" && (
                      <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "600" }}>
                        opens {startLabel}
                      </span>
                    )}
                    {windowState === "during" && todayLiveDisplay && (
                      <span className="dc-countdown" style={{ fontSize: "10px", color: "#D97706", fontWeight: "800" }}>
                        {todayLiveDisplay} left today
                      </span>
                    )}
                    {windowState === "after" && (
                      <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "600" }}>closed</span>
                    )}
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "600" }}>{endLabel}</span>
                  </div>
                  <div className="dc-bar-track" style={{ position: "relative", height: "6px", background: "var(--bg-secondary)", borderRadius: "999px", overflow: "visible" }}>
                    {windowState === "during" && (
                      <div className="dc-bar-fill" style={{ height: "100%", width: `${timelineProgress * 100}%`, background: "linear-gradient(90deg, #374151 0%, #1d70a0 55%, #d97706 100%)", borderRadius: "999px", transition: "width 1s linear" }} />
                    )}
                    {windowState === "after" && (
                      <div style={{ height: "100%", width: "100%", background: "var(--bg-tertiary, var(--bg-secondary))", borderRadius: "999px", opacity: 0.5 }} />
                    )}
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
                title={focusNowMode ? "Exit One Task Focus" : "One Task Focus"}
              >
                🎯 One Task
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
              {anchors.length > 0 && (
                <button
                  className="stuck-btn"
                  onClick={() => setShowAnchorSheet(true)}
                  title="Daily Anchors"
                  style={{
                    background: anchorsCheckedCount === anchors.length ? "rgba(165,214,167,0.15)" : "var(--bg-secondary)",
                    color: anchorsCheckedCount === anchors.length ? "var(--success)" : "var(--text-secondary)"
                  }}
                >
                  &#128204;{anchorsCheckedCount > 0 ? ` ${anchorsCheckedCount}/${anchors.length}` : " Anchors"}
                </button>
              )}
              <button
                className="stuck-btn"
                onClick={handleMVDModeToggle}
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

        {!focusNowMode && pinnedFocusTask && (
          <div className="pinned-focus-section">
            <span className="pinned-focus-label">📍 PINNED FOCUS</span>
            <div className="pinned-focus-inner">
              <TaskRow
                task={pinnedFocusTask}
                onToggleComplete={handleToggleComplete}
                onPin={handlePinTask}
                onDelete={handleDeleteTask}
                onEdit={handleStartEdit}
                onMoveToHorizon={handleMoveToHorizon}
                onBreakdown={handleBreakdown}
                onSubStepToggle={handleSubStepToggle}
                onDeleteSubStep={handleDeleteSubStep}
                isBreakingDown={breakdownLoadingUuid === pinnedFocusTask.uuid}
                onToggleMVD={handleToggleMVD}
              />
              <button
                type="button"
                className="pinned-focus-start-btn"
                aria-label={`Start focus on ${pinnedFocusTask.title}`}
                onClick={() => {
                  setIsFocusMode(true);
                  setIsTimerRunning(true);
                }}
              >
                Focus →
              </button>
            </div>
          </div>
        )}

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

      {/* ── Daily Anchors check-in sheet ────────────────────────── */}
      {showAnchorSheet && anchors.length > 0 && (() => {
        const variant = getAnchorVariant(new Date());
        return (
          <div className="focus-now-backdrop" onClick={handleAnchorSheetDone}>
            <div className="anchor-sheet" onClick={e => e.stopPropagation()}>
              <div className="anchor-sheet-header" style={{ borderLeftColor: variant.accentColor }}>
                <span className="anchor-sheet-icon">&#128204;</span>
                <div>
                  <div className="anchor-sheet-title">{variant.title}</div>
                  <div className="anchor-sheet-intro">{variant.intro}</div>
                </div>
              </div>
              <div className="anchor-chips">
                {anchors.map(a => {
                  const checked = todayCheckedIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      className={`anchor-chip${checked ? " anchor-chip--checked" : ""}`}
                      style={{ borderColor: checked ? "transparent" : variant.accentColor, color: checked ? "var(--success)" : variant.accentColor }}
                      onClick={() => handleAnchorCheck(a.id)}
                    >
                      {checked ? "✓ " : ""}{a.text}
                    </button>
                  );
                })}
              </div>
              <div className="anchor-sheet-actions">
                <button className="anchor-btn-primary" onClick={handleAnchorSheetDone}>All good</button>
                <button className="anchor-btn-ghost" onClick={handleAnchorLater}>Later</button>
                <button className="anchor-btn-ghost" onClick={handleAnchorSkipToday}>Skip today</button>
                <button className="anchor-btn-ghost" onClick={() => { setShowAnchorSheet(false); onOpenMindBox?.(); }}>Manage</button>
              </div>
            </div>
          </div>
        );
      })()}

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
