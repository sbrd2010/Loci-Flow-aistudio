import React, { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { IconCalendar } from "./icons";
import { formatDateField, isFullIsoDate, parseTypedDate } from "../../utils/dateField";
import "../../styles/pickers.css";

const DayPickerPanel = lazy(() => import("./DayPickerPanel"));
const touchPrimary = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

// #658: one date field in Loci's style. Value in and out is "YYYY-MM-DD" (or
// "" when empty), exactly as the browser's date input gave it, so saved data
// doesn't change. Touch-primary devices keep the native picker (the phone's
// own is modern and familiar); elsewhere the date can be typed (Enter or
// leaving the field takes it; a full YYYY-MM-DD is taken at once) or picked
// on a calendar. `min` and `today` come from the caller: a Loci day for
// fronts, the calendar day for reminders; this does no day maths of its own.
export default function DateField({ id, value = "", onChange, min, today, label, className = "", allowClear = false }) {
  const [native] = useState(touchPrimary);
  const [draft, setDraft] = useState(null); // text being typed; null shows the value
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const hintId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (native) {
    return (
      <input id={id} className={className} type="date" aria-label={label} value={value} min={min}
        onChange={e => onChange(e.target.value)} />
    );
  }

  const take = (ymd) => {
    setDraft(null);
    setError("");
    if (ymd !== value) onChange(ymd);
  };
  const commit = (text) => {
    if (text == null) return;
    if (!text.trim()) {
      if (allowClear) take("");
      else { setDraft(null); setError(""); }
      return;
    }
    const ymd = parseTypedDate(text);
    if (!ymd) { setError("Type a date like 13 Nov 2026"); return; }
    if (min && ymd < min) { setError(`Pick ${formatDateField(min)} or later`); return; }
    take(ymd);
  };
  const close = () => { setOpen(false); buttonRef.current?.focus(); };

  return (
    <span className="df" ref={wrapRef}>
      <input
        id={id}
        className={`${className} df-input`}
        type="text"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? hintId : undefined}
        autoComplete="off"
        placeholder="e.g. 13 Nov 2026"
        value={draft ?? formatDateField(value)}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (error) setError("");
          if (isFullIsoDate(text)) {
            const ymd = parseTypedDate(text);
            if (ymd && !(min && ymd < min)) { setError(""); if (ymd !== value) onChange(ymd); }
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(draft); }
          if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); setOpen(true); }
        }}
        onBlur={() => commit(draft)}
      />
      <button
        ref={buttonRef}
        type="button"
        className="df-open"
        aria-label={`${label || "Date"}: choose on a calendar`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <IconCalendar size={18} />
      </button>
      {open && (
        <div
          className="df-pop"
          role="dialog"
          aria-label={`${label || "Date"}: calendar`}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}
        >
          <Suspense fallback={<p className="df-loading">Loading…</p>}>
            <DayPickerPanel value={value} min={min} today={today} onPick={(ymd) => { take(ymd); close(); }} />
          </Suspense>
          {allowClear && value && (
            <button type="button" className="df-clear" onClick={() => { take(""); close(); }}>Clear</button>
          )}
        </div>
      )}
      {error && <span id={hintId} className="df-hint" role="alert">{error}</span>}
    </span>
  );
}
