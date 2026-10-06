import React, { useEffect, useRef, useState } from "react";
import GrowTextarea from "./ui/GrowTextarea";
import { minutesFromSeconds } from "../utils/focusLedger";
import { getTimerState } from "../utils/focusSession";
import { BINAURAL_TRACK_ID } from "../utils/binauralBeat";
import { SOUND_CATEGORIES, getCategoryKeyForTrack, getTrackTitle } from "../utils/soundLibrary";
import { taskSteps } from "../utils/taskSteps";
import { isWellOver, markNoteSeen, noteDue, reestimateChoices } from "../utils/blockEnd";
import { titleLength } from "./TodayWall";
import FocusClock from "./FocusClock";
import EndSessionDialog from "./EndSessionDialog";
import StuckSheet from "./StuckSheet";
import LinkifyText from "./LinkifyText";
import { IconCheck, IconX } from "./ui/icons";
import { THOUGHTS_MAX } from "../utils/thoughts";
import "../styles/focusMode.css";
import { cssZoom } from "../utils/cssZoom";

const PIP_SUPPORTED = "documentPictureInPicture" in window;

const FIVE_MINUTES_SECONDS = 5 * 60;
const LAST_SOUND_KEY = "loci_last_focus_sound";

// "Restart with a new length" (59g): a fresh block in the same session.
const RESTART_LENGTHS = [5, 25, 50];

// The over-estimate note, once per task per day on this device (Q40.2).
const NOTE_SEEN_KEY = "loci_over_estimate_note";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(NOTE_SEEN_KEY) || "{}") || {}; } catch { return {}; } };
const writeSeen = (v) => { try { localStorage.setItem(NOTE_SEEN_KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const lower = (m) => spanLabel(m).toLowerCase();

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
// it pauses. I'm stuck (59d) pauses and offers four ways forward.
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
  blockMinutes = 25,
  // Block end, shared with the bar and Today (Q41; useFocusTimer): phase
  // "done" | "break" | "over", the break's seconds left, the next block.
  blockEnd = null,
  onStartBreak,
  onStartNext,
  onSetNextLen,
  // A question is open over block end: its 60 s wait holds.
  onHoldBlockEnd,
  // Q40.3: Re-estimate, in minutes. And today's Loci day, for Q40.2.
  onReestimate,
  dayKey = "",
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
  // Q39.2: piece 1 of a split from I'm stuck, not started: { n, onUndo }.
  splitNote = null,
  // "N parked this session".
  parkedCount = 0,
  // 59d, I'm stuck: a smaller next step (text); Split; Switch to the next
  // task (null when there is none); Talk it through with Coach.
  onSmallerStep,
  onSplit,
  onSwitchNext,
  nextTitle,
  onTalkToCoach,
  // The mini window's I'm stuck: open 59d on arrival, then say so.
  openStuck = false,
  onStuckShown,
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
  // The last sound played other than Rain, for the quick row (this device
  // only) — Off and Rain have chips of their own.
  const [lastSound, setLastSound] = useState(() => { try { return localStorage.getItem(LAST_SOUND_KEY); } catch { return null; } });
  useEffect(() => {
    if (activeSoundKey === "none" || activeSoundKey === "rain" || activeSoundKey === lastSound) return;
    setLastSound(activeSoundKey);
    try { localStorage.setItem(LAST_SOUND_KEY, activeSoundKey); } catch { /* private mode */ }
  }, [activeSoundKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [dumpText, setDumpText] = useState("");
  const [dumpSaved, setDumpSaved] = useState(false);
  const [dumpFull, setDumpFull] = useState(false);
  const dumpInputRef = useRef(null);
  const [showSoundsDrawer, setShowSoundsDrawer] = useState(false);
  const [soundsPlace, setSoundsPlace] = useState(null);
  // 59h: the End session question.
  const [ending, setEnding] = useState(false);
  // 59d: I'm stuck, and whether the timer ran when it opened.
  const [stuck, setStuck] = useState(false);
  const stuckWasRunningRef = useRef(false);

  // The layout's width in CSS px: under the root zoom (Q59, 72) a 1920
  // screen lays out as 1422, so it gets the laptop layout, scaled.
  const [width, setWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth / cssZoom() : 1280));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth / cssZoom());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const wide = width >= 1600;
  // Q37.4: from 900px (a tablet on its side) to 1023 the panel sits below
  // the stage; from 1600 beside it.
  const panelBelow = width >= 900 && width < 1024;

  const submitDump = () => {
    if (!dumpText.trim()) return;
    if (onAddBrainDump?.(dumpText.trim()) === false) { setDumpFull(true); return; }
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

  const openEnd = () => setEnding(true);
  // Block end is the timer's (Q41): the same state on the bar and Today.
  const breaking = blockEnd?.phase === "break";
  const breakOver = blockEnd?.phase === "over";
  const breakLeft = blockEnd?.breakLeft || 0;
  const breakSeconds = blockEnd?.breakSeconds || 300;
  const nextLen = blockEnd?.nextLen || blockMinutes;
  const nextMin = blockEnd?.nextMin || 5;
  const nextMax = blockEnd?.nextMax || 180;
  const startBreak = () => onStartBreak?.();
  const startNext = () => onStartNext?.();
  const setNextLen = (fn) => onSetNextLen?.(fn);
  // The End session question holds block end's 60 s wait while it's open.
  const onHoldRef = useRef(onHoldBlockEnd);
  onHoldRef.current = onHoldBlockEnd;
  useEffect(() => {
    onHoldRef.current?.(ending);
    return () => { if (ending) onHoldRef.current?.(false); };
  }, [ending]);
  const endSession = ({ note, tomorrow }) => { setEnding(false); onEndSession?.({ note, tomorrow }); };

  // 59d: opening pauses the timer; "Back to the timer" resumes it if it ran.
  const openStuckSheet = () => {
    stuckWasRunningRef.current = isRunning;
    if (isRunning) onPlayPause?.();
    setStuck(true);
  };
  const backToTimer = () => {
    setStuck(false);
    if (stuckWasRunningRef.current && !isRunning) onPlayPause?.();
    stuckWasRunningRef.current = false;
  };
  const openStuckRef = useRef(openStuckSheet);
  openStuckRef.current = openStuckSheet;
  useEffect(() => {
    if (!openStuck) return;
    if (!isComplete) openStuckRef.current();
    onStuckShown?.();
  }, [openStuck]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys (45l, 59a–h): Space pauses, D marks done, E asks to end, P opens the
  // mini window, Esc leaves. Not while typing, not while Rescue is open, and
  // Esc closes the sounds drawer or the question first. A held key fires once.
  const keysRef = useRef({});
  keysRef.current = { isComplete, showSoundsDrawer, ending, stuck, backToTimer, onPlayPause, onDone, onExit, onOpenPiP, pipOpen, keysOff, openEnd, onEndSession, breaking: breaking, startBreak, breakOver, startNext, canShuffle: Boolean(SOUND_CATEGORIES[activeSoundKey]), reshuffleTrack };
  useEffect(() => {
    const onKey = (e) => {
      const k = keysRef.current;
      if (k.keysOff || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (k.ending) return; // the question has its own keys
      if (k.stuck) {
        if (e.key === "Escape") { e.preventDefault(); k.backToTimer(); }
        return;
      }
      if (e.key === "Escape" && k.showSoundsDrawer) { setShowSoundsDrawer(false); return; }
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.repeat) return;
      if (e.key === "Escape") {
        if (!k.isComplete) { e.preventDefault(); k.onExit?.(); }
        return;
      }
      // 59i: at block end, Enter takes the break; once it's over, Enter
      // starts the next block (Q38.1a). E asks to end, at any point.
      if (k.isComplete && e.key === "Enter" && !k.breaking && !(t && t.tagName === "BUTTON")) {
        e.preventDefault();
        if (k.breakOver) k.startNext(); else k.startBreak();
        return;
      }
      if (k.isComplete && (e.key === "e" || e.key === "E") && k.onEndSession) { e.preventDefault(); k.openEnd(); return; }
      if (k.isComplete || k.showSoundsDrawer) return;
      if (e.key === " " && !(t && (t.tagName === "BUTTON" || t.tagName === "A"))) { e.preventDefault(); k.onPlayPause?.(); }
      else if (e.key === "d" || e.key === "D") { e.preventDefault(); k.onDone?.(); }
      // S shuffles the sound that's on, as in the mini window (try-out 37).
      else if ((e.key === "s" || e.key === "S") && k.canShuffle) { e.preventDefault(); k.reshuffleTrack?.(); }
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

  // Q38.2: well over the estimate, counted on all of today. Once per task per
  // day on this device (Q40.2), at the block end that first finds it so.
  const [noteBlock, setNoteBlock] = useState(null);
  const [reestimating, setReestimating] = useState(false);
  const [customEstimate, setCustomEstimate] = useState("");
  const atBlockEnd = isComplete && !breaking && !breakOver;
  const noteWanted = atBlockEnd && isWellOver(estimate, doneToday);
  useEffect(() => {
    if (!noteWanted || noteBlock === blockNumber) return;
    const seen = readSeen();
    if (!noteDue(seen, task.uuid, dayKey, estimate)) return;
    writeSeen(markNoteSeen(seen, task.uuid, dayKey, estimate));
    setNoteBlock(blockNumber);
  }, [noteWanted, blockNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  const showNote = atBlockEnd && noteBlock === blockNumber;
  const reestimate = (m) => {
    const minutes = Math.round(Number(m));
    if (!(minutes > 0)) return;
    onReestimate?.(minutes);
    // Not marked seen for the new estimate: the note comes back once that is
    // passed too (Q40.2; Codex review of #434).
    setNoteBlock(null);
    setReestimating(false);
    setCustomEstimate("");
  };
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

  // Sound (59c): a quick row — Off · Rain · the last one used — and "All
  // sounds…", the full library, every sound kept.
  const quickSounds = [
    { key: "none", label: "Off" },
    { key: "rain", label: SOUND_CATEGORIES.rain.title },
    lastSound && lastSound !== "none" && lastSound !== "rain"
      ? { key: lastSound, label: lastSound === BINAURAL_TRACK_ID ? "Binaural 40Hz" : (SOUND_CATEGORIES[lastSound]?.title || "") }
      : null,
  ].filter(q => q && q.label);
  const pickSound = (key) => (SOUND_CATEGORIES[key] ? selectCategory(key) : selectTrack(key));
  const soundsButton = (
    <div className="fm-sound-row" role="group" aria-label="Sound">
      {quickSounds.map(q => (
        <button
          key={q.key}
          type="button"
          className={`focus-mode-dur-btn fm-sound-chip${activeSoundKey === q.key ? " is-on" : ""}`}
          aria-pressed={activeSoundKey === q.key}
          onClick={() => pickSound(q.key)}
        >
          {q.label}
        </button>
      ))}
      <button
        type="button"
        className={`focus-mode-extra-link focus-mode-sounds-btn${showSoundsDrawer ? " active" : ""}`}
        onClick={(e) => {
          // Try-out 37: on a computer the list is a small panel by this
          // link (CSS vars, unused on a phone, where it stays a sheet).
          const r = e.currentTarget.getBoundingClientRect();
          const z = cssZoom();
          const vw = window.innerWidth / z;
          const vh = window.innerHeight / z;
          const left = Math.max(16, Math.min(r.left / z, vw - 420 - 16));
          // Below the link if it fits, else above, else from near the top
          // (the list and the volume always show whole).
          const need = 440;
          const below = vh - r.bottom / z - 16;
          const above = r.top / z - 16;
          setSoundsPlace(below >= need
            ? { "--sd-left": `${left}px`, "--sd-top": `${r.bottom / z + 8}px`, "--sd-max": `${below}px` }
            : above >= need
              ? { "--sd-left": `${left}px`, "--sd-bottom": `${vh - r.top / z + 8}px`, "--sd-max": `${above}px` }
              : { "--sd-left": `${left}px`, "--sd-top": "16px", "--sd-max": `${vh - 32}px` });
          setShowSoundsDrawer(prev => !prev);
        }}
        aria-label="Open sounds menu"
        aria-expanded={showSoundsDrawer}
      >
        All sounds…
      </button>
    </div>
  );
  const parkRow = onAddBrainDump && (
    <div className="focus-mode-dump-row">
      <GrowTextarea
        ref={dumpInputRef}
        className="focus-mode-dump-input"
        placeholder="A stray thought? Park it here"
        value={dumpText}
        maxRows={4}
        allowNewlines
        onChange={e => { setDumpText(e.target.value); setDumpFull(false); }}
        onEnter={() => submitDump()}
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
      {dumpFull && <p className="fm-parked" role="alert">Mind Box holds {THOUGHTS_MAX} thoughts. Let a few go first.</p>}
      {parkedCount > 0 && <p className="fm-parked" aria-live="polite">{parkedCount} parked this session</p>}
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
          <p className="fm-stage-kicker">
            {splitNote ? `SPLIT INTO ${splitNote.n} · PIECE 1 OF ${splitNote.n}` : stageKicker}
            {splitNote?.onUndo && <> <button type="button" className="fm-link" onClick={splitNote.onUndo}>Undo</button></>}
          </p>
          <h1 className="focus-mode-task-title" data-len={titleLength(task.title)}><LinkifyText text={task.title} /></h1>
          {nextStep && (
            <p className="focus-mode-concrete-step">Next step — <LinkifyText text={nextStep.text} /></p>
          )}
        </section>

        <div className="focus-mode-timer-block">
          {breaking ? (
            // 59i: the break, counted on the same clock.
            <FocusClock
              mode={clockMode}
              size={ringSize(width)}
              secondsLeft={breakLeft}
              maxSeconds={breakSeconds}
              caption="Left in this break."
              valueText={`Break: ${Math.floor(breakLeft / 60)} minutes ${breakLeft % 60} seconds left`}
            />
          ) : breakOver ? (
            // Q38.1: the next block, not started.
            <FocusClock
              mode={clockMode}
              size={ringSize(width)}
              secondsLeft={nextLen * 60}
              maxSeconds={nextLen * 60}
              paused
              caption="The next block."
              valueText={`Break's over. The next block is ${nextLen} minutes`}
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
            {/* The break isn't part of the block (Codex review of #433). */}
            <span className="fm-figures-of">{breaking ? "BREAK" : breakOver ? "BREAK'S OVER" : `OF ${blockLabel}`}</span>
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
            {breaking ? (
              <>
                <p className="fm-block-end-note">A 5-minute break. Block {Math.max(1, blockNumber) + 1} waits for you after it.</p>
                <button type="button" className="focus-mode-hold-keep" onClick={startNext}>Skip the break</button>
                <div className="focus-mode-controls">
                  <button type="button" className="focus-mode-ctrl-btn" onClick={openEnd}>End session</button>
                </div>
              </>
            ) : breakOver ? (
              // Q38.1a–c: it asks. The next block is the last one's length,
              // 5 minutes up or down; no answer in 60 s and it pauses.
              <>
                <h2 className="fm-break-over">Break&rsquo;s over</h2>
                <button type="button" className="focus-mode-hold-keep" onClick={startNext}>
                  Start block {Math.max(1, blockNumber) + 1} · {nextLen}m <kbd className="focus-mode-kbd">Enter</kbd>
                </button>
                <div className="focus-mode-controls">
                  <button type="button" className="focus-mode-ctrl-btn" aria-label="5 minutes shorter" disabled={nextLen <= nextMin} onClick={() => setNextLen(m => m - 5)}>−5</button>
                  <button type="button" className="focus-mode-ctrl-btn" aria-label="5 minutes longer" disabled={nextLen >= nextMax} onClick={() => setNextLen(m => m + 5)}>+5</button>
                  {onEndSession && (
                    <button type="button" className="focus-mode-ctrl-btn" onClick={openEnd}>
                      End session <kbd className="focus-mode-kbd">E</kbd>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Q38.2c–d: the fact, and one quiet Re-estimate. */}
                {showNote && (
                  <div className="fm-over-note">
                    <p className="fm-block-end-note">
                      {lower(doneToday)} on this today, {lower(doneToday - estimate)} past the {lower(estimate)} estimate.
                      {!reestimating && onReestimate && (
                        <> <button type="button" className="fm-link" onClick={() => setReestimating(true)}>Re-estimate</button></>
                      )}
                    </p>
                    {reestimating && (
                      <div className="fm-restart" role="group" aria-label="Re-estimate">
                        {reestimateChoices(doneToday).map(m => (
                          <button key={m} type="button" className="focus-mode-dur-btn" onClick={() => reestimate(m)}>{lower(m)}</button>
                        ))}
                        <input
                          className="fm-custom-estimate"
                          type="number"
                          min="1"
                          max="1440"
                          inputMode="numeric"
                          placeholder="Custom"
                          aria-label="Custom estimate in minutes"
                          value={customEstimate}
                          onChange={e => setCustomEstimate(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); reestimate(customEstimate); } }}
                        />
                        {customEstimate && <button type="button" className="focus-mode-dur-btn" onClick={() => reestimate(customEstimate)}>Save</button>}
                      </div>
                    )}
                  </div>
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
              <button type="button" className="focus-mode-ctrl-btn" onClick={openStuckSheet}>
                I&apos;m stuck
              </button>
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
        <EndSessionDialog minutes={loggedMinutes} onEnd={endSession} onClose={() => setEnding(false)} />
      )}

      {stuck && (
        <StuckSheet
          step={nextStep?.text}
          onSmaller={(text) => { onSmallerStep?.(text); backToTimer(); }}
          onSplit={onSplit && (() => { setStuck(false); onSplit(); })}
          onSwitch={onSwitchNext && (() => { setStuck(false); onSwitchNext(); })}
          nextTitle={nextTitle}
          onCoach={onTalkToCoach && (() => { setStuck(false); onTalkToCoach(); })}
          onBack={backToTimer}
        />
      )}

      {showSoundsDrawer && (
        <div className="focus-sounds-backdrop" onClick={() => setShowSoundsDrawer(false)} />
      )}

      <div className={`focus-sounds-drawer${showSoundsDrawer ? " open" : ""}${soundsPlace?.["--sd-bottom"] ? " is-up" : ""}`} aria-hidden={!showSoundsDrawer} style={soundsPlace || undefined}>
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
                      aria-label="Shuffle sound"
                      title="Another track (S)"
                      tabIndex={showSoundsDrawer ? 0 : -1}
                    >
                      Shuffle
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
