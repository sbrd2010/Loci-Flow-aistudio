import React, { useEffect, useRef, useState } from "react";
import { minutesFromSeconds } from "../utils/focusLedger";
import { getTimerState, extendMinutesForSession } from "../utils/focusSession";
import { BINAURAL_TRACK_ID } from "../utils/binauralBeat";
import { SOUND_CATEGORIES, getCategoryKeyForTrack, getTrackTitle } from "../utils/soundLibrary";
import LinkifyText from "./LinkifyText";
import { IconCheck, IconX } from "./ui/icons";
import "../styles/focusMode.css";

const DURATION_OPTIONS = [15, 20, 25, 30, 45, 60, 90];

const PIP_SUPPORTED = "documentPictureInPicture" in window;

const FIVE_MINUTES_SECONDS = 5 * 60;



export default function FocusModePage({
  task,
  secondsLeft,
  maxSeconds,
  isRunning,
  onPlayPause,
  onDone,
  onExit,
  onChangeDuration,
  // The hold's two actions. Neither is the ordinary overlay exit: "Keep going"
  // has to restart the timer AND clear the completion state, and "Stop here"
  // has to end the session, not merely hide the screen it is on.
  onKeepGoing,
  // +5 min on a running block (45b), not the hold's extension.
  onAddTime,
  onStopHere,
  startedAt,
  elapsedSeconds,
  onAddBrainDump,
  onRescue,
  pipOpen,
  onOpenPiP,
  // Which session of the day this is. The spec reads "SESSION 3 OF 4"; there
  // is no "of 4" — the app has no daily session target, and inventing a
  // denominator would print a number nothing in the app ever agreed to. The
  // count alone is data that exists, and it still does the job the kicker is
  // for: telling you where you are in the day.
  sessionNumber = 0,
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
  // flag, so a task whose own estimate is five minutes reads the same way — it
  // is the same kind of session either way.
  const isFiveMinute = maxSeconds === FIVE_MINUTES_SECONDS;

  // Which Sounds drawer tile is currently active: an ambient category key
  // (e.g. "rain"), the binaural track id, or "none".
  const activeSoundKey = selectedTrack ? (getCategoryKeyForTrack(selectedTrack) || selectedTrack) : "none";

  const [dumpText, setDumpText] = useState("");
  const [dumpSaved, setDumpSaved] = useState(false);
  const dumpInputRef = useRef(null);

  const [showSoundsDrawer, setShowSoundsDrawer] = useState(false);

  // The three-second auto-close that used to live here is gone. Addendum D
  // delta 3 is explicit — "Running out of time is never a failure event: no
  // sound, no modal, no auto-close" — and it was doing real damage beyond the
  // wording: K4's hold offers two choices at 00:00, and a screen that closed
  // itself after three seconds took both away before they could be read.

  const submitDump = () => {
    if (!dumpText.trim()) return;
    onAddBrainDump?.(dumpText.trim());
    setDumpText("");
    setDumpSaved(true);
    setTimeout(() => setDumpSaved(false), 1500);
  };

  const ratio = maxSeconds > 0 ? secondsLeft / maxSeconds : 0;

  // Visual state color mappings — always cyan, no shift as time runs out
  const timerState = getTimerState(secondsLeft, maxSeconds);

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const stateLabel = isComplete ? "Complete" : isRunning ? "In progress" : "Paused";
  // The five-minute session names the length it will log — but this button is
  // available before the countdown reaches zero, and the completion path
  // records ELAPSED seconds, not the planned length. Promising "log 5m" after
  // forty seconds was a figure the ledger would never write.
  //
  // minutesFromSeconds is the ledger's OWN conversion, not a reimplementation
  // of it: a label that floored while the ledger rounds read "log 1m" at 90
  // seconds and then booked 2.
  // Whole-session, from the hook's own figure — not this block's
  // (maxSeconds - secondsLeft), which after a "Keep Going" extension reports
  // only the new block and contradicts the ledger.
  const loggedMinutes = minutesFromSeconds(
    Number.isFinite(Number(elapsedSeconds)) ? Number(elapsedSeconds) : Math.max(0, maxSeconds - secondsLeft)
  );
  const loggedLabel = isFiveMinute && loggedMinutes >= 1 ? `${loggedMinutes}m` : null;
  const currentDurMins = Math.round(maxSeconds / 60);
  // "STARTED 09:41". Omitted rather than faked when the caller has no start
  // time to give — a session reopened from a previous mount has none.
  const startedLabel = Number(startedAt) > 0
    ? new Date(Number(startedAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  // K4's hold, on the screen it belongs to. The extension scales to the block
  // just run rather than offering a flat +20m, and the companion label names
  // the real figure the ledger will hold — both through the same helpers the
  // ledger uses, so neither can drift from what is actually written.
  const holdExtendMinutes = extendMinutesForSession(maxSeconds);
  const holdLogMinutes = loggedMinutes;

  // "OF 15:00 · ENDS 09:55" (45b): the block's length, and when it ends if it
  // keeps running. Not claimed while paused — a paused block has no end.
  const blockLabel = `${Math.floor(maxSeconds / 60)}:${String(maxSeconds % 60).padStart(2, "0")}`;
  const endsLabel = isRunning && !isComplete
    ? new Date(Date.now() + secondsLeft * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  const notStarted = !isRunning && !isComplete && !(Number(elapsedSeconds) > 0) && secondsLeft === maxSeconds;

  // Laptop keys (45l): Space pauses, D marks done, Esc leaves. Not while
  // typing, and Esc closes the sounds drawer first.
  const keysRef = useRef({});
  keysRef.current = { isComplete, showSoundsDrawer, onPlayPause, onDone, onExit };
  useEffect(() => {
    const onKey = (e) => {
      const k = keysRef.current;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        if (k.showSoundsDrawer) { setShowSoundsDrawer(false); return; }
        if (!k.isComplete) { e.preventDefault(); k.onExit?.(); }
        return;
      }
      if (k.isComplete || k.showSoundsDrawer) return;
      if (e.key === " " && !(t && (t.tagName === "BUTTON" || t.tagName === "A"))) { e.preventDefault(); k.onPlayPause?.(); }
      else if (e.key === "d" || e.key === "D") { e.preventDefault(); k.onDone?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const kicker = isFiveMinute
    ? (isComplete ? "FIVE MINUTES · DONE" : "FIVE MINUTES · THAT'S ALL")
    : "FOCUS";

  return (
    <div className={`focus-mode-overlay${isRunning ? " is-running" : ""}${isComplete ? " is-complete" : ""} timer-state-${timerState}`}>
      <header className="focus-mode-head">
        <p className="focus-mode-kicker">
          <span className="focus-mode-header-label">{kicker}</span>
          {sessionNumber > 0 && (
            <span className="focus-mode-session-count" aria-label={`Session ${sessionNumber} today`}> · SESSION {sessionNumber}</span>
          )}
          <span className="sr-only"> · {stateLabel}</span>
        </p>
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
      </header>

      <main className="focus-mode-body" aria-label="Deep focus session">
        <section className="focus-mode-task-panel" aria-label="Focused task">
          <h1 className="focus-mode-task-title"><LinkifyText text={task.title} /></h1>
          {task.concreteStep && task.concreteStep !== "Do first tiny step" && (
            <p className="focus-mode-concrete-step">First step: <LinkifyText text={task.concreteStep} /></p>
          )}
        </section>

        <div className="focus-mode-timer-block">
          <span className="focus-mode-time-digits" aria-live="off">{mins}:{secs}</span>
          <div
            className="focus-mode-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={maxSeconds}
            aria-valuenow={Math.max(0, maxSeconds - secondsLeft)}
            aria-valuetext={`${mins} minutes ${secs} seconds left of ${blockLabel}`}
            aria-label="Session progress"
          >
            <div className="focus-mode-track-fill" style={{ width: `${Math.min(100, Math.max(0, (1 - ratio) * 100))}%` }} />
          </div>
          <p className="focus-mode-figures">
            <span>OF {blockLabel}</span>
            {endsLabel && <span> · ENDS {endsLabel}</span>}
            {startedLabel && <span className="focus-mode-started"> · STARTED {startedLabel}</span>}
          </p>
        </div>

        {/* Before the first start, the block's length can still be chosen. */}
        {notStarted && (
          <div className="focus-mode-duration-row" role="group" aria-label="Focus duration">
            {DURATION_OPTIONS.map(m => (
              <button
                key={m}
                type="button"
                className={`focus-mode-dur-btn${currentDurMins === m ? " active" : ""}`}
                onClick={() => onChangeDuration?.(m)}
                aria-pressed={currentDurMins === m}
              >
                {m}m
              </button>
            ))}
          </div>
        )}

        {/* K4's hold, at 00:00: two choices and nothing else. The timer is
            frozen and the minutes are already in the ledger. */}
        {isComplete ? (
          <div className="focus-mode-hold-actions" aria-label="Session complete">
            <button type="button" className="focus-mode-hold-keep" onClick={() => onKeepGoing?.(holdExtendMinutes)}>
              Keep going · +{holdExtendMinutes}m
            </button>
            <button type="button" className="focus-mode-hold-stop" onClick={onStopHere || onExit}>
              Stop here{holdLogMinutes >= 1 ? ` — log ${holdLogMinutes}m` : ""}
            </button>
          </div>
        ) : (
          <div className="focus-mode-actions">
            <button
              type="button"
              className="focus-mode-done-btn"
              onClick={onDone}
              aria-label={loggedLabel ? `Mark task complete and log ${loggedMinutes} minutes` : "Mark done"}
            >
              <span>{loggedLabel ? `Done — log ${loggedLabel}` : "Mark done"}</span>
              <IconCheck size={18} />
              <kbd className="focus-mode-kbd">D</kbd>
            </button>
            <div className="focus-mode-controls" aria-label="Timer controls">
              <button
                type="button"
                className="focus-mode-ctrl-btn"
                data-testid="timer-play-pause"
                onClick={onPlayPause}
                aria-label={isRunning ? "Pause timer" : notStarted ? "Start timer" : "Resume timer"}
              >
                {isRunning ? "Pause" : notStarted ? "Start" : "Resume"}
                <kbd className="focus-mode-kbd">Space</kbd>
              </button>
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

        {/* Not drawn in 45b, but already part of a session: sounds, the
            pop-out timer, and a place to drop a stray thought. Quiet, below. */}
        {!isComplete && (
          <div className="focus-mode-extras">
            <button
              type="button"
              className={`focus-mode-extra-link focus-mode-sounds-btn${showSoundsDrawer ? " active" : ""}`}
              onClick={() => setShowSoundsDrawer(prev => !prev)}
              aria-label="Open sounds menu"
            >
              Sounds
            </button>
            {PIP_SUPPORTED && !pipOpen && (
              <button type="button" className="focus-mode-extra-link focus-mode-pip-btn" onClick={onOpenPiP} aria-label="Pop out timer">
                Pop out
              </button>
            )}
          </div>
        )}
        {onAddBrainDump && !isComplete && (
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
        )}
      </main>

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
