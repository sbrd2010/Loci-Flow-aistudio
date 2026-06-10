import React from "react";
import { getTimerState } from "../utils/focusSession";
import "../styles/floatingFocusTimer.css";

// Persistent mini Focus timer shown across pages while a session is active.
// Desktop: a bottom mini-bar with title, remaining time and a "Return to Focus" label.
// Mobile: a compact sticky pill (time + title) that returns to Focus when tapped.
export default function FloatingFocusTimer({
  task,
  secondsLeft,
  maxSeconds,
  isRunning,
  onPlayPause,
  onReturnToFocus,
  onEndSession,
  pipOpen,
  onOpenPiP,
}) {
  if (!task) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const progressPct = maxSeconds > 0 ? Math.min(100, Math.max(0, (secondsLeft / maxSeconds) * 100)) : 0;

  const timerState = getTimerState(secondsLeft, maxSeconds);

  const isPiPSupported = "documentPictureInPicture" in window;

  return (
    <div className={`floating-focus-timer${!isRunning ? " is-paused" : ""} timer-state-${timerState}`} role="status" aria-label="Active focus session">
      <div className="floating-focus-timer-progress" style={{ width: `${progressPct}%` }} />
      <button
        type="button"
        className="floating-focus-timer-main"
        onClick={onReturnToFocus}
        aria-label={`Return to Focus: ${task.title}, ${mins}:${secs} remaining`}
      >
        <span className="floating-focus-timer-time">{mins}:{secs}</span>
        <span className="floating-focus-timer-title">{task.title}</span>
        <span className="floating-focus-timer-cta">Return to Focus</span>
      </button>
      <div className="floating-focus-timer-controls">
        {isPiPSupported && !pipOpen && (
          <button
            type="button"
            className="floating-focus-timer-btn"
            onClick={onOpenPiP}
            title="Pop out a floating mini-timer"
            aria-label="Pop out timer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="floating-focus-timer-btn"
          onClick={onPlayPause}
          aria-label={isRunning ? "Pause focus timer" : "Resume focus timer"}
        >
          {isRunning ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          className="floating-focus-timer-btn"
          onClick={onEndSession}
          aria-label="End focus session"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
