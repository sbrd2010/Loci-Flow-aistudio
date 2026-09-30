import { useState, useEffect, useRef } from "react";
import { requestNotifPermission, notifyFocusComplete } from "../utils/focusNotifications";
import { armChime, playChime, chimesOn } from "../utils/chime";
import { buildExtendedTimerState, buildResetFocusState, shouldTriggerSessionComplete, focusBlockSeconds, focusExpiryReason, DEFAULT_BLOCK_MINUTES } from "../utils/focusSession";
import { getFocusWindows, getLociDayStr, lociDayEndsAt } from "../utils/focusWindows";
import { safeUUID } from "../utils/uuid";
import { clockParts, ringGeometry } from "../utils/focusClock";

// Block end (59i): the break it offers, how long it waits for an answer
// before it pauses, and the next block's bounds (Q38.1c).
const BREAK_SECONDS = 5 * 60;
const BLOCK_END_WAIT_MS = 60 * 1000;
const NEXT_MIN = 5;
const NEXT_MAX = 180;

// Lifts the Focus timer state to the App level so it survives tab switches
// (TodayTab unmounts when the user navigates to another tab) and can be
// surfaced via a floating timer across pages.
// `pipActionsRef` holds the mini window's Done and I'm stuck ({ onDone,
// onStuck }), which belong to the app, not the timer.
export function useFocusTimer(tasks, config, uid, pipActionsRef) {
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [timerMaxSeconds, setTimerMaxSeconds] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusSessionActive, setFocusSessionActive] = useState(false);
  const [sessionCompletePending, setSessionCompletePending] = useState(false);
  const [showExtendPicker, setShowExtendPicker] = useState(false);

  // Document Picture-in-Picture (PiP) / Pop-out timer states and refs
  const [pipOpen, setPipOpen] = useState(false);
  // Q38.1d: "Break's over" in the mini window, in place of the title.
  const [pipNotice, setPipNotice] = useState(null);
  // Block end, shared (Q41) — see "Block end" below.
  const [breakUntil, setBreakUntil] = useState(null);
  const [breakOver, setBreakOver] = useState(false);
  const [nextLen, setNextLenState] = useState(DEFAULT_BLOCK_MINUTES);
  const [breakNow, setBreakNow] = useState(() => Date.now());
  // A question open over block end (End session…): the 60 s wait holds.
  const [blockEndHeld, setBlockEndHeld] = useState(false);
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
  // Correlates a focus_started activity-ledger event to its eventual terminal
  // event. Minted by startFocusSession(), consumed exactly once by
  // endFocusSession() — see both below for the exactly-one-terminal-event
  // guarantee this pair provides.
  const focusSessionIdRef = useRef(null);
  const focusStartedAtRef = useRef(null);
  const focusInitialPlannedSecondsRef = useRef(null);
  // The task the in-flight session belongs to, captured at start time — lets
  // endFocusSession() (and startFocusSession()'s auto-close of a still-open
  // prior session, see below) identify which task a terminal event is for
  // without relying on `activeTask`, which may have already moved on to a
  // different task by the time the session actually ends.
  const focusSessionTaskRef = useRef(null);
  // "Keep Going" (extendTimer) restarts timerMaxSeconds/timerSecondsLeft
  // from scratch for a fresh block on the SAME still-open focusSessionId —
  // without accumulating each finished block's numbers here first, the
  // eventual terminal event's focusElapsedSeconds/focusFinalPlannedSeconds
  // would only reflect the final block, silently losing every earlier one
  // (e.g. a 25-min block + a 5-min "keep going" continuation would report
  // only 5 minutes). addTimeToSession (the mid-block "+5" button) already
  // extends timerMaxSeconds/timerSecondsLeft in place rather than resetting
  // them, so it doesn't need this — only extendTimer does.
  const focusSessionAccumulatedElapsedRef = useRef(0);
  const focusSessionAccumulatedPlannedRef = useRef(0);
  // The ledger entry the 00:00 hold already banked for the open session
  // (K4), as { eventId, lociDateString } — null until the bell rings. The
  // hold writes the entry while the session stays OPEN, which is precisely
  // what endFocusSession's null-the-ref one-shot does NOT protect against:
  // that guard stops a second endFocusSession, not a second ENTRY for the
  // same session. Carrying the identity here and handing it back from
  // endFocusSession is what makes the eventual real write amend that entry
  // instead of appending a second one. Lives and dies with focusSessionIdRef
  // — every site that clears one clears the other.
  const focusLedgerEntryRef = useRef(null);
  // 59j's counts for the open session: blocks run (the first, then each new
  // block in the same sitting) and +5s taken. And when it last stopped
  // counting — null while the timer runs — which is what a pause of more than
  // 15 minutes is measured from. All three live and die with focusSessionIdRef.
  const focusBlocksRef = useRef(0);
  // A block set up paused by block end's 60 s wait (59i) is counted only once
  // it runs — never, if the session ends first (Codex review of #433).
  const stagedBlockRef = useRef(false);
  const focusExtensionsRef = useRef(0);
  const focusPausedAtRef = useRef(null);
  // The Loci day the open session began in, and when that day ends — fixed at
  // Start, so editing focus windows mid-session cannot move its expiry or the
  // day it is recorded on (Codex review of #419).
  const focusStartDayRef = useRef(null);
  const focusDayEndsAtRef = useRef(null);
  // Bumped when a pause is found to have run out, so App's expiry check runs
  // now rather than on its next minute tick.
  const [expiryCheck, setExpiryCheck] = useState(0);
  const [focusSessionId, setFocusSessionId] = useState(null);
  // Lets the activeTask-sync effect tell "switched to a different task" apart
  // from a re-run for the same task (only the first starts a fresh block).
  const prevActiveTaskRef = useRef({ uuid: null });
  // Set by startFocusSession when a caller supplies an explicit plannedSeconds
  // override (Coach's one-off duration) — tells the activeTask-sync effect to
  // skip its own task-estimate-derived reset the very next time it would
  // otherwise fire for this task becoming active, so the override isn't
  // immediately stomped the moment `tasks` syncs and activeTask updates.
  // Consumed (cleared) after that single pass so later, unrelated syncs for
  // the same task aren't permanently suppressed.
  const skipNextDurationSyncRef = useRef(false);

  const activeTask = tasks.find((t) => t.isNowFocus && !t.isDeleted && !t.isCompleted) || null;

  // A session is over (59j) the moment a pause passes 15 minutes or the Loci
  // day it began in ends — not when App's check next notices. So the session
  // itself answers: every read of it reports the expiry (below), and nothing
  // may resume or change it meanwhile — a +5 would log an extension, a reset
  // would wipe its work. Codex review of #419.
  const expiryReasonNow = () => {
    if (!focusSessionIdRef.current) return null;
    return focusExpiryReason({
      sessionOpen: true, pausedAt: focusPausedAtRef.current, dayEndsAt: focusDayEndsAtRef.current, now: Date.now(),
    });
  };
  // True (and App asked to close the session now) when it has expired.
  const pauseRanOut = () => {
    if (!expiryReasonNow()) return false;
    setExpiryCheck((n) => n + 1);
    return true;
  };

  const closePiP = () => {
    try {
      if (pipWinRef.current) {
        pipWinRef.current.close();
        pipWinRef.current = null;
      }
    } catch (_) {}
    setPipOpen(false);
  };

  // The mini window (59b): Document Picture-in-Picture, 360 wide, in the
  // app's own tokens (Dark when the app is Dark, Light otherwise; no cyan).
  // A 132 ring with fitted digits, the title on one line, and Pause · +5 ·
  // I'm stuck · Done (filled). Restart is gone; shuffle became I'm stuck.
  const PIP_RING = 132;

  const updatePiPUI = (pipWin, seconds, maxSeconds, running, title) => {
    if (!pipWin) return;
    const doc = pipWin.document;
    const { lead, seconds: ss, hours, lastMinute } = clockParts(seconds, maxSeconds);
    const lEl = doc.getElementById("pt-lead");
    if (lEl) lEl.textContent = `${lead}:`;
    const sEl = doc.getElementById("pt-secs");
    if (sEl) { sEl.textContent = ss; sEl.className = lastMinute ? "is-last" : ""; }
    const tEl = doc.getElementById("pt");
    if (tEl) tEl.style.fontSize = `${ringGeometry(PIP_RING, seconds, maxSeconds, hours).fontSize}px`;
    const labelEl = doc.getElementById("pl");
    if (labelEl) labelEl.textContent = title;
    const playBtn = doc.getElementById("pip-play");
    if (playBtn) playBtn.textContent = running ? "Pause" : "Resume";
    const g = ringGeometry(PIP_RING, seconds, maxSeconds, hours);
    const arc = doc.getElementById("pr-fg");
    if (arc) {
      arc.setAttribute("stroke-dasharray", g.dash);
      arc.setAttribute("stroke-dashoffset", String(g.offset));
      arc.style.display = seconds > 0 ? "" : "none";
    }
    doc.body.className = running ? "" : "is-paused";
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
      const pipWin = await window.documentPictureInPicture.requestWindow({ width: 360, height: 320 });
      pipWinRef.current = pipWin;
      setPipOpen(true);
      const doc = pipWin.document;

      // The app's tokens as they are now: Dark or Light, whichever it shows.
      const css = getComputedStyle(document.documentElement);
      const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      const g = ringGeometry(PIP_RING, timerSecondsLeft, timerMaxSecondsRef.current);
      const style = doc.createElement("style");
      style.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: ${token("--bg", "#F7F4EC")}; --surface: ${token("--surface", "#FFFDF8")};
          --panel: ${token("--panel", "#EAEDE3")}; --line: ${token("--line", "#DCDFD5")};
          --ink: ${token("--ink", "#0F1F16")}; --ink-2: ${token("--ink-2", "#3E5044")};
          --edge: ${token("--edge", "#858B86")}; --accent: ${token("--accent", "#1F4D36")};
          --accent-edge: ${token("--accent-edge", "#133524")}; --on-accent: ${token("--on-accent", "#FFFFFF")};
          --control-edge: ${token("--control-edge", "#858B86")};
        }
        body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
          height: 100vh; padding: 16px; font-family: Manrope, system-ui, sans-serif; color: var(--ink);
          background: var(--bg); user-select: none; overflow: hidden; }
        #ring { position: relative; width: ${PIP_RING}px; height: ${PIP_RING}px; display: grid; place-items: center; flex: 0 0 auto; }
        #ring svg { position: absolute; inset: 0; }
        #pr-bg { fill: none; stroke: var(--panel); }
        #pr-fg { fill: none; stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset 1s linear; }
        body.is-paused #pr-fg { stroke: var(--edge); }
        #pt { position: relative; font-family: 'Space Mono', ui-monospace, monospace; font-weight: 700;
          line-height: 1; font-variant-numeric: tabular-nums; color: var(--ink); }
        #pt-secs { font-size: 0.58em; font-weight: 400; opacity: 0.72; }
        #pt-secs.is-last { font-size: 1em; font-weight: 700; opacity: 1; }
        #pl { max-width: 100%; overflow: hidden; font-size: 14px; font-weight: 700; white-space: nowrap; text-overflow: ellipsis; }
        #pip-btns { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; width: 100%; }
        #pip-btns button { min-height: 36px; padding: 0 6px; font: inherit; font-size: 12px; font-weight: 700;
          color: var(--ink); background: var(--surface); border: 1px solid var(--control-edge); border-radius: 6px;
          cursor: pointer; white-space: nowrap; }
        #pip-btns #pip-done { color: var(--on-accent); background: var(--accent); border-color: var(--accent-edge); }
        #pip-btns button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      `;
      doc.head.appendChild(style);

      const svgNS = "http://www.w3.org/2000/svg";
      const ring = doc.createElement("div");
      ring.id = "ring";
      const svg = doc.createElementNS(svgNS, "svg");
      svg.setAttribute("width", String(PIP_RING));
      svg.setAttribute("height", String(PIP_RING));
      svg.setAttribute("viewBox", `0 0 ${PIP_RING} ${PIP_RING}`);
      svg.setAttribute("aria-hidden", "true");
      const mid = String(PIP_RING / 2);
      for (const id of ["pr-bg", "pr-fg"]) {
        const c = doc.createElementNS(svgNS, "circle");
        c.id = id;
        c.setAttribute("cx", mid);
        c.setAttribute("cy", mid);
        c.setAttribute("r", String(g.r));
        c.setAttribute("stroke-width", String(g.stroke));
        if (id === "pr-fg") c.setAttribute("transform", `rotate(-90 ${mid} ${mid})`);
        svg.appendChild(c);
      }
      ring.appendChild(svg);
      const timeEl = doc.createElement("div");
      timeEl.id = "pt";
      const leadEl = doc.createElement("span");
      leadEl.id = "pt-lead";
      const secsEl = doc.createElement("span");
      secsEl.id = "pt-secs";
      timeEl.append(leadEl, secsEl);
      ring.appendChild(timeEl);
      doc.body.appendChild(ring);

      const labelEl = doc.createElement("div");
      labelEl.id = "pl";
      doc.body.appendChild(labelEl);

      const btnsEl = doc.createElement("div");
      btnsEl.id = "pip-btns";
      const button = (id, text, onClick) => {
        const b = doc.createElement("button");
        b.id = id;
        b.type = "button";
        b.textContent = text;
        b.addEventListener("click", onClick);
        btnsEl.appendChild(b);
      };
      // At block end there is nothing to resume: the block-end choices are
      // the main window's (Codex review of #439).
      button("pip-play", "Pause", () => { if (!sessionCompletePendingRef.current) setIsTimerRunning(r => !r); });
      button("pip-add5", "+5", () => addTimeToSession(5));
      // I'm stuck opens the main window on the focus page (its I'm stuck
      // panel, 59d, arrives with 6c).
      button("pip-stuck", "I’m stuck", () => { try { window.focus(); } catch (_) {} pipActionsRef?.current?.onStuck?.(); });
      button("pip-done", "Done", () => pipActionsRef?.current?.onDone?.());
      doc.body.appendChild(btnsEl);

      pipWin.addEventListener("pagehide", () => {
        pipWinRef.current = null;
        setPipOpen(false);
      });

      updatePiPUI(pipWin, timerSecondsLeft, timerMaxSecondsRef.current, isTimerRunning, pipNotice || activeTask?.title || "Deep Focus");
    } catch (e) {
      console.error("Failed to open PiP:", e);
    }
  };

  // Sync timer state changes to PiP window in real-time
  useEffect(() => {
    if (pipWinRef.current && pipOpen) {
      updatePiPUI(pipWinRef.current, timerSecondsLeft, timerMaxSeconds, isTimerRunning, pipNotice || activeTask?.title || "Deep Focus");
    }
  }, [timerSecondsLeft, timerMaxSeconds, isTimerRunning, activeTask?.title, pipOpen, pipNotice]);

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
    // Drop any in-flight session reference on account switch — never fire a
    // terminal event tagged with the new account's uid for a session that
    // belonged to whoever was signed in before.
    focusSessionIdRef.current = null;
    focusStartedAtRef.current = null;
    focusInitialPlannedSecondsRef.current = null;
    focusSessionTaskRef.current = null;
    focusSessionAccumulatedElapsedRef.current = 0;
    focusSessionAccumulatedPlannedRef.current = 0;
    focusLedgerEntryRef.current = null;
    focusBlocksRef.current = 0;
    stagedBlockRef.current = false;
    focusExtensionsRef.current = 0;
    focusPausedAtRef.current = null;
    focusStartDayRef.current = null;
    focusDayEndsAtRef.current = null;
    setFocusSessionId(null);

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
    // While the 00:00 hold is showing, leave the timer's numbers alone.
    // The branch below keys its reset on !isTimerRunning, which meant "no
    // session is in progress" before K4 — at the hold that is no longer true:
    // the timer is stopped but the session is open, and its elapsed time is
    // already banked in the ledger. Re-deriving from a task estimate edited on
    // another device would set timerMaxSeconds and timerSecondsLeft to the SAME
    // value, making elapsed zero, and the terminal amend (an unguarded update()
    // on the pinned path) would then write that zero over the banked minutes.
    // Both conditions are required: a hold with no open session has nothing to
    // protect, and an open session with no hold still syncs as it always did.
    if (sessionCompletePendingRef.current && focusSessionIdRef.current) {
      prevActiveTaskRef.current = { uuid: activeTask?.uuid ?? null };
      return;
    }
    if (skipNextDurationSyncRef.current) {
      // startFocusSession just applied an explicit plannedSeconds override for
      // this exact task becoming active — leave timerMaxSeconds/timerSecondsLeft
      // alone for this one pass instead of re-deriving them from the task's own
      // estimate, or the override would be overwritten the instant `tasks` syncs.
      skipNextDurationSyncRef.current = false;
      prevActiveTaskRef.current = { uuid: activeTask?.uuid ?? null };
      return;
    }
    // The timer runs one block (53e, 59j), so the task's estimate no longer
    // sets it: a new task, or no open session, starts a fresh block of the
    // Focus timer setting. An open session on the same task is left alone —
    // resetting it while paused would zero the time already worked.
    const blockSecs = focusBlockSeconds(config);
    const sameTask = prev.uuid === (activeTask?.uuid ?? null);
    if (!sameTask || !focusSessionIdRef.current) {
      setTimerMaxSeconds(blockSecs);
      setTimerSecondsLeft(blockSecs);
      if (isTimerRunning) deadlineRef.current = Date.now() + blockSecs * 1000;
    }
    prevActiveTaskRef.current = { uuid: activeTask?.uuid ?? null };
  }, [activeTask?.uuid, config.pomodoroDurationMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isTimerRunning) {
      // Anchor to wall-clock time so background tabs / GC pauses don't cause drift.
      // Reads/writes go through deadlineRef.current (not a local const) so a
      // task switch mid-session (see the activeTask-sync effect above) or a +5
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

  // When the open session stopped counting (a pause, or its block ending), so
  // a pause is measured from when focus stopped; running again clears it.
  // Resuming after the pause has already run out does not: that sitting is
  // over, so the timer stops again and the stop stays on record for App's
  // expiry check, which closes the session (Codex review of #419).
  useEffect(() => {
    if (isTimerRunning) {
      if (pauseRanOut()) { setIsTimerRunning(false); return; }
      focusPausedAtRef.current = null;
    } else if (focusSessionIdRef.current && focusPausedAtRef.current == null) {
      focusPausedAtRef.current = Date.now();
    }
  }, [isTimerRunning, focusSessionId]);

  // Detect the timer reaching 0:00 while running and surface the global
  // "session complete" prompt — lives here (App level, always mounted) so it
  // fires even while the user is on Roadmap/MindBox/Coach/Settings.
  useEffect(() => {
    if (shouldTriggerSessionComplete({ isTimerRunning, timerSecondsLeft })) {
      setIsTimerRunning(false);
      setSessionCompletePending(true);
      // Only when the user is somewhere else. D3's "no sound" is about the
      // session screen, which now shows the hold inline — an alert for
      // something already on screen is the failure event that rule removes.
      // A bell ringing while they are on Coach, Plan or another app still
      // has to reach them, and that is what this call is for.
      if (!isFocusMode) notifyFocusComplete(activeTask?.title);
      // Q40.1: the block-end chime, wherever you are (Settings → Chimes).
      if (chimesOn(config)) playChime();
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
    if (isTimerRunning && stagedBlockRef.current) {
      stagedBlockRef.current = false;
      focusBlocksRef.current += 1;
    }
  }, [isTimerRunning]);

  // Tab title: countdown while running, paused label in overlay, restore otherwise
  useEffect(() => {
    const taskLabel = activeTask?.title || "Deep Focus";
    const mins = Math.floor(timerSecondsLeft / 60);
    const secs = String(timerSecondsLeft % 60).padStart(2, "0");
    if (breakOver) {
      document.title = "Break's over";
    } else if (isTimerRunning && timerSecondsLeft > 0) {
      document.title = `${mins}:${secs} · ${taskLabel}`;
    } else if (isFocusMode && !isTimerRunning && timerSecondsLeft > 0) {
      document.title = `Paused · ${mins}:${secs} · Loci`;
    } else {
      document.title = "Loci";
    }
  }, [timerSecondsLeft, isTimerRunning, isFocusMode, activeTask?.title, breakOver]);

  // Restore title on unmount (e.g. user signs out while timer is running)
  useEffect(() => () => {
    document.title = "Loci";
    closePiP();
  }, []);



  // Q40.1: the chime's audio is unlocked by the first tap or key.
  useEffect(() => { armChime(); }, []);

  // Block end (59i, Q38, Q41): done → a 5-minute break → "Break's over".
  // Kept here, not on the focus page, so every place that shows the session
  // — the focus page, the focus bar, Today's "Back to focus" row and the
  // mini window — shows the same state, and the 60 s wait runs wherever you
  // are.
  const lastLen = Math.max(NEXT_MIN, Math.round(timerMaxSeconds / 60));
  const nextMax = Math.max(NEXT_MAX, lastLen);
  // A new block end offers the length of the block just finished (Q38.1c).
  useEffect(() => {
    if (sessionCompletePending) { setNextLenState(lastLen); return; }
    setBreakUntil(null);
    setBreakOver(false);
  }, [sessionCompletePending]); // eslint-disable-line react-hooks/exhaustive-deps
  const startBreak = () => {
    if (!sessionCompletePendingRef.current) return;
    setBreakNow(Date.now());
    setBreakUntil(Date.now() + BREAK_SECONDS * 1000);
  };
  const startNextBlock = (minutes) => {
    setBreakUntil(null);
    setBreakOver(false);
    extendTimer(minutes || nextLen);
  };
  const setNextLen = (fn) => setNextLenState(m => Math.min(nextMax, Math.max(NEXT_MIN, typeof fn === "function" ? fn(m) : fn)));
  // The break counts down; at its end it asks, with a chime (Q38.1a, d).
  useEffect(() => {
    if (breakUntil == null) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setBreakNow(t);
      if (t >= breakUntil) {
        setBreakUntil(null);
        setBreakOver(true);
        if (chimesOn(config)) playChime();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [breakUntil]); // eslint-disable-line react-hooks/exhaustive-deps
  // No answer in 60 s (not during a break, nor while a question is open):
  // pause on a fresh block — after a break, the one it offered. The block is
  // staged, so no minutes and no block are counted until it runs (Q38.1b).
  // It calls the latest changeFocusDuration (a stale one would bank the
  // finished block again), and does nothing if block end has been left in
  // the meantime (loopcheck of #439).
  const changeFocusDurationRef = useRef(null);
  useEffect(() => {
    if (!sessionCompletePending || breakUntil != null || blockEndHeld) return undefined;
    const id = setTimeout(() => {
      if (!sessionCompletePendingRef.current) return;
      const minutes = breakOver ? nextLen : focusBlockSeconds(config) / 60;
      if (changeFocusDurationRef.current?.(minutes, { staged: true })) setSessionCompletePending(false);
    }, BLOCK_END_WAIT_MS);
    return () => clearTimeout(id);
  }, [sessionCompletePending, breakUntil, blockEndHeld, breakOver, nextLen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Block end is left the moment the timer runs again, however it was
  // started (a length chosen on the way back in, say) — so its break and its
  // 60 s wait can't act on the block that follows.
  useEffect(() => {
    // Only a block with time on it: a Resume at 0:00 isn't a new block, and
    // must not wipe block end (Codex review of #439).
    if (isTimerRunning && timerSecondsLeft > 0 && sessionCompletePendingRef.current) setSessionCompletePending(false);
  }, [isTimerRunning]); // eslint-disable-line react-hooks/exhaustive-deps
  // …and when the session ends, by any path (P2-1 of the loopcheck of #439).
  useEffect(() => {
    if (!focusSessionId && sessionCompletePendingRef.current) setSessionCompletePending(false);
  }, [focusSessionId]);
  // Q38.1d: the mini window says so.
  useEffect(() => { setPipNotice(breakOver ? "Break’s over" : null); }, [breakOver]);
  const blockEndPhase = !sessionCompletePending ? null : breakUntil != null ? "break" : breakOver ? "over" : "done";
  const breakLeft = breakUntil == null ? 0 : Math.max(0, Math.ceil((breakUntil - breakNow) / 1000));

  // Request notification permission when focus overlay opens (already a user interaction)
  useEffect(() => {
    if (isFocusMode) requestNotifPermission();
  }, [isFocusMode]);

  // Dismiss the global "session complete" prompt without restarting the timer
  // (used by the "Finish task" path, which ends the session instead).
  const dismissSessionComplete = () => setSessionCompletePending(false);

  // A new block in the same session: bank the one it replaces. It counts as a
  // block of its own (59j) only if it held any focus — replacing a block
  // before it ran (a length picked on the way in) is still the first block.
  const bankBlock = ({ staged = false } = {}) => {
    if (!focusSessionIdRef.current) return;
    const elapsed = Math.max(0, timerMaxSeconds - timerSecondsLeft);
    focusSessionAccumulatedElapsedRef.current += elapsed;
    focusSessionAccumulatedPlannedRef.current += timerMaxSeconds;
    if (elapsed > 0) {
      if (staged) stagedBlockRef.current = true;
      else focusBlocksRef.current += 1;
    }
  };

  // Restart the timer for the same task with a fresh duration ("Keep going" extension)
  const extendTimer = (minutes) => {
    if (pauseRanOut()) return;
    // Accumulate the block that's ending before resetting timerMaxSeconds/
    // timerSecondsLeft for the new one — the session (focusSessionId) stays
    // the same across "Keep Going", so without this the eventual terminal
    // event would only see the final block's numbers.
    bankBlock();
    const next = buildExtendedTimerState(minutes);
    setTimerMaxSeconds(next.timerMaxSeconds);
    setTimerSecondsLeft(next.timerSecondsLeft);
    setIsTimerRunning(next.isTimerRunning);
    setSessionCompletePending(false);
    setShowExtendPicker(false);
  };

  // Change the duration of an in-progress session (e.g. FocusModePage's
  // duration picker), pausing the timer at the new duration. Same
  // accumulate-before-reset requirement as extendTimer above — without it, a
  // session that ran 10 minutes before the user changed the duration would
  // later report an elapsed time near 0, since endFocusSession only ever
  // sees the current (post-change) block's timerMaxSeconds/timerSecondsLeft.
  // Returns whether the new length was set: not once a pause has run out
  // (the session closes instead), so a caller never restarts it.
  changeFocusDurationRef.current = (...args) => changeFocusDuration(...args);
  const changeFocusDuration = (minutes, { staged = false } = {}) => {
    if (pauseRanOut()) return false;
    bankBlock({ staged });
    setIsTimerRunning(false);
    const secs = minutes * 60;
    setTimerSecondsLeft(secs);
    setTimerMaxSeconds(secs);
    return true;
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
    if (sessionCompletePendingRef.current || showExtendPickerRef.current || pauseRanOut()) return;
    if (focusSessionIdRef.current) focusExtensionsRef.current += 1;
    const addSecs = Math.round(minutes) * 60;
    setTimerMaxSeconds((m) => m + addSecs);
    setTimerSecondsLeft((s) => s + addSecs);
    if (deadlineRef.current != null) deadlineRef.current += addSecs * 1000;
  };

  // Mints a fresh focusSessionId and records session-start metadata, then
  // starts the timer — the single entry point every "start a focus session"
  // call site should use (instead of setIsFocusMode/setIsTimerRunning
  // directly) so a focus_started activity-ledger event can be built from the
  // returned info without each call site duplicating session-start detection.
  //
  // `task` is required so a still-open prior session (see priorSession below)
  // can be attributed to the task it actually belonged to, since by the time
  // a caller gets around to building that terminal event, `activeTask` may
  // have already moved on to the task being started here.
  //
  // `enterFocusMode` (default true) controls whether this also opens the
  // full-screen Focus overlay. Coach-triggered sessions pass false — a chat
  // action starting a background session shouldn't yank the user out of the
  // conversation the way explicitly tapping "Focus" does.
  // `plannedSeconds` (optional) overrides the derived task-estimate duration
  // and is also applied directly to the running timer — used by Coach's
  // START_FOCUS action tag, which can carry its own explicit "|<minutes>"
  // duration distinct from the task's own timeEstimateMinutes. Existing
  // callers that don't pass it are unaffected: timerMaxSeconds/timerSecondsLeft
  // are left for the activeTask-sync effect to derive from the task, exactly
  // as before.
  const startFocusSession = (task, { enterFocusMode = true, plannedSeconds } = {}) => {
    // Auto-close any session that's still open when a new one starts. This
    // hook's state is lifted to App level specifically so it survives
    // navigating away without ending a session (e.g. Day Map's "Start Focus"
    // on a different task while another task's session is still running) —
    // without this, the previous session's focusSessionId would be silently
    // overwritten below, orphaned forever with no terminal event, violating
    // the "every focus_started eventually gets a terminal event" guarantee.
    const priorSession = endFocusSession("user_abandoned");

    const sessionId = safeUUID();
    const startedAt = Date.now();
    // One block of the Focus timer setting, not the task's estimate (53e).
    // Derived here (the same formula as the activeTask-sync effect), NOT read
    // from `timerMaxSeconds` state, which can still hold the previous
    // session's block while a new pin has not yet reached `tasks`.
    const derivedPlannedSeconds = focusBlockSeconds(config);
    const initialPlannedSeconds = Number(plannedSeconds) > 0 ? Number(plannedSeconds) : derivedPlannedSeconds;
    focusSessionIdRef.current = sessionId;
    focusStartedAtRef.current = startedAt;
    focusInitialPlannedSecondsRef.current = initialPlannedSeconds;
    focusSessionTaskRef.current = task;
    focusSessionAccumulatedElapsedRef.current = 0;
    focusSessionAccumulatedPlannedRef.current = 0;
    focusLedgerEntryRef.current = null;
    focusBlocksRef.current = 1;
    stagedBlockRef.current = false;
    focusExtensionsRef.current = 0;
    focusPausedAtRef.current = null;
    const windows = getFocusWindows(config);
    focusStartDayRef.current = getLociDayStr(new Date(startedAt), windows);
    focusDayEndsAtRef.current = lociDayEndsAt(focusStartDayRef.current, windows);
    setFocusSessionId(sessionId);
    if (enterFocusMode) setIsFocusMode(true);
    setIsTimerRunning(true);
    // Always reset to a fresh initialPlannedSeconds — not just when an
    // explicit plannedSeconds override is given. Without this, a genuinely
    // NEW session (e.g. re-tapping Focus on a task that's already
    // activeTask after a prior session on it was properly ended, with time
    // left unused) would keep whatever stale timerSecondsLeft the PREVIOUS
    // session left behind: activeTask?.uuid doesn't change in that case, so
    // the activeTask-sync effect below never re-runs to derive a fresh
    // countdown either.
    setTimerMaxSeconds(initialPlannedSeconds);
    setTimerSecondsLeft(initialPlannedSeconds);
    // A timer already running keeps running, so the ticking effect doesn't
    // re-run to re-anchor: without this its next tick counts down from the
    // previous session's deadline and snaps back to that session's time.
    if (deadlineRef.current != null) deadlineRef.current = startedAt + initialPlannedSeconds * 1000;
    // A new session never inherits the previous one's 00:00 hold. Leaving it
    // set showed the finished session's prompt over a session that had just
    // started — and because the flag was already true, the bell ending THIS
    // session could not transition it false->true, so App's observer never ran
    // and these minutes were never banked. Reachable whenever a start lands
    // while a hold is open, e.g. a Coach START_FOCUS resolving after the
    // current timer rang.
    //
    // Cleared AFTER the countdown is reset, not before: between setting the
    // timer running and giving it a fresh duration, timerSecondsLeft is still
    // the previous session's 0, which is exactly what the bell effect watches
    // for. Clearing first leaves that window free to set the flag straight
    // back to true.
    setSessionCompletePending(false);
    // `task` becoming `activeTask` (once `tasks` syncs) would otherwise
    // trigger the activeTask-sync effect to immediately re-derive/overwrite
    // this value from task.timeEstimateMinutes — suppress that one pass.
    // Only needed when `task` is actually about to become a NEW activeTask
    // (its uuid changing is what re-triggers that effect) — if `task` is
    // already the current activeTask, the effect's deps won't change from
    // this call, so it never runs to consume the flag, and it would
    // otherwise dangle until some later, unrelated task change wrongly
    // consumes it and skips that sync instead.
    if (task?.uuid !== activeTask?.uuid) {
      skipNextDurationSyncRef.current = true;
    }
    return {
      focusSessionId: sessionId, focusStartedAt: startedAt, focusInitialPlannedSeconds: initialPlannedSeconds,
      // Non-null only if a still-open session had to be auto-closed to make
      // room for this one. Callers should build and write ITS terminal event
      // too (priorSession.task, reason "user_abandoned") alongside the new
      // focus_started — this hook can't write activity-ledger events itself
      // (no access to uid/writeActivityEvents), so the caller must.
      priorSession,
    };
  };

  // How much of the open session has been worked: every banked block plus the
  // one running. Screen 3 prints this as "+Nm LOGGED SO FAR", and
  // readOpenSession writes it to the ledger — so they read it from here rather
  // than each deriving it, which is how a label starts disagreeing with what
  // was actually recorded.
  const currentElapsedSeconds = () =>
    focusSessionAccumulatedElapsedRef.current + Math.max(0, timerMaxSeconds - timerSecondsLeft);

  // The open session's numbers, read without consuming it. endFocusSession
  // and the 00:00 hold MUST report the same figures for the same session —
  // the hold's entry is the one the stop then amends — so both read them
  // here rather than each assembling its own copy.
  //
  // An expired session reads as expired whoever ends it — Mark done or End
  // session in the moment before App's check must not record it as done or
  // ended — ending when focus last stopped, on the day it began (unless its
  // block's entry already carries a day).
  const readOpenSession = (focusEndReason) => {
    const sessionId = focusSessionIdRef.current;
    if (!sessionId) return null;
    const entry = focusLedgerEntryRef.current;
    const expired = expiryReasonNow();
    // It ends when focus stopped — and no later than the end of its day, so
    // time counted past the boundary (up to the check, or longer in a
    // background tab) is not credited to it (Codex review of #419).
    const stopAt = focusPausedAtRef.current ?? Date.now();
    const startDay = focusStartDayRef.current;
    const endAt = expired === "day_ended" ? Math.min(stopAt, focusDayEndsAtRef.current) : stopAt;
    const elapsed = expired
      ? Math.max(focusSessionAccumulatedElapsedRef.current, Math.round(currentElapsedSeconds() - (stopAt - endAt) / 1000))
      : currentElapsedSeconds();
    return {
      focusSessionId: sessionId,
      focusStartedAt: focusStartedAtRef.current,
      focusInitialPlannedSeconds: focusInitialPlannedSecondsRef.current,
      // Sum of every earlier "Keep Going" block's numbers plus the current
      // (final) block's — see extendTimer's accumulation above.
      focusFinalPlannedSeconds: focusSessionAccumulatedPlannedRef.current + timerMaxSeconds,
      focusElapsedSeconds: elapsed,
      focusEndReason: expired || focusEndReason,
      focusBlocks: focusBlocksRef.current,
      focusExtensions: focusExtensionsRef.current,
      // When it stopped counting, or null while running: an expired session
      // ends here, not at the moment the expiry was noticed.
      focusPausedAt: focusPausedAtRef.current,
      task: focusSessionTaskRef.current,
      // Spread only when the hold actually banked an entry: the keys have to
      // be ABSENT otherwise, not present-and-undefined, so a caller passing
      // this straight into buildFocusTerminalEvent mints a fresh id for an
      // ordinary session and pins the held one only when there is one.
      ...(expired ? { focusEndedAt: endAt, lociDateString: startDay } : {}),
      ...(entry ? { eventId: entry.eventId, lociDateString: entry.lociDateString } : {}),
    };
  };

  // Read the open session without ending it — what the 00:00 hold needs to
  // bank its entry while the session stays open for a possible "+Nm".
  const peekFocusSession = (focusEndReason) => readOpenSession(focusEndReason);

  // Record the entry the hold just wrote, so every later terminal write for
  // this session amends it instead of appending beside it. Ignored once the
  // session is gone (nothing to amend) and never overwritten once set — a
  // session banks exactly one entry, and a second bell on the same session
  // is a re-ring of the hold, not a new entry to write.
  const markFocusLedgerEntry = (entry) => {
    if (!focusSessionIdRef.current) return null;
    if (focusLedgerEntryRef.current) return focusLedgerEntryRef.current;
    if (!entry?.eventId || !entry?.lociDateString) return null;
    focusLedgerEntryRef.current = { eventId: entry.eventId, lociDateString: entry.lociDateString };
    return focusLedgerEntryRef.current;
  };

  // Consumes the active session (if any) and returns everything needed to
  // build its terminal (focus_completed/focus_abandoned) event, or null if
  // there's nothing to end — either no session was ever started, or an
  // earlier call already consumed it. This is what guarantees at most one
  // terminal event per focusSessionId no matter which UI path ends it.
  const endFocusSession = (focusEndReason) => {
    const result = readOpenSession(focusEndReason);
    if (!result) return null;
    focusSessionIdRef.current = null;
    focusStartedAtRef.current = null;
    focusInitialPlannedSecondsRef.current = null;
    focusSessionTaskRef.current = null;
    focusSessionAccumulatedElapsedRef.current = 0;
    focusSessionAccumulatedPlannedRef.current = 0;
    focusLedgerEntryRef.current = null;
    focusBlocksRef.current = 0;
    stagedBlockRef.current = false;
    focusExtensionsRef.current = 0;
    focusPausedAtRef.current = null;
    focusStartDayRef.current = null;
    focusDayEndsAtRef.current = null;
    setFocusSessionId(null);
    return result;
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
    changeFocusDuration,
    addTimeToSession,
    pipOpen,
    handleOpenPiP,
    setPipNotice,
    // Block end, shared (Q41): { phase: "done" | "break" | "over" | null,
    // breakLeft, breakSeconds, nextLen, nextMin, nextMax }.
    blockEnd: { phase: blockEndPhase, breakLeft, breakSeconds: BREAK_SECONDS, nextLen, nextMin: NEXT_MIN, nextMax },
    startBreak, startNextBlock, setNextLen, setBlockEndHeld,
    // Q39.2: the pin is about to move while this session is held open (a
    // split from I'm stuck, or its Undo) — keep the block's numbers, or its
    // elapsed time would be reset to a full block (Codex review of #436).
    keepTimerOnTaskChange: (on = true) => { skipNextDurationSyncRef.current = on; },
    focusSessionId, startFocusSession, endFocusSession,
    // When the open session began — screen 3 prints it as "STARTED 09:41".
    // Read from the ref each render rather than held in state: it is set once
    // per session and never changes within one, so it needs no re-render of
    // its own.
    focusStartedAt: focusStartedAtRef.current,
    // Which block of the session is running (59a's "BLOCK 2 OF 25 MIN"):
    // read from the ref each render, as focusStartedAt is.
    focusBlockNumber: focusBlocksRef.current + (stagedBlockRef.current ? 1 : 0),
    // What screen 3's "+Nm LOGGED SO FAR" reports. Whole-session, not
    // current-block: after a "Keep Going" extension the earlier blocks live in
    // the accumulator, and a figure ignoring them tells the user they logged
    // five minutes while the ledger holds thirty.
    focusElapsedSeconds: currentElapsedSeconds(),
    peekFocusSession, markFocusLedgerEntry,
    // Changes when a pause is found to have run out; App's expiry check
    // watches it.
    expiryCheck,
    // Which task the currently open session (if any) actually belongs to —
    // NOT necessarily the same as `activeTask`, which reflects the current
    // isNowFocus pin and can point at a different task than the still-open
    // session when something retargeted the pin via a raw pin-only action
    // instead of startFocusSession()/endFocusSession(). Callers deciding
    // "reopen vs. start fresh" (e.g. Day Map's Start Focus) need this, not
    // just whether focusSessionId is truthy.
    focusSessionTaskUuid: focusSessionTaskRef.current?.uuid ?? null,
  };
}
