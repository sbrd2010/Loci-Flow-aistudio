import React, { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { IconCalendar } from "./icons";
import { formatDateField, isFullIsoDate, parseTypedDate } from "../../utils/dateField";
import "../../styles/pickers.css";

const DayPickerPanel = lazy(() => import("./DayPickerPanel"));

// The calendar's code is a separate file. If it can't load (offline, or a tab
// left open across a deploy), say so in the popover instead of letting the
// error blank the whole app; typing a date still works.
class CalendarBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="df-loading" role="status">The calendar couldn’t load. Type the date instead.</p>
      : this.props.children;
  }
}
// "2026-11-1" is on its way to "2026-11-13": an ISO date is only taken while
// typing once it's complete. Written-out dates need their 4-digit year last,
// so they can be taken as soon as they read.
const takeWhileTyping = (text) => isFullIsoDate(text) || !/^\s*\d{4}-/.test(text);
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
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const hintId = useId();

  // The value changed from outside (Clear goal, another device, a different
  // front) while nobody is typing here: drop any half-typed or refused text
  // and its hint, so they never sit on top of the new value.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setDraft(null);
    setError("");
  }, [value]);

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
  // True when what's in the field is now the value (or nothing was typed).
  const commit = (text) => {
    if (text == null) return true;
    if (!text.trim()) {
      if (allowClear) take("");
      else { setDraft(null); setError(""); }
      return true;
    }
    const ymd = parseTypedDate(text);
    if (!ymd) { setError("Type a date like 13 Nov 2026"); return false; }
    if (min && ymd < min) { setError(`Pick ${formatDateField(min)} or later`); return false; }
    take(ymd);
    return true;
  };
  const close = () => { setOpen(false); buttonRef.current?.focus(); };

  return (
    <span
      className="df"
      ref={wrapRef}
      // Focus moving to something else (Tab past the calendar, say) closes the
      // calendar; focus stays where the person put it. A blur with nowhere to
      // go (Safari doesn't focus clicked buttons; a click on a disabled day)
      // isn't leaving: clicks outside are closed by the mousedown listener.
      onBlur={(e) => { if (open && e.relatedTarget && !wrapRef.current?.contains(e.relatedTarget)) setOpen(false); }}
      // Escape anywhere in the field (the calendar, its button, the text)
      // closes an open calendar, and only that.
      onKeyDown={(e) => { if (open && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}
    >
      <input
        ref={inputRef}
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
          // Taken as soon as it reads, so a button pressed next (Save, Add)
          // already has it; refusals wait for Enter or leaving the field.
          const ymd = takeWhileTyping(text) ? parseTypedDate(text) : null;
          if (ymd && !(min && ymd < min)) { setError(""); if (ymd !== value) onChange(ymd); }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); commit(draft); }
          // ⌘↵ (Add task's shortcut) takes the typed date first, then submits
          // once it's in, as TimePicker does; a date that doesn't read stops it.
          else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const form = e.currentTarget.form;
            if (commit(draft) && form) setTimeout(() => form.requestSubmit(), 0);
          }
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
          // A click on the calendar's blank parts mustn't count as leaving it,
          // nor (where the field sits in a <label>) focus the text field.
          onMouseDown={(e) => { if (!e.target.closest("button")) e.preventDefault(); }}
          onClick={(e) => e.preventDefault()}
          aria-label={`${label || "Date"}: calendar`}
        >
          <CalendarBoundary>
            <Suspense fallback={<p className="df-loading">Loading…</p>}>
              <DayPickerPanel value={value} min={min} today={today} onPick={(ymd) => { take(ymd); close(); }} />
            </Suspense>
          </CalendarBoundary>
          {allowClear && value && (
            <button type="button" className="df-clear" onClick={() => { take(""); close(); }}>Clear</button>
          )}
        </div>
      )}
      {error && <span id={hintId} className="df-hint" role="alert">{error}</span>}
    </span>
  );
}
