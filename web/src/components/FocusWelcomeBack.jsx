import React from "react";
import "../styles/focusMode.css";

// After a refresh (#527): the session that was running comes back paused, with
// the time worked, and asks. Esc leaves it paused, as it is.
export default function FocusWelcomeBack({ title, minutes, onContinue, onEnd, onClose }) {
  return (
    <div className="fm-end-scrim" onClick={onClose}>
      <div
        className="fm-end"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome back"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      >
        <h2 className="fm-end-title">Welcome back</h2>
        <p className="fm-end-text">
          Your focus session on “{title}” is paused. {minutes} {minutes === 1 ? "minute" : "minutes"} of focus {minutes === 1 ? "is" : "are"} saved.
        </p>
        <div className="fm-end-actions">
          <button type="button" className="focus-mode-done-btn" autoFocus onClick={onContinue}>Continue</button>
          <button type="button" className="focus-mode-ctrl-btn" onClick={onEnd}>End session</button>
        </div>
      </div>
    </div>
  );
}
