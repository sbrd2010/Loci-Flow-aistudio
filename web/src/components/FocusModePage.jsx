import React, { useEffect, useRef, useState } from "react";
import { minutesFromSeconds } from "../utils/focusLedger";
import { getTimerState } from "../utils/focusSession";
import { BINAURAL_TRACK_ID } from "../utils/binauralBeat";
import { SOUND_CATEGORIES, getCategoryKeyForTrack, getTrackTitle } from "../utils/soundLibrary";
import { taskSteps } from "../utils/taskSteps";
import { titleLength } from "./TodayWall";
import FocusClock from "./FocusClock";
import LinkifyText from "./LinkifyText";
import { IconCheck, IconX } from "./ui/icons";
import "../styles/focusMode.css";

const PIP_SUPPORTED = "documentPictureInPicture" in window;

const FIVE_MINUTES_SECONDS = 5 * 60;

// "Restart with a new length" (59g): a fresh block in the same session.
const RESTART_LENGTHS = [5, 25, 50];

// Block end (59i): the break it offers first, and how long it waits for an
// answer before it pauses — it never runs on silently.
const BREAK_SECONDS = 5 * 60;
const BLOCK_END_WAIT_MS = 60 * 1000;

// "1:05" — the session so far, in hours and minutes.
const hoursMinutes = (m) => `${Math.floor(m / 60)}:${String(Math.round(m) % 60).padStart(2, "0")}`;

// "3H", "1H05M", "25M" — the kicker's figures.
function spanLabel(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (!h) return `${m}M`;
  return m % 60 ? `${h}H${String(m % 60).padStart(2, "0")}M` : `${h}H`;
}

// The ring's size by screen width (59a–c, Q37.4): 248 on a phone, 280 on a
// tablet held upright, 300 from 900px, 380 wide, 460 at 2200 and wider.
function ringSize(width) {
  if (width >= 2200) return 460;
  if (width >= 1600) return 380;
  if (width >= 1024) return 320;
  if (width >= 900) return 300;
  if (width >= 600) return 280;
  return 248;
}

// The focus session (59a, phone 59c; Numbers 58a–b). The stage — kicker,
// title, next step, actions — with the clock beside it; from 1600px a panel
// on the right holds the steps, sound and a place to park a thought. Paused
// (59g) it offers Resume, Mark done, End session and a fresh block of a new
// length. End session (59h) asks first and can keep where you stopped as the
// next step. At 0:00, block end (59i): a 5-minute break then the next block
// (Enter), another block, +5, Mark done or End session; no answer in 60 s and
// it pauses.
export default function FocusModePage({
  task,
  secondsLeft,
  maxSeconds,
  isRunning,
  onPlayPause,
  onDone,
  onExit,
  // Another screen (Rescue) is open on top: its keys are its own.
  keysOff = false,
  // 59i: a new block of `minutes` in the same session, running at once (it
  // also clears the completion state).
  onKeepGoing,
  // 59i: no answer at block end — pause on a fresh block of `blockMinutes`.
  onBlockTimeout,
  blockMinutes = 25,
  // +5 min on a running block (45b), not the hold's extension.
  onAddTime,
  // 59g: a fresh block of `minutes` in the same session.
  onRestart,
  // 59h: { note, tomorrow } — the session ends; the note becomes the next
  // step; tomorrow moves the task there.
  onEndSession,
  onToggleStep,
  startedAt,
  elapsedSeconds,
  blockNumber = 1,
  clockMode = "ring",
  // Q37.2: minutes on this task today before this session (the ledger's);
  // this session's are added live.
  taskMinutesToday = 0,
  onAddBrainDump,
  onRescue,
  pipOpen,
  onOpenPiP,
  selectedTrack,
  volume,
  trackLoadState,
  selectTrack,
  selectCategory,
  reshuffleTrack,
  changeVolume,
}) {
  const isComplete = secondsLeft === 0;
  // Addendum D: the five-minute session is "the same FocusSession, three
  // deltas", not a new component. Keyed off the planned length rather than a
  // flag, so a task whose own estimate is five minutes reads the same way.
  const isFiveMinute = maxSeconds === FIVE_MINUTES_SECONDS;

  const activeSoundKey = selectedTrack ? (getCategoryKeyForTrack(selectedTrack) || selectedTrack) : "none";

  const [dumpText, setDumpText] = useState("");
  const [dumpSaved, setDumpSaved] = useState(false);
  const dumpInputRef = useRef(null);
  const [showSoundsDrawer, setShowSoundsDrawer] = useState(false);
  // 59h: the End session question, and its optional "Where did you stop?".
  const [ending, setEnding] = useState(false);
  const [stopNote, setStopNote] = useState("");
  // 59i: the break after a block — when it ends (ms), and a tick to count it.
  const [breakUntil, setBreakUntil] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const onKeepGoingRef = useRef(onKeepGoing);
  onKeepGoingRef.current = onKeepGoing;
  const onBlockTimeoutRef = useRef(onBlockTimeout);
  onBlockTimeoutRef.current = onBlockTimeout;
  const blockMinutesRef = useRef(blockMinutes);
  blockMinutesRef.current = blockMinutes;

  const [width, setWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1280));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const wide = width >= 1600;
  // Q37.4: from 900px (a tablet on its side) to 1023 the panel sits below
  // the stage; from 1600 beside it.
  const panelBelow = width >= 900 && width < 1024;

  const submitDump = () => {
    if (!dumpText.trim()) return;
    onAddBrainDump?.(dumpText.trim());
    setDumpText("");
    setDumpSaved(true);
    setTimeout(() => setDumpSaved(false), 1500);
  };

  const timerState = getTimerState(secondsLeft, maxSeconds);
  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const stateLabel = isComplete ? "Complete" : isRunning ? "In progress" : "Paused";
  // Whole-session, from the hook's own figure (the ledger's conversion), not
  // this block's: after "Keep going" the block alone contradicts the ledger.
  const loggedMinutes = minutesFromSeconds(
    Number.isFinite(Number(elapsedSeconds)) ? Number(elapsedSeconds) : Math.max(0, maxSeconds - secondsLeft)
  );
  const loggedLabel = isFiveMinute && loggedMinutes >= 1 ? `${loggedMinutes}m` : null;
  const startedLabel = Number(startedAt) > 0
    ? new Date(Number(startedAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  const blockLabel = `${Math.floor(maxSeconds / 60)}:${String(maxSeconds % 60).padStart(2, "0")}`;
  const endsLabel = isRunning && !isComplete
    ? new Date(Date.now() + secondsLeft * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  const notStarted = !isRunning && !isComplete && !(Number(elapsedSeconds) > 0) && secondsLeft === maxSeconds;
  const paused = !isRunning && !isComplete && !notStarted;

  const steps = taskSteps(task);
  const nextStep = steps.find(st => !st.done && st.text);
  const stepIndex = nextStep ? steps.indexOf(nextStep) + 1 : steps.length;
  const estimate = Number(task.timeEstimateMinutes) || 0;

  const openEnd = () => { setStopNote(""); setEnding(true); };
  const startBreak = () => { setBreakUntil(Date.now() + BREAK_SECONDS * 1000); setNowMs(Date.now()); };
  const continueNow = () => { setBreakUntil(null); onKeepGoing?.(blockMinutes); };

  // The break counts down, then the next block starts on its own.
  useEffect(() => {
    if (breakUntil == null) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      if (t >= breakUntil) { setBreakUntil(null); onKeepGoingRef.current?.(blockMinutesRef.current); }
    }, 1000);
    return () => clearInterval(id);
  }, [breakUntil]);
  // Leaving block end any other way (Mark done, End, Another) ends the break.
  useEffect(() => { if (!isComplete) setBreakUntil(null); }, [isComplete]);
  // No answer in 60 s (not while the question or a break is open): pause.
  useEffect(() => {
    if (!isComplete || breakUntil != null || ending) return undefined;
    const id = setTimeout(() => onBlockTimeoutRef.current?.(), BLOCK_END_WAIT_MS);
    return () => clearTimeout(id);
  }, [isComplete, breakUntil, ending]);
  const breakLeft = breakUntil == null ? 0 : Math.max(0, Math.ceil((breakUntil - nowMs) / 1000));
  const endSession = (tomorrow) => { setEnding(false); onEndSession?.({ note: stopNote, tomorrow }); };

  // Keys (45l, 59a–h): Space pauses, D marks done, E asks to end, P opens the
  // mini window, Esc leaves. Not while typing, not while Rescue is open, and
  // Esc closes the sounds drawer or the question first. A held key fires once.
  const keysRef = useRef({});
  keysRef.current = { isComplete, showSoundsDrawer, ending, onPlayPause, onDone, onExit, onOpenPiP, pipOpen, keysOff, openEnd, onEndSession, breaking: breakUntil != null, startBreak };
  useEffect(() => {
    const onKey = (e) => {
      const k = keysRef.current;
      if (k.keysOff || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (k.ending) return; // the question has its own keys
      if (e.key === "Escape" && k.showSoundsDrawer) { setShowSoundsDrawer(false); return; }
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.repeat) return;
      if (e.key === "Escape") {
        if (!k.isComplete) { e.preventDefault(); k.onExit?.(); }
        return;
      }
      // 59i: at block end, Enter takes the break.
      if (k.isComplete && e.key === "Enter" && !k.breaking && !(t && t.tagName === "BUTTON")) { e.preventDefault(); k.startBreak(); return; }
      if (k.isComplete || k.showSoundsDrawer) return;
      if (e.key === " " && !(t && (t.tagName === "BUTTON" || t.tagName === "A"))) { e.preventDefault(); k.onPlayPause?.(); }
      else if (e.key === "d" || e.key === "D") { e.preventDefault(); k.onDone?.(); }
      else if ((e.key === "e" || e.key === "E") && k.onEndSession) { e.preventDefault(); k.openEnd(); }
      else if ((e.key === "p" || e.key === "P") && PIP_SUPPORTED && !k.pipOpen && k.onOpenPiP) { e.preventDefault(); k.onOpenPiP(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const kicker = isFiveMinute
    ? (isComplete ? "FIVE MINUTES · DONE" : "FIVE MINUTES · THAT'S ALL")
    : "FOCUS";
  // Q37.1–2: one line — what this is, the task's estimate, and what is done
  // on it today (every session, this one included).
  const doneToday = Math.max(0, Number(taskMinutesToday) || 0) + loggedMinutes;
  const stageKicker = [
    task.isNowFocus ? "TODAY, ONE THING" : "FOCUS",
    estimate > 0 ? `${spanLabel(estimate)} TASK` : null,
    doneToday >= 1 ? `${spanLabel(doneToday)} DONE` : null,
  ].filter(Boolean).join(" · ");

  const doneButton = (filled) => (
    <button
      type="button"
      className={`focus-mode-done-btn${filled ? "" : " is-quiet"}`}
      onClick={onDone}
      aria-label={loggedLabel ? `Mark task complete and log ${loggedMinutes} minutes` : "Mark done"}
    >
      <span>{loggedLabel ? `Done — log ${loggedLabel}` : "Mark done"}</span>
      <IconCheck size={18} />
      <kbd className="focus-mode-kbd">D</kbd>
    </button>
  );
  const playButton = (filled) => (
    <button
      type="button"
      className={`focus-mode-ctrl-btn${filled ? " is-filled" : ""}`}
      data-testid="timer-play-pause"
      onClick={onPlayPause}
      aria-label={isRunning ? "Pause timer" : notStarted ? "Start timer" : "Resume timer"}
    >
      {isRunning ? "Pause" : notStarted ? "Start" : "Resume"}
      <kbd className="focus-mode-kbd">Space</kbd>
    </button>
  );

  const soundsButton = (
    <button
      type="button"
      className={`focus-mode-extra-link focus-mode-sounds-btn${showSoundsDrawer ? " active" : ""}`}
      onClick={() => setShowSoundsDrawer(prev => !prev)}
      aria-label="Open sounds menu"
    >
      Sound{selectedTrack ? ` · ${activeSoundKey === BINAURAL_TRACK_ID ? "Binaural" : (SOUND_CATEGORIES[activeSoundKey]?.title || "On")}` : " · Off"}
    </button>
  );
  const parkRow = onAddBrainDump && (
    <div className="focus-mode-dump-row">
      <input
        ref={dumpInputRef}
        type="text"
        className="focus-mode-dump-input"
        placeholder="A stray thought? Park it here"
        value={dumpText}
        onChange={e => setDumpText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submitDump(); }}
        aria-label="Capture a thought to Brain Dump"
      />
      <button
        type="button"
        className={`focus-mode-dump-btn${dumpSaved ? " saved" : ""}`}
        onClick={submitDump}
        aria-label="Save thought to Brain Dump"
      >
        {dumpSaved ? "Saved" : "Save"}
      </button>
    </div>
  );

  return (
    <div
      className={`focus-mode-overlay${isRunning ? " is-running" : ""}${isComplete ? " is-complete" : ""}${paused ? " is-paused" : ""}${wide ? " is-wide" : ""} timer-state-${timerState}`}
    >
      <header className="focus-mode-head">
        <p className="focus-mode-kicker">
          <span className="focus-mode-header-label">{kicker}</span>
          {/* Q37.1: "FOCUS · BLOCK 1" — no day or block end up here. */}
          <span className="fm-head-meta"> · BLOCK {Math.max(1, blockNumber)}</span>
          <span className="sr-only"> · {stateLabel}</span>
        </p>
        <div className="fm-head-actions">
          {PIP_SUPPORTED && !pipOpen && onOpenPiP && !isComplete && (
            <button type="button" className="fm-head-btn focus-mode-pip-btn" onClick={onOpenPiP} aria-label="Open the mini window">
              Mini window <kbd className="focus-mode-kbd">P</kbd>
            </button>
          )}
          {/* Hidden at 00:00: the hold offers two choices, and a plain exit
              that left the session open would be a third that behaves like
              neither. "Stop here" is the way out then. */}
          {!isComplete && (
            <button type="button" className="focus-mode-exit-btn" onClick={onExit} aria-label="Leave focus">
              <span className="focus-mode-leave-word">Leave</span>
              <kbd className="focus-mode-kbd">Esc</kbd>
              <IconX size={22} />
            </button>
          )}
        </div>
      </header>
      {/* Q37.1e: the stage is centred, never more than 120px below the header. */}
      <div className="fm-spacer" aria-hidden="true" />

      <main className="focus-mode-body" aria-label="Deep focus session">
        <section className="focus-mode-task-panel" aria-label="Focused task">
          <p className="fm-stage-kicker">{stageKicker}</p>
          <h1 className="focus-mode-task-title" data-len={titleLength(task.title)}><LinkifyText text={task.title} /></h1>
          {nextStep && (
            <p className="focus-mode-concrete-step">Next step — <LinkifyText text={nextStep.text} /></p>
          )}
        </section>

        <div className="focus-mode-timer-block">
          {breakUntil != null ? (
            // 59i: the break, counted on the same clock.
            <FocusClock
              mode={clockMode}
              size={ringSize(width)}
              secondsLeft={breakLeft}
              maxSeconds={BREAK_SECONDS}
              valueText={`Break: ${Math.floor(breakLeft / 60)} minutes ${breakLeft % 60} seconds left`}
            />
          ) : (
            <FocusClock
              mode={clockMode}
              size={ringSize(width)}
              secondsLeft={secondsLeft}
              maxSeconds={maxSeconds}
              paused={!isRunning}
              valueText={`${mins} minutes ${secs} seconds left of ${blockLabel}`}
            />
          )}
          {/* Q37.1: "OF 25:00", then "STARTED · ENDS" under it. */}
          <p className="focus-mode-figures">
            <span className="fm-figures-of">OF {blockLabel}</span>
            {(startedLabel || endsLabel) && (
              <span className="fm-figures-times">
                {startedLabel && <span className="focus-mode-started">STARTED {startedLabel}{endsLabel ? " · " : ""}</span>}
                {endsLabel && <span>ENDS {endsLabel}</span>}
              </span>
            )}
          </p>
        </div>

        {/* 59i: block end. The block's minutes are already in the ledger;
            the timer waits for an answer, and pauses after 60 s. */}
        {isComplete ? (
          <div className="focus-mode-hold-actions fm-block-end" role="group" aria-label="Block done">
            <p className="fm-block-end-kicker">BLOCK {Math.max(1, blockNumber)} DONE · SESSION {hoursMinutes(loggedMinutes)}</p>
            {breakUntil != null ? (
              <>
                <p className="fm-block-end-note">A break. Block {Math.max(1, blockNumber) + 1} starts when it ends.</p>
                <button type="button" className="focus-mode-hold-keep" onClick={continueNow}>Skip the break</button>
                <div className="focus-mode-controls">
                  <button type="button" className="focus-mode-ctrl-btn" onClick={openEnd}>End session</button>
                </div>
              </>
            ) : (
              <>
                {estimate > 0 && loggedMinutes >= estimate * 1.5 && loggedMinutes - estimate >= 15 && (
                  <p className="fm-block-end-note">
                    This session is {spanLabel(loggedMinutes - estimate).toLowerCase()} past the task’s {spanLabel(estimate).toLowerCase()} estimate. A short break may help.
                  </p>
                )}
                <button type="button" className="focus-mode-hold-keep" onClick={startBreak}>
                  5-minute break, then continue <kbd className="focus-mode-kbd">Enter</kbd>
                </button>
                <div className="focus-mode-controls">
                  <button type="button" className="focus-mode-ctrl-btn" onClick={() => onKeepGoing?.(blockMinutes)}>Another {blockMinutes}m</button>
                  <button type="button" className="focus-mode-ctrl-btn" onClick={() => onKeepGoing?.(5)}>+5 min</button>
                  <button type="button" className="focus-mode-ctrl-btn" onClick={onDone}>Mark done</button>
                  {onEndSession && <button type="button" className="focus-mode-ctrl-btn" onClick={openEnd}>End session</button>}
                </div>
              </>
            )}
          </div>
        ) : paused ? (
          // 59g: Resume first; a fresh block of a new length only from here.
          <div className="focus-mode-actions">
            <div className="focus-mode-controls" aria-label="Timer controls">
              {playButton(true)}
              {doneButton(false)}
              {onEndSession && (
                <button type="button" className="focus-mode-ctrl-btn" onClick={openEnd}>
                  End session <kbd className="focus-mode-kbd">E</kbd>
                </button>
              )}
            </div>
            {onRestart && (
              <div className="fm-restart" role="group" aria-label="Restart with a new length">
                <span className="fm-restart-label">Restart with a new length</span>
                {RESTART_LENGTHS.map(m => (
                  <button key={m} type="button" className="focus-mode-dur-btn" onClick={() => onRestart(m)}>{m}m</button>
                ))}
                {estimate > 0 && (
                  <button type="button" className="focus-mode-dur-btn" onClick={() => onRestart(estimate)}>Whole task</button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="focus-mode-actions">
            {doneButton(true)}
            <div className="focus-mode-controls" aria-label="Timer controls">
              {playButton(false)}
              {onAddTime && (
                <button type="button" className="focus-mode-ctrl-btn" onClick={() => onAddTime(5)} aria-label="Add 5 minutes">
                  +5 min
                </button>
              )}
              {onRescue && (
                <button type="button" className="focus-mode-ctrl-btn focus-mode-rescue-btn" onClick={onRescue}>
                  I&apos;m stuck
                </button>
              )}
            </div>
          </div>
        )}

        {/* From 1600px the steps, sound and a place to park a thought sit in
            the panel; below it, sound and parking under the actions. */}
        {!isComplete && (wide || panelBelow ? (
          <aside className={`fm-panel${panelBelow ? " is-below" : ""}`} aria-label="Steps, sound and a stray thought">
            {steps.length > 0 && (
              <section className="fm-panel-section">
                <h2 className="fm-panel-head">Steps <span>{stepIndex} OF {steps.length}</span></h2>
                <ul className="fm-steps">
                  {steps.map(st => (
                    <li key={st.id}>
                      <label className={`fm-step${st.done ? " is-done" : ""}`}>
                        <input type="checkbox" checked={!!st.done} onChange={() => onToggleStep?.(st.id)} disabled={!onToggleStep} />
                        <span>{st.text}</span>
                        {st === nextStep && <span className="fm-step-now">NOW</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="fm-panel-section">
              <h2 className="fm-panel-head">Sound</h2>
              {soundsButton}
            </section>
            {parkRow && (
              <section className="fm-panel-section">
                <h2 className="fm-panel-head">Park a stray thought</h2>
                {parkRow}
              </section>
            )}
          </aside>
        ) : (
          <>
            <div className="focus-mode-extras">{soundsButton}</div>
            {parkRow}
          </>
        ))}
      </main>

      {/* 59h: ending asks first. The minutes are saved either way; the task
          stays open, or goes to tomorrow. */}
      {ending && (
        <div className="fm-end-scrim" onClick={() => setEnding(false)}>
          <div
            className="fm-end"
            role="dialog"
            aria-modal="true"
            aria-label="End this session?"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === "Escape") { e.preventDefault(); setEnding(false); }
              // Enter ends it — except on a button, which is its own.
              else if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); endSession(false); }
            }}
          >
            <h2 className="fm-end-title">End this session?</h2>
            <p className="fm-end-text">
              {loggedMinutes} {loggedMinutes === 1 ? "minute" : "minutes"} of focus {loggedMinutes === 1 ? "is" : "are"} saved. The task stays open.
            </p>
            <label className="fm-end-field">
              <span>Where did you stop? <span className="fm-end-optional">Optional</span></span>
              {/* The next step is stored as concreteStep, which the database caps
                  at 300 characters (Codex review of #432). */}
              <input autoFocus maxLength={300} value={stopNote} onChange={e => setStopNote(e.target.value)} placeholder="It becomes the next step" />
            </label>
            <div className="fm-end-actions">
              <button type="button" className="focus-mode-done-btn" onClick={() => endSession(false)}>
                End session <kbd className="focus-mode-kbd">Enter</kbd>
              </button>
              <button type="button" className="focus-mode-ctrl-btn" onClick={() => endSession(true)}>End and move to tomorrow</button>
              <button type="button" className="focus-mode-ctrl-btn" onClick={() => setEnding(false)}>Keep going</button>
            </div>
          </div>
        </div>
      )}

      {showSoundsDrawer && (
        <div className="focus-sounds-backdrop" onClick={() => setShowSoundsDrawer(false)} />
      )}

      <div className={`focus-sounds-drawer${showSoundsDrawer ? " open" : ""}`} aria-hidden={!showSoundsDrawer}>
        <div className="focus-sounds-header">
          <h3>Focus sounds</h3>
          <button
            type="button"
            className="focus-sounds-close-btn"
            onClick={() => setShowSoundsDrawer(false)}
            aria-label="Close sounds menu"
            tabIndex={showSoundsDrawer ? 0 : -1}
          >
            <IconX size={20} />
          </button>
        </div>

        <div className="focus-sounds-content">
          <div className="focus-sounds-tiles">
            {[
              { id: "none", title: "None", desc: "Silent focus" },
              { id: "rain", title: SOUND_CATEGORIES.rain.title, desc: "Real rain tracks" },
              { id: "nature", title: SOUND_CATEGORIES.nature.title, desc: "Forest & river" },
              { id: "lofi", title: SOUND_CATEGORIES.lofi.title, desc: "Downtempo beats" },
              { id: "jazz", title: SOUND_CATEGORIES.jazz.title, desc: "Smooth jazz" },
              { id: "piano", title: SOUND_CATEGORIES.piano.title, desc: "Cozy piano" },
              { id: "chillhop", title: SOUND_CATEGORIES.chillhop.title, desc: "Melodic beats" },
              { id: BINAURAL_TRACK_ID, title: "Binaural 40Hz", desc: "Focus tone (use headphones)" }
            ].map(track => {
              const isActive = activeSoundKey === track.id;
              const isAmbientCategory = Boolean(SOUND_CATEGORIES[track.id]);
              return (
                <div key={track.id} className="sound-tile-row">
                  <button
                    type="button"
                    className={`sound-tile${isActive ? " active" : ""}`}
                    onClick={() => isAmbientCategory ? selectCategory(track.id) : selectTrack(track.id)}
                    aria-pressed={isActive}
                    tabIndex={showSoundsDrawer ? 0 : -1}
                  >
                    <div className="sound-tile-info">
                      <div className="sound-tile-title">{track.title}</div>
                      <div className="sound-tile-desc">
                        {isActive && isAmbientCategory
                          ? (trackLoadState === "loading" ? "Loading…"
                            : trackLoadState === "error" ? "Couldn't load. Try another."
                            : getTrackTitle(selectedTrack))
                          : track.desc}
                      </div>
                    </div>
                  </button>
                  {isActive && isAmbientCategory && (
                    <button
                      type="button"
                      className="sound-tile-shuffle"
                      onClick={() => reshuffleTrack()}
                      aria-label="Play a different variation"
                      tabIndex={showSoundsDrawer ? 0 : -1}
                    >
                      Another
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="focus-sounds-volume-section">
            <div className="volume-label-row">
              <span>Volume</span>
              <span>{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={e => changeVolume(parseFloat(e.target.value))}
              className="focus-sounds-volume-slider"
              aria-label="Adjust volume"
              tabIndex={showSoundsDrawer ? 0 : -1}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
