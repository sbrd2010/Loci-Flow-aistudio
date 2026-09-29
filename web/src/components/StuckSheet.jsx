import React, { useState } from "react";
import "../styles/focusMode.css";

// I'm stuck (59d): the timer is paused while this is open. Make the step
// smaller · Split the task · Switch to the next task (this one returns to the
// top of Today) · Talk it through with Coach (task and step attached). "Back
// to the timer" resumes. An option is left out when there is nothing for it
// to do (no next task, say).
export default function StuckSheet({ step, onSmaller, onSplit, onSwitch, nextTitle, onCoach, onBack }) {
  const [smaller, setSmaller] = useState(false);
  const [text, setText] = useState("");
  const save = () => { if (text.trim()) onSmaller(text); };
  return (
    <div className="fm-end-scrim" onClick={onBack}>
      <div
        className="fm-end"
        role="dialog"
        aria-modal="true"
        aria-label="Stuck?"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onBack(); }
        }}
      >
        <h2 className="fm-end-title">Stuck?</h2>
        <p className="fm-end-text">The timer is paused. Pick one way forward.</p>
        {smaller ? (
          <label className="fm-end-field">
            <span>A smaller step{step ? <span className="fm-end-optional"> · now “{step}”</span> : null}</span>
            {/* Stored as concreteStep, which the database caps at 300. */}
            <input
              autoFocus
              maxLength={300}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
              placeholder="Something you can do in 5 minutes"
            />
          </label>
        ) : null}
        <div className="fm-end-actions">
          {smaller ? (
            <button type="button" className="focus-mode-done-btn" onClick={save} disabled={!text.trim()}>
              Make it the next step <kbd className="focus-mode-kbd">Enter</kbd>
            </button>
          ) : (
            <button type="button" className="focus-mode-ctrl-btn" autoFocus onClick={() => setSmaller(true)}>Make the step smaller</button>
          )}
          {onSplit && <button type="button" className="focus-mode-ctrl-btn" onClick={onSplit}>Split the task</button>}
          {onSwitch && (
            <button type="button" className="focus-mode-ctrl-btn" onClick={onSwitch}>
              Switch to the next task{nextTitle ? ` · ${nextTitle}` : ""}
            </button>
          )}
          {onCoach && <button type="button" className="focus-mode-ctrl-btn" onClick={onCoach}>Talk it through with Coach</button>}
          <button type="button" className="focus-mode-ctrl-btn" onClick={onBack}>Back to the timer</button>
        </div>
      </div>
    </div>
  );
}
