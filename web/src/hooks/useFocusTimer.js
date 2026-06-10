import { useState, useEffect, useRef } from "react";
import { requestNotifPermission } from "../utils/focusNotifications";
import { buildExtendedTimerState } from "../utils/focusSession";

// Lifts the Focus timer state to the App level so it survives tab switches
// (TodayTab unmounts when the user navigates to another tab) and can be
// surfaced via a floating timer across pages.
export function useFocusTimer(tasks, config) {
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [timerMaxSeconds, setTimerMaxSeconds] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusSessionActive, setFocusSessionActive] = useState(false);
  const timerIntervalRef = useRef(null);
  // Absolute deadline for the running timer — lets us snap to correct time on tab-show
  const deadlineRef = useRef(null);

  const activeTask = tasks.find((t) => t.isNowFocus && !t.isDeleted && !t.isCompleted) || null;

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
  }, [activeTask?.uuid, activeTask?.timeEstimateMinutes, config.pomodoroDurationMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Auto-exit focus mode and end the session when activeTask is removed externally
  useEffect(() => {
    if (!activeTask) {
      setIsFocusMode(false);
      setFocusSessionActive(false);
    }
  }, [activeTask]);

  // A focus session is "active" (and the floating timer should be available)
  // from the moment the timer starts running until the session is explicitly ended.
  useEffect(() => {
    if (isTimerRunning) setFocusSessionActive(true);
  }, [isTimerRunning]);

  // Tab title: countdown while running, paused label in overlay, restore otherwise
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

  // Restore title on unmount (e.g. user signs out while timer is running)
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

  // Restart the timer for the same task with a fresh duration ("Keep going" extension)
  const extendTimer = (minutes) => {
    const next = buildExtendedTimerState(minutes);
    setTimerMaxSeconds(next.timerMaxSeconds);
    setTimerSecondsLeft(next.timerSecondsLeft);
    setIsTimerRunning(next.isTimerRunning);
  };

  return {
    activeTask,
    isTimerRunning, setIsTimerRunning,
    timerSecondsLeft, setTimerSecondsLeft,
    timerMaxSeconds, setTimerMaxSeconds,
    isFocusMode, setIsFocusMode,
    focusSessionActive, setFocusSessionActive,
    extendTimer,
  };
}
