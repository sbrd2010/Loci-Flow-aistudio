import React, { useEffect, useState } from "react";
import { formatHHMM, parseClock } from "../../utils/clockText";
import "../../styles/pickers.css";

// Try-out 10/19/20: one time picker in Loci's style, in place of the
// browser's time field and the Day map's long dropdown. Times to tap first
// (`choices`: [{ minutes, label? }]), then a field to type any other time
// ("14:30", "1430", "2:30pm"); Enter, Set or leaving the field takes it.
// `normalize` maps a typed time to the value to keep (the Day map moves a
// time before now past midnight), or returns null to refuse it with `hint`.
export default function TimePicker({
  value,
  onChange,
  choices = [],
  label = "Time",
  normalize = (m) => m,
  hint = "Type a time like 14:30 or 2:30pm",
  autoFocus = false,
  idPrefix = "time",
}) {
  const [draft, setDraft] = useState(value == null ? "" : formatHHMM(value));
  const [error, setError] = useState("");
  useEffect(() => { setDraft(value == null ? "" : formatHHMM(value)); setError(""); }, [value]);

  const commit = () => {
    if (!draft.trim()) return false;
    const typed = parseClock(draft);
    const next = typed == null ? null : normalize(typed);
    if (next == null) { setError(hint); return false; }
    setError("");
    setDraft(formatHHMM(next));
    if (next !== value) onChange(next);
    return true;
  };

  return (
    <div className="tp" role="group" aria-label={label}>
      {choices.length > 0 && (
        <div className="tp-choices">
          {choices.map((c) => (
            <button
              key={c.minutes}
              type="button"
              className={`tp-chip${c.minutes === value ? " is-on" : ""}`}
              aria-pressed={c.minutes === value}
              onClick={() => { setError(""); onChange(c.minutes); }}
            >
              {c.label ?? formatHHMM(c.minutes)}
            </button>
          ))}
        </div>
      )}
      <div className="tp-type">
        <input
          id={`${idPrefix}-typed`}
          type="text"
          inputMode="text"
          autoComplete="off"
          className="tp-input"
          aria-label={`${label}, typed`}
          aria-invalid={!!error}
          aria-describedby={error ? `${idPrefix}-error` : undefined}
          placeholder="hh:mm"
          value={draft}
          autoFocus={autoFocus}
          onChange={(e) => { setDraft(e.target.value); setError(""); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); commit(); }
            // ⌘↵ (Add task's shortcut) takes the typed time first, then
            // submits once it's in, as the time chips' Other does (Codex
            // review of #498); a time that doesn't read stops it.
            else if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              e.stopPropagation();
              const form = e.currentTarget.form;
              if (commit() && form) setTimeout(() => form.requestSubmit(), 0);
            }
          }}
        />
        <button type="button" className="tp-set" onMouseDown={(e) => e.preventDefault()} onClick={commit}>Set</button>
      </div>
      {error && <p id={`${idPrefix}-error`} className="tp-error" role="alert">{error}</p>}
    </div>
  );
}
