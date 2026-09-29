import React, { useState } from "react";
import "../styles/focusMode.css";

// End session (59h): asked from the focus page (E, paused, block end) and the
// focus bar (59e). The minutes are saved either way; the task stays open, or
// goes to tomorrow. "Where did you stop?" becomes its next step.
export default function EndSessionDialog({ minutes, onEnd, onClose }) {
  const [note, setNote] = useState("");
  const end = (tomorrow) => onEnd({ note, tomorrow });
  return (
    <div className="fm-end-scrim" onClick={onClose}>
      <div
        className="fm-end"
        role="dialog"
        aria-modal="true"
        aria-label="End this session?"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
          // Enter ends it — except on a button, which is its own.
          else if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); end(false); }
        }}
      >
        <h2 className="fm-end-title">End this session?</h2>
        <p className="fm-end-text">
          {minutes} {minutes === 1 ? "minute" : "minutes"} of focus {minutes === 1 ? "is" : "are"} saved. The task stays open.
        </p>
        <label className="fm-end-field">
          <span>Where did you stop? <span className="fm-end-optional">Optional</span></span>
          {/* The next step is stored as concreteStep, which the database caps
              at 300 characters (Codex review of #432). */}
          <input autoFocus maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="It becomes the next step" />
        </label>
        <div className="fm-end-actions">
          <button type="button" className="focus-mode-done-btn" onClick={() => end(false)}>
            End session <kbd className="focus-mode-kbd">Enter</kbd>
          </button>
          <button type="button" className="focus-mode-ctrl-btn" onClick={() => end(true)}>End and move to tomorrow</button>
          <button type="button" className="focus-mode-ctrl-btn" onClick={onClose}>Keep going</button>
        </div>
      </div>
    </div>
  );
}
