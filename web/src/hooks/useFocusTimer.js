import { useState, useEffect, useRef } from "react";
import { requestNotifPermission, notifyFocusComplete } from "../utils/focusNotifications";
import { buildExtendedTimerState, buildResetFocusState, shouldTriggerSessionComplete } from "../utils/focusSession";

// Lifts the Focus timer state to the App level so it survives tab switches
// (TodayTab unmounts when the user navigates to another tab) and can be
// surfaced via a floating timer across pages.
export function useFocusTimer(tasks, config, uid) {
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [timerMaxSeconds, setTimerMaxSeconds] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusSessionActive, setFocusSessionActive] = useState(false);
  const [sessionCompletePending, setSessionCompletePending] = useState(false);
  const [showExtendPicker, setShowExtendPicker] = useState(false);
  
  // Document Picture-in-Picture (PiP) / Pop-out timer states and refs
  const [pipOpen, setPipOpen] = useState(false);
  const pipWinRef = useRef(null);
  const timerMaxSecondsRef = useRef(timerMaxSeconds);
  useEffect(() => {
    timerMaxSecondsRef.current = timerMaxSeconds;
  }, [timerMaxSeconds]);

  const timerIntervalRef = useRef(null);
  // Absolute deadline for the running timer — lets us snap to correct time on tab-show
  const deadlineRef = useRef(null);
  // Lets the activeTask-sync effect tell "switched to a different task" apart
  // from "same task, duration edited mid-session" (the two need different responses).
  const prevActiveTaskRef = useRef({ uuid: null, timeEstimateMinutes: null });

  const activeTask = tasks.find((t) => t.isNowFocus && !t.isDeleted && !t.isCompleted) || null;

  const closePiP = () => {
    try {
      if (pipWinRef.current) {
        pipWinRef.current.close();
        pipWinRef.current = null;
      }
    } catch (_) {}
    setPipOpen(false);
  };

  const updatePiPUI = (pipWin, seconds, running, title) => {
    if (!pipWin) return;
    const doc = pipWin.document;
    const timeEl = doc.getElementById("pt");
    if (timeEl) {
      const mins = Math.floor(seconds / 60);
      const secs = String(seconds % 60).padStart(2, "0");
      timeEl.textContent = `${mins}:${secs}`;
      timeEl.className = running ? "" : "paused";
    }
    const labelEl = doc.getElementById("pl");
    if (labelEl) {
      labelEl.textContent = title;
    }
    const playBtn = doc.getElementById("pip-play");
    if (playBtn) {
      playBtn.textContent = running ? "⏸" : "▶";
    }
  };

  const handleOpenPiP = async () => {
    if (!("documentPictureInPicture" in window)) return;
    // Prevent duplicate pop-out windows: if one exists, focus it and return
    if (pipWinRef.current && pipOpen) {
      try {
        pipWinRef.current.focus();
      } catch (_) {}
      return;
    }
    try {
      const pipWin = await window.documentPictureInPicture.requestWindow({ width: 200, height: 165 });
      pipWinRef.current = pipWin;
      setPipOpen(true);

      // Build PiP HTML content
      const style = pipWin.document.createElement("style");
      style.textContent = [
        "* { box-sizing: border-box; margin: 0; padding: 0; }",
        "body { background: #05090b; display: flex; flex-direction: column;",
        "  align-items: center; justify-content: center; height: 100vh;",
        "  font-family: system-ui, sans-serif; user-select: none; }",
        "#pt { font-family: 'Space Mono','Courier New',monospace; font-size: 40px;",
        "  font-weight: 700; color: #edf7f2; letter-spacing: -0.02em;",
        "  font-variant-numeric: tabular-nums; transition: color 0.3s; }",
        "#pt.paused { color: rgba(237,247,242,0.35); }",
        "#pl { font-size: 10px; color: rgba(196,223,210,0.65); margin-top: 5px;",
        "  max-width: 186px; overflow: hidden; text-overflow: ellipsis;",
        "  white-space: nowrap; text-align: center; }",
        "#pip-btns { display: flex; gap: 10px; margin-top: 12px; }",
        "#pip-play, #pip-reset { background: rgba(255,255,255,0.10);",
        "  border: 1px solid rgba(255,255,255,0.18); color: #edf7f2;",
        "  border-radius: 8px; font-size: 18px; width: 44px; height: 36px;",
        "  display: flex; align-items: center; justify-content: center;",
        "  cursor: pointer; line-height: 1; }",
        "#pip-play:active, #pip-reset:active { opacity: 0.6; }",
      ].join(" ");
      pipWin.document.head.appendChild(style);

      const timeEl = pipWin.document.createElement("div");
      timeEl.id = "pt";
      pipWin.document.body.appendChild(timeEl);

      const labelEl = pipWin.document.createElement("div");
      labelEl.id = "pl";
      pipWin.document.body.appendChild(labelEl);

      const btnsEl = pipWin.document.createElement("div");
      btnsEl.id = "pip-btns";

      const playBtn = pipWin.document.createElement("button");
      playBtn.id = "pip-play";
      playBtn.textContent = "▶";
      playBtn.addEventListener("click", () => setIsTimerRunning(r => !r));

      const resetBtn = pipWin.document.createElement("button");
      resetBtn.id = "pip-reset";
      resetBtn.textContent = "↺";
      resetBtn.addEventListener("click", () => {
        setIsTimerRunning(false);
        setTimerSecondsLeft(timerMaxSecondsRef.current);
      });

      btnsEl.appendChild(playBtn);
      btnsEl.appendChild(resetBtn);
      pipWin.document.body.appendChild(btnsEl);

      pipWin.addEventListener("pagehide", () => {
        pipWinRef.current = null;
        setPipOpen(false);
      });

      updatePiPUI(pipWin, timerSecondsLeft, isTimerRunning, activeTask?.title || "Deep Focus");
    } catch (e) {
      console.error("Failed to open PiP:", e);
    }
  };

  // Sync timer state changes to PiP window in real-time
  useEffect(() => {
    if (pipWinRef.current && pipOpen) {
      updatePiPUI(pipWinRef.current, timerSecondsLeft, isTimerRunning, activeTask?.title || "Deep Focus");
    }
  }, [timerSecondsLeft, isTimerRunning, activeTask?.title, pipOpen]);

  // PiP safety close rules: close when session ends or no active task exists
  useEffect(() => {
    if (!focusSessionActive || !activeTask) {
      closePiP();
    }
  }, [focusSessionActive, activeTask]);

  // Reset all Focus session state when the authenticated account changes
  // (login, logout, or switching accounts on the same browser) — prevents one
  // user's timer, focus mode, or completion prompt from leaking into the next.
  useEffect(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    deadlineRef.current = null;
    
    closePiP(); // Close pop-out on account switch
    
    const reset = buildResetFocusState(config);
    setIsTimerRunning(reset.isTimerRunning);
    setTimerSecondsLeft(reset.timerSecondsLeft);
    setTimerMaxSeconds(reset.timerMaxSeconds);
    setIsFocusMode(reset.isFocusMode);
    setFocusSessionActive(reset.focusSessionActive);
    setSessionCompletePending(reset.sessionCompletePending);
    setShowExtendPicker(reset.showExtendPicker);
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prev = prevActiveTaskRef.current;
    if (activeTask) {
      const rawMins = Number(activeTask.timeEstimateMinutes);
      const taskSecs = (rawMins > 0 ? rawMins : 25) * 60;
      setTimerMaxSeconds(taskSecs);
      const sameTask = prev.uuid === activeTask.uuid;
      if (!isTimerRunning || !sameTask) {
        // Not running yet, or the active task itself just changed (e.g. "Start
        // Focus" pinned a different task while a session was already running) —
        // start the countdown from this task's own duration, not whatever time
        // was left on the previous task.
        setTimerSecondsLeft(taskSecs);
        if (isTimerRunning) deadlineRef.current = Date.now() + taskSecs * 1000;
      } else if (prev.timeEstimateMinutes !== activeTask.timeEstimateMinutes) {
        // Same task whose Focus timer is already running had its duration edited
        // elsewhere (e.g. DayMap) — preserve elapsed time instead of resetting it,
        // and re-anchor the wall-clock deadline the running interval reads from.
        const elapsed = timerMaxSeconds - timerSecondsLeft;
        const newSecondsLeft = Math.max(0, taskSecs - elapsed);
        setTimerSecondsLeft(newSecondsLeft);
        deadlineRef.current = Date.now() + newSecondsLeft * 1000;
      }
    } else {
      const rawMins = Number(config.pomodoroDurationMinutes);
      const defaultSecs = (rawMins > 0 ? rawMins : 25) * 60;
      setTimerMaxSeconds(defaultSecs);
      if (!isTimerRunning) setTimerSecondsLeft(defaultSecs);
    }
    prevActiveTaskRef.current = { uuid: activeTask?.uuid ?? null, timeEstimateMinutes: activeTask?.timeEstimateMinutes ?? null };
  }, [activeTask?.uuid, activeTask?.timeEstimateMinutes, config.pomodoroDurationMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isTimerRunning) {
      // Anchor to wall-clock time so background tabs / GC pauses don't cause drift.
      // Reads/writes go through deadlineRef.current (not a local const) so an
      // external duration edit mid-session (see the activeTask-sync effect above)
      // can re-anchor the deadline this running interval is already using.
      deadlineRef.current = Date.now() + timerSecondsLeft * 1000;
      timerIntervalRef.current = setInterval(() => {
        const remaining = Math.ceil((deadlineRef.current - Date.now()) / 1000);
        setTimerSecondsLeft(remaining <= 0 ? 0 : remaining);
      }, 1000);
      // Snap to correct remaining time the moment the tab becomes visible again —
      // background timers are throttled so the display may be stale after switching back.
      const handleVisible = () => {
        if (document.visibilityState === "visible") {
          const remaining = Math.ceil((deadlineRef.current - Date.now()) / 1000);
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

  // Detect the timer reaching 0:00 while running and surface the global
  // "session complete" prompt — lives here (App level, always mounted) so it
  // fires even while the user is on Roadmap/MindBox/Coach/Settings.
  useEffect(() => {
    if (shouldTriggerSessionComplete({ isTimerRunning, timerSecondsLeft })) {
      setIsTimerRunning(false);
      setSessionCompletePending(true);
      notifyFocusComplete(activeTask?.title);
    }
  }, [timerSecondsLeft, isTimerRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop timer automatically if the focused task is deleted or completed mid-session
  useEffect(() => {
    if (isTimerRunning && !activeTask) setIsTimerRunning(false);
  }, [activeTask, isTimerRunning]);

  // Auto-exit focus mode and end the session when activeTask is removed externally
  useEffect(() => {
    if (!activeTask) {
      setIsFocusMode(false);
      setFocusSessionActive(false);
      setSessionCompletePending(false);
      setShowExtendPicker(false);
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
  useEffect(() => () => {
    document.title = "Loci";
    closePiP();
  }, []);



  // Request notification permission when focus overlay opens (already a user interaction)
  useEffect(() => {
    if (isFocusMode) requestNotifPermission();
  }, [isFocusMode]);

  // Dismiss the global "session complete" prompt without restarting the timer
  // (used by the "Done! +120 XP" path, which ends the session instead).
  const dismissSessionComplete = () => setSessionCompletePending(false);

  // Restart the timer for the same task with a fresh duration ("Keep going" extension)
  const extendTimer = (minutes) => {
    const next = buildExtendedTimerState(minutes);
    setTimerMaxSeconds(next.timerMaxSeconds);
    setTimerSecondsLeft(next.timerSecondsLeft);
    setIsTimerRunning(next.isTimerRunning);
    setSessionCompletePending(false);
    setShowExtendPicker(false);
  };

  return {
    activeTask,
    isTimerRunning, setIsTimerRunning,
    timerSecondsLeft, setTimerSecondsLeft,
    timerMaxSeconds, setTimerMaxSeconds,
    isFocusMode, setIsFocusMode,
    focusSessionActive, setFocusSessionActive,
    sessionCompletePending, dismissSessionComplete,
    showExtendPicker, setShowExtendPicker,
    extendTimer,
    pipOpen,
    handleOpenPiP,
  };
}
