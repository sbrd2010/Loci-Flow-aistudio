import React, { useEffect, useState } from "react";
import { ESTIMATE_CHIPS, formatEstimate, parseEstimate } from "../utils/estimates";

// Try-out 8/9: one set of time chips wherever a task's length is chosen (Add
// task, the task panel), and "Other" opens a typed field instead of the
// browser's dropdown. Typing "40", "40m", "1h20" or "1.5h" all work; Enter,
// Set or leaving the field takes it.
export default function EstimatePicker({
  value,                 // minutes, or null when nothing is chosen
  onPick,                // (minutes | null) => void
  allowNone = false,     // the task panel offers None; a new task has no choice yet
  role,                  // "radio" for a radiogroup (task panel), else toggle buttons
  chipClass,             // (on: boolean) => className
  inputClass = "",
  buttonClass = "",
  idPrefix = "estimate",
}) {
  const current = Number(value) > 0 ? Number(value) : null;
  const offChips = current != null && !ESTIMATE_CHIPS.includes(current);
  const [otherOpen, setOtherOpen] = useState(offChips);
  const [draft, setDraft] = useState(offChips ? formatEstimate(current) : "");
  const [error, setError] = useState("");
  // Codex review of #498: the length can change from outside (an AI
  // suggestion applied in Add task, a synced edit). Follow it: a chip shows
  // as chosen and Other closes; another length off the chips shows in Other.
  useEffect(() => {
    setError("");
    if (offChips) { setOtherOpen(true); setDraft(formatEstimate(current)); }
    else { setOtherOpen(false); setDraft(""); }
  }, [current, offChips]);

  const stateProps = (on) => (role === "radio" ? { role: "radio", "aria-checked": on } : { "aria-pressed": on });
  const commit = () => {
    // Left empty, Other closes and what is really chosen shows again — it
    // never looks chosen while another length is kept (Codex review of #498).
    if (!draft.trim()) {
      setError("");
      if (offChips) setDraft(formatEstimate(current));
      else setOtherOpen(false);
      return false;
    }
    const min = parseEstimate(draft);
    if (min == null) { setError("Try 40m, 1h20 or 1.5h"); return false; }
    setError("");
    setDraft(formatEstimate(min));
    if (min !== current) onPick(min);
    return true;
  };

  const chips = allowNone ? [...ESTIMATE_CHIPS, null] : ESTIMATE_CHIPS;
  return (
    <>
      {chips.map((m) => {
        const on = !otherOpen && current === m;
        return (
          <button key={m || "none"} type="button" className={chipClass(on)} {...stateProps(on)}
            onClick={() => { setOtherOpen(false); setError(""); onPick(m); }}>
            {formatEstimate(m)}
          </button>
        );
      })}
      <button type="button" className={chipClass(otherOpen || offChips)} {...stateProps(otherOpen || offChips)}
        aria-label="Other" aria-expanded={otherOpen}
        onClick={() => { setOtherOpen(true); setDraft(offChips ? formatEstimate(current) : ""); }}>
        {offChips && !otherOpen ? `Other · ${formatEstimate(current)}` : "Other"}
      </button>
      {otherOpen && (
        <span className="estimate-other">
          <input
            id={`${idPrefix}-other`}
            type="text"
            inputMode="text"
            className={inputClass}
            aria-label="Other time"
            aria-invalid={!!error}
            aria-describedby={error ? `${idPrefix}-other-error` : undefined}
            placeholder="e.g. 40m or 1h20"
            value={draft}
            autoFocus
            onChange={(e) => { setDraft(e.target.value); setError(""); }}
            onBlur={commit}
            onKeyDown={(e) => {
              // Enter takes the time; it never submits the form around it
              // (⌘↵ still adds the task).
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); commit(); }
              else if (e.key === "Escape" && draft) { e.stopPropagation(); setDraft(""); setError(""); }
            }}
          />
          <button type="button" className={buttonClass} onMouseDown={(e) => e.preventDefault()} onClick={commit}>Set</button>
          {error && <span id={`${idPrefix}-other-error`} className="estimate-other-error" role="alert">{error}</span>}
        </span>
      )}
    </>
  );
}
