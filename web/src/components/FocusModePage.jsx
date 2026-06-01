import React, { useEffect, useRef } from "react";
import "../styles/focusMode.css";

/**
 * FocusModePage — full-screen deep focus overlay.
 *
 * Props
 * -----
 * task           Object   Task being focused on (.title, .concreteStep)
 * secondsLeft    number   Seconds remaining
 * maxSeconds     number   Full session length in seconds
 * isRunning      boolean  Timer is ticking
 * onPlayPause    fn()     Toggle running state
 * onReset        fn()     Reset timer to full
 * onDone         fn()     Mark task complete + exit
 * onExit         fn()     Exit overlay without stopping timer
 */
export default function FocusModePage({
  task,
  secondsLeft,
  maxSeconds,
  isRunning,
  onPlayPause,
  onReset,
  onDone,
  onExit,
}) {
  const autoExitRef = useRef(null);
  const isComplete = secondsLeft === 0;

  // Auto-exit 3 s after timer hits 0
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

  // ── Ring geometry ──
  // viewBox is 260×260, radius = 110  ⟹  cx=cy=130
  const R = 110;
  const circ = 2 * Math.PI * R; // ≈ 691.15
  const ratio = maxSeconds > 0 ? secondsLeft / maxSeconds : 0;
  // Ring drains: offset starts at 0 (full) and grows to circ (empty)
  const strokeDashoffset = circ * (1 - ratio);

  // ── Ring colour: indigo → amber (<50%) → red (<20%) ──
  const pct = ratio * 100;
  let ringStroke;
  let ringGlow;
  if (isComplete) {
    ringStroke = "#6366f1";
    ringGlow = "drop-shadow(0 0 10px rgba(99,102,241,0.8)) drop-shadow(0 0 24px rgba(99,102,241,0.5))";
  } else if (pct <= 20) {
    ringStroke = "#ef4444";
    ringGlow = "drop-shadow(0 0 10px rgba(239,68,68,0.8)) drop-shadow(0 0 24px rgba(239,68,68,0.5))";
  } else if (pct <= 50) {
    ringStroke = "#f59e0b";
    ringGlow = "drop-shadow(0 0 10px rgba(245,158,11,0.8)) drop-shadow(0 0 24px rgba(245,158,11,0.5))";
  } else {
    ringStroke = "#6366f1";
    ringGlow = "drop-shadow(0 0 10px rgba(99,102,241,0.8)) drop-shadow(0 0 24px rgba(99,102,241,0.5))";
  }

  // ── Display strings ──
  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="focus-mode-overlay">
      {/* Exit button */}
      <button
        className="focus-mode-exit-btn"
        onClick={onExit}
        aria-label="Exit focus mode"
      >
        ← Exit
      </button>

      {/* Body — centred content */}
      <div className="focus-mode-body">
        {/* "DEEP FOCUS" header */}
        <div className="focus-mode-header-label">Deep Focus</div>

        {/* Countdown ring */}
        <div className="focus-mode-ring-wrapper">
          <svg
            className="focus-mode-svg"
            viewBox="0 0 260 260"
            aria-hidden="true"
          >
            {/* Background track */}
            <circle
              className="focus-mode-ring-bg"
              cx="130"
              cy="130"
              r={R}
              strokeWidth="10"
            />
            {/* Progress arc */}
            <circle
              className="focus-mode-ring-progress"
              cx="130"
              cy="130"
              r={R}
              strokeWidth="10"
              stroke={ringStroke}
              style={{
                strokeDasharray: circ,
                strokeDashoffset: strokeDashoffset,
                filter: ringGlow,
              }}
            />
          </svg>

          {/* Time overlay (not rotated — parent SVG is rotated -90deg) */}
          <div className="focus-mode-time-overlay">
            <span className="focus-mode-time-digits">
              {mins}:{secs}
            </span>
            {isComplete && (
              <span className="focus-mode-complete-text">Session Complete ✓</span>
            )}
          </div>
        </div>

        {/* Task title */}
        <div className="focus-mode-task-title">{task.title}</div>

        {/* Concrete step (optional) */}
        {task.concreteStep && (
          <div className="focus-mode-concrete-step">{task.concreteStep}</div>
        )}

        {/* Controls */}
        {!isComplete && (
          <div className="focus-mode-controls">
            {/* Reset */}
            <button
              className="focus-mode-ctrl-btn"
              onClick={onReset}
              title="Reset timer"
              aria-label="Reset timer"
            >
              ↺
            </button>

            {/* Play / Pause */}
            <button
              className="focus-mode-ctrl-btn focus-mode-ctrl-play"
              data-testid="timer-play-pause"
              onClick={onPlayPause}
              aria-label={isRunning ? "Pause timer" : "Start timer"}
            >
              {isRunning ? "⏸" : "▶"}
            </button>

            {/* Spacer to balance layout */}
            <div style={{ width: 48 }} aria-hidden="true" />
          </div>
        )}

        {/* Done button */}
        <button
          className="focus-mode-done-btn"
          onClick={onDone}
          aria-label="Mark task complete and exit"
        >
          ✓ Done
        </button>
      </div>
    </div>
  );
}
