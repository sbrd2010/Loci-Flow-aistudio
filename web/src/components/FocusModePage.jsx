import React, { useEffect, useRef, useState } from "react";
import "../styles/focusMode.css";

const DURATION_OPTIONS = [15, 20, 25, 30, 45, 60, 90];

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.8 7.8A7 7 0 1 1 5 12.5" />
      <path d="M6.8 7.8H3.5V4.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 6v12" />
      <path d="M16 6v12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  );
}

const hiddenControlTextStyle = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

export default function FocusModePage({
  task,
  secondsLeft,
  maxSeconds,
  isRunning,
  onPlayPause,
  onReset,
  onDone,
  onExit,
  onChangeDuration,
  onAddBrainDump,
}) {
  const autoExitRef = useRef(null);
  const isComplete = secondsLeft === 0;

  const [dumpText, setDumpText] = useState("");
  const [dumpSaved, setDumpSaved] = useState(false);
  const dumpInputRef = useRef(null);

  useEffect(() => {
    if (isComplete) {
      autoExitRef.current = setTimeout(() => {
        onExit();
      }, 3000);
    }
    return () => {
      if (autoExitRef.current) clearTimeout(autoExitRef.current);
    };
  }, [isComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitDump = () => {
    if (!dumpText.trim()) return;
    onAddBrainDump?.(dumpText.trim());
    setDumpText("");
    setDumpSaved(true);
    setTimeout(() => setDumpSaved(false), 1500);
  };

  const R = 110;
  const circ = 2 * Math.PI * R;
  const ratio = maxSeconds > 0 ? secondsLeft / maxSeconds : 0;
  const strokeDashoffset = circ * (1 - ratio);
  const pct = ratio * 100;

  let ringStroke = "#7ab59b";
  if (isComplete) ringStroke = "#a5d6a7";
  else if (pct <= 20) ringStroke = "#d46a5f";
  else if (pct <= 50) ringStroke = "#c99248";

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const stateLabel = isComplete ? "Complete" : isRunning ? "In progress" : "Paused";
  const currentDurMins = Math.round(maxSeconds / 60);

  return (
    <div className={`focus-mode-overlay${isRunning ? " is-running" : ""}${isComplete ? " is-complete" : ""}`}>
      <button
        type="button"
        className="focus-mode-exit-btn"
        onClick={onExit}
        aria-label="Exit focus mode"
      >
        Exit
      </button>

      <main className="focus-mode-body" aria-label="Deep focus session">
        <div className="focus-mode-session-meta">
          <span className="focus-mode-header-label">Deep Focus</span>
          <span className="focus-mode-state-pill">{stateLabel}</span>
        </div>

        <div className="focus-mode-ring-wrapper">
          <svg
            className="focus-mode-svg"
            viewBox="0 0 260 260"
            aria-hidden="true"
          >
            <circle
              className="focus-mode-ring-bg"
              cx="130"
              cy="130"
              r={R}
              strokeWidth="8"
            />
            <circle
              className="focus-mode-ring-progress"
              cx="130"
              cy="130"
              r={R}
              strokeWidth="8"
              stroke={ringStroke}
              style={{
                strokeDasharray: circ,
                strokeDashoffset,
              }}
            />
          </svg>

          <div className="focus-mode-time-overlay">
            <span className="focus-mode-time-digits">
              {mins}:{secs}
            </span>
            {isComplete && (
              <span className="focus-mode-complete-text">Session complete</span>
            )}
          </div>
        </div>

        {/* Duration picker — only when timer is paused/not started */}
        {!isRunning && !isComplete && (
          <div className="focus-mode-duration-row" aria-label="Focus duration">
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

        <section className="focus-mode-task-panel" aria-label="Focused task">
          <div className="focus-mode-task-kicker">Now focusing on</div>
          <h1 className="focus-mode-task-title">{task.title}</h1>
          {task.concreteStep && (
            <p className="focus-mode-concrete-step">{task.concreteStep}</p>
          )}
        </section>

        {!isComplete && (
          <div className="focus-mode-controls" aria-label="Timer controls">
            <button
              type="button"
              className="focus-mode-ctrl-btn"
              onClick={onReset}
              title="Reset timer"
              aria-label="Reset timer"
            >
              <ResetIcon />
            </button>

            <button
              type="button"
              className="focus-mode-ctrl-btn focus-mode-ctrl-play"
              data-testid="timer-play-pause"
              onClick={onPlayPause}
              aria-label={isRunning ? "Pause timer" : "Start timer"}
            >
              {isRunning ? <PauseIcon /> : <PlayIcon />}
              <span
                className="focus-mode-control-text"
                aria-hidden="true"
                style={hiddenControlTextStyle}
              >
                {isRunning ? "⏸" : "▶"}
              </span>
            </button>
          </div>
        )}

        <button
          type="button"
          className="focus-mode-done-btn"
          onClick={onDone}
          aria-label="Mark task complete and exit"
        >
          <CheckIcon />
          <span>Done</span>
        </button>

        {/* Brain dump — capture stray thoughts without breaking focus */}
        {onAddBrainDump && (
          <div className="focus-mode-dump-row">
            <input
              ref={dumpInputRef}
              type="text"
              className="focus-mode-dump-input"
              placeholder="Stray thought? Capture it here ↵"
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
              {dumpSaved ? "✓" : "Save"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
