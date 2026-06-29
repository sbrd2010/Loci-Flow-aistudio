import { useState, useEffect, useRef } from "react";
import { requestNotifPermission, notifyFocusComplete } from "../utils/focusNotifications";
import { buildExtendedTimerState, buildResetFocusState, shouldTriggerSessionComplete } from "../utils/focusSession";

// Lifts the Focus timer state to the App level so it survives tab switches
// (TodayTab unmounts when the user navigates to another tab) and can be
// surfaced via a floating timer across pages.
export function useFocusTimer(tasks, config, uid, reshuffleTrackRef) {
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
  // The PiP "+5" button's click listener is attached once when the popup opens
  // and is never replaced on later renders, so its addTimeToSession closure can
  // predate completion — read this through a ref (not the state directly) so a
  // stale closure still sees the latest value.
  const sessionCompletePendingRef = useRef(false);
  useEffect(() => {
    sessionCompletePendingRef.current = sessionCompletePending;
  }, [sessionCompletePending]);
  // "Keep going" clears sessionCompletePending before the user has actually
  // chosen a new duration (showExtendPicker stays open in between) — block
  // +5 during that window too, or it'd skew the just-completed 0:00 state.
  const showExtendPickerRef = useRef(false);
  useEffect(() => {
    showExtendPickerRef.current = showExtendPicker;
  }, [showExtendPicker]);

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

  const PIP_RING_CIRC = 2 * Math.PI * 52;

  const updatePiPUI = (pipWin, seconds, maxSeconds, running, title) => {
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
    const ratio = maxSeconds > 0 ? seconds / maxSeconds : 0;
    const ringFg = doc.getElementById("pr-fg");
    if (ringFg) {
      ringFg.setAttribute("stroke-dashoffset", String(PIP_RING_CIRC * (1 - ratio)));
    }
    doc.body.style.setProperty("--ratio", String(ratio));
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
      const pipWin = await window.documentPictureInPicture.requestWindow({ width: 220, height: 210 });
      pipWinRef.current = pipWin;
      setPipOpen(true);

      // Build PiP HTML content
      const style = pipWin.document.createElement("style");
      style.textContent = [
        "* { box-sizing: border-box; margin: 0; padding: 0; }",
        "body { background: #05090b; display: flex; flex-direction: column;",
        "  align-items: center; justify-content: center; height: 100vh;",
        "  font-family: system-ui, sans-serif; user-select: none; overflow: hidden; }",
        // container-type:size lets #pt size itself in cqmin units relative to this box,
        // so digits and ring shrink in lockstep at every size (not just at clamp endpoints).
        "#ring-wrap { position: relative; width: clamp(90px, 55vmin, 130px);",
        "  height: clamp(90px, 55vmin, 130px); container-type: size;",
        "  display: flex; align-items: center; justify-content: center; }",
        "#ring-wrap svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%;",
        "  transform: rotate(-90deg); }",
        "#pr-bg { fill: none; stroke: rgba(87,241,219,0.16); stroke-width: 5; }",
        "#pr-fg { fill: none; stroke: #57f1db; stroke-width: 5; stroke-linecap: round;",
        "  transition: stroke-dashoffset 0.3s linear; }",
        // #pt needs position:relative so it paints above the absolutely-positioned
        // ring svg (DOM order alone isn't enough once a sibling is positioned).
        // line-height:1 avoids the browser default line-height clipping digits at tiny sizes.
        "#pt { position: relative; font-family: 'Space Mono','Courier New',monospace;",
        "  font-size: clamp(22px, 24.6cqmin, 32px); line-height: 1;",
        "  font-weight: 700; color: #edf7f2; letter-spacing: -0.02em;",
        "  font-variant-numeric: tabular-nums; transition: color 0.3s, text-shadow 0.3s;",
        "  text-shadow: 0 0 clamp(3px, 8vmin, 16px) rgba(87,241,219,0.55); }",
        "#pt.paused { color: rgba(237,247,242,0.35); text-shadow: none; }",
        "#pl { font-size: 10px; color: rgba(196,223,210,0.65); margin-top: 5px;",
        "  max-width: 200px; overflow: hidden; text-overflow: ellipsis;",
        "  white-space: nowrap; text-align: center; }",
        "#pip-btns { display: flex; gap: 8px; margin-top: 10px; }",
        // Button size/font now scale continuously via clamp (coefficients chosen so the
        // default 220x210 popup, vmin=210, still resolves to the previous fixed ceiling).
        "#pip-play, #pip-reset, #pip-add5, #pip-shuffle { background: rgba(255,255,255,0.10);",
        "  border: 1px solid rgba(255,255,255,0.18); color: #edf7f2;",
        "  border-radius: 8px; font-size: clamp(11px, 8vmin, 16px);",
        "  width: clamp(24px, 20vmin, 40px); height: clamp(20px, 16vmin, 32px);",
        "  display: flex; align-items: center; justify-content: center;",
        "  cursor: pointer; line-height: 1; flex-shrink: 0; }",
        "#pip-add5 { font-size: 11px; font-weight: 700; }",
        "#pip-play:active, #pip-reset:active, #pip-add5:active, #pip-shuffle:active { opacity: 0.6; }",
        // Stage 2 — compact enter: window too small (width OR height) for a clean ring —
        // hide it, scale up the digits, drop the label and secondary buttons immediately,
        // and tie the background to time-remaining (cyan drains to near-black over the session).
        "@media (max-width: 150px), (max-height: 140px) {",
        "  body { background: linear-gradient(to right,",
        "    #0c3a36 0%, #0c3a36 calc(var(--ratio, 1) * 100%),",
        "    #05090b calc(var(--ratio, 1) * 100%), #05090b 100%); }",
        "  #ring-wrap { width: 100%; height: clamp(40px, 26vmin, 64px); }",
        "  #ring-wrap svg { display: none; }",
        "  #pt { font-size: clamp(32px, 22vmin, 56px); color: #f5fbfa;",
        "    text-shadow: 0 0 4px rgba(0, 0, 0, 0.65); }",
        "  #pl, #pip-add5, #pip-shuffle { display: none; }",
        "  #pip-play, #pip-reset {",
        "    background: rgba(5, 9, 11, 0.78); border: 1px solid rgba(255, 255, 255, 0.35); }",
        "}",
        // Stage 4 — extreme/height-constrained: only the timer digits should be visible.
        // #ring-wrap itself must be re-sized here too, since stage 2's compact height
        // (clamp(40px,26vmin,64px)) is too short to contain these larger digits without
        // clipping them where they're centered inside #ring-wrap via flex.
        "@media (max-height: 80px) {",
        "  #pip-play, #pip-reset, #pip-btns { display: none; }",
        "  #ring-wrap { width: 100%; height: 100vh; }",
        "  #pt { font-size: clamp(40px, 60vmin, 90px); }",
        "}",
      ].join(" ");
      pipWin.document.head.appendChild(style);

      const ringWrap = pipWin.document.createElement("div");
      ringWrap.id = "ring-wrap";

      const svgNS = "http://www.w3.org/2000/svg";
      const ringSvg = pipWin.document.createElementNS(svgNS, "svg");
      ringSvg.setAttribute("viewBox", "0 0 120 120");

      const ringBg = pipWin.document.createElementNS(svgNS, "circle");
      ringBg.id = "pr-bg";
      ringBg.setAttribute("cx", "60");
      ringBg.setAttribute("cy", "60");
      ringBg.setAttribute("r", "52");
      ringSvg.appendChild(ringBg);

      const ringFg = pipWin.document.createElementNS(svgNS, "circle");
      ringFg.id = "pr-fg";
      ringFg.setAttribute("cx", "60");
      ringFg.setAttribute("cy", "60");
      ringFg.setAttribute("r", "52");
      ringFg.setAttribute("stroke-dasharray", String(PIP_RING_CIRC));
      ringSvg.appendChild(ringFg);

      ringWrap.appendChild(ringSvg);

      const timeEl = pipWin.document.createElement("div");
      timeEl.id = "pt";
      ringWrap.appendChild(timeEl);

      pipWin.document.body.appendChild(ringWrap);

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

      const add5Btn = pipWin.document.createElement("button");
      add5Btn.id = "pip-add5";
      add5Btn.textContent = "+5";
      add5Btn.title = "Add 5 minutes";
      add5Btn.addEventListener("click", () => addTimeToSession(5));

      const shuffleBtn = pipWin.document.createElement("button");
      shuffleBtn.id = "pip-shuffle";
      shuffleBtn.textContent = "🔀";
      shuffleBtn.title = "Shuffle track";
      shuffleBtn.addEventListener("click", () => reshuffleTrackRef?.current?.());

      btnsEl.appendChild(playBtn);
      btnsEl.appendChild(resetBtn);
      btnsEl.appendChild(add5Btn);
      btnsEl.appendChild(shuffleBtn);
      pipWin.document.body.appendChild(btnsEl);

      pipWin.addEventListener("pagehide", () => {
        pipWinRef.current = null;
        setPipOpen(false);
      });

      updatePiPUI(pipWin, timerSecondsLeft, timerMaxSecondsRef.current, isTimerRunning, activeTask?.title || "Deep Focus");
    } catch (e) {
      console.error("Failed to open PiP:", e);
    }
  };

  // Sync timer state changes to PiP window in real-time
  useEffect(() => {
    if (pipWinRef.current && pipOpen) {
      updatePiPUI(pipWinRef.current, timerSecondsLeft, timerMaxSeconds, isTimerRunning, activeTask?.title || "Deep Focus");
    }
  }, [timerSecondsLeft, timerMaxSeconds, isTimerRunning, activeTask?.title, pipOpen]);

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

  // Add time to an in-progress session (e.g. the PiP "+5 min" button) without
  // resetting it. Uses updater-form setters and mutates deadlineRef directly
  // so it stays correct no matter how long the PiP button's closure has been
  // alive — same staleness-safe pattern as the existing resetBtn handler.
  // No-ops once the session has already finished (or while the "keep going"
  // duration picker is open, before a new duration has been chosen), so it
  // can't resurrect or skew a just-completed 0:00 countdown behind the
  // global "session complete" prompt.
  const addTimeToSession = (minutes) => {
    if (sessionCompletePendingRef.current || showExtendPickerRef.current) return;
    const addSecs = Math.round(minutes) * 60;
    setTimerMaxSeconds((m) => m + addSecs);
    setTimerSecondsLeft((s) => s + addSecs);
    if (deadlineRef.current != null) deadlineRef.current += addSecs * 1000;
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
    addTimeToSession,
    pipOpen,
    handleOpenPiP,
  };
}
