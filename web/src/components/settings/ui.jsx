import React, { useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconExternalLink } from "../ui/icons";

// Settings building blocks (44a–k): grouped lists with hairline rows at least
// 52px, a kicker over each group, switches on the right, and a back link on
// every sub-page.

export function Group({ label, children, note }) {
  return (
    <section className="set-group" aria-label={label || undefined}>
      {label && <h3 className="set-kicker">{label}</h3>}
      <div className="set-list">{children}</div>
      {note && <p className="set-note">{note}</p>}
    </section>
  );
}

// A row that opens something: a title, an optional line under it, an optional
// value on the right, then a chevron (or an external-link mark).
export function Row({ title, sub, value, onClick, danger = false, external = false, children }) {
  return (
    <button type="button" className={`set-row${danger ? " is-danger" : ""}`} onClick={onClick}>
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      {children}
      {value != null && <span className="set-row-value">{value}</span>}
      {(external || !danger) && (
        <span className="set-row-chevron" aria-hidden="true">
          {external ? <IconExternalLink size={16} /> : <IconChevronRight size={18} />}
        </span>
      )}
    </button>
  );
}

// A row with a switch. The whole row toggles; the switch is the control that
// screen readers hear.
export function SwitchRow({ title, sub, checked, onChange }) {
  return (
    <div className="set-row is-switch" onClick={() => onChange(!checked)}>
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      <button
        type="button"
        role="switch"
        className="set-switch"
        aria-checked={!!checked}
        aria-label={title}
        onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      />
    </div>
  );
}

// A sub-page: "< Settings" (or the section it came from), then its title.
export function SubPage({ title, backLabel = "Settings", onBack, lede, children }) {
  const headingRef = useRef(null);
  // Arriving on a page puts focus on its title, so keyboard and screen-reader
  // users land where the content changed.
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <div className="set-page">
      {onBack && (
        <button type="button" className="set-back" onClick={onBack}>
          <IconChevronLeft size={18} /> {backLabel}
        </button>
      )}
      <h2 className="set-title" tabIndex={-1} ref={headingRef}>{title}</h2>
      {lede && <p className="set-lede">{lede}</p>}
      {children}
    </div>
  );
}

// A choice from a short list (Focus timer, Reminder before, Anchors on Today):
// radio rows, saved on tap.
export function RadioList({ label, options, value, onChange }) {
  return (
    <div className="set-list" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="set-row is-radio"
          onClick={() => onChange(o.value)}
        >
          <span className="set-radio" aria-hidden="true" />
          <span className="set-row-text">
            <span className="set-row-title">{o.label}</span>
            {o.sub && <span className="set-row-sub">{o.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

// Text that saves as you type (44c: "Changes save as you type"): held locally,
// written 600ms after the last keystroke and on blur, so typing a paragraph is
// a handful of writes rather than one per key. A value arriving from another
// device replaces the draft only while the field isn't being edited.
export function useAutosave(saved, commit, delay = 600) {
  const [draft, setDraft] = useState(saved ?? "");
  const editing = useRef(false);
  const timer = useRef(null);
  const latest = useRef(draft);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => { if (!editing.current) { setDraft(saved ?? ""); latest.current = saved ?? ""; } }, [saved]);

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (editing.current) { editing.current = false; commitRef.current(latest.current); }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (v) => {
    editing.current = true;
    latest.current = v;
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  return [draft, change, flush];
}

