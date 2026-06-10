import React from "react";
import "../styles/floatingFocusTimer.css";

// Persistent mini Focus timer shown across pages while a session is active.
// Desktop: a bottom mini-bar with title, remaining time and a "Return to Focus" label.
// Mobile: a compact sticky pill (time + title) that returns to Focus when tapped.
export default function FloatingFocusTimer({ task, secondsLeft, maxSeconds, isRunning, onPlayPause, onReturnToFocus, onEndSession }) {
  if (!task) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const progressPct = maxSeconds > 0 ? Math.min(100, Math.max(0, (secondsLeft / maxSeconds) * 100)) : 0;

  return (
    <div className="floating-focus-timer" role="status" aria-label="Active focus session">
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
