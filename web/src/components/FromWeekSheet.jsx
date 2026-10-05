import React, { useEffect, useRef, useState } from "react";
import "../styles/moreSheet.css";

// From This week (67s): with nothing in Today, pick This week tasks to bring
// in. Checkbox rows, then "Move N to Today" (off at 0) and a way to Plan.
// The first one picked becomes the one thing (TodayTab). Esc, the scrim or a
// choice closes it; Tab stays inside it.

export default function FromWeekSheet({ tasks, onMove, onOpenPlan, onClose }) {
  const [picked, setPicked] = useState([]);
  const panelRef = useRef(null);
  const openerRef = useRef(typeof document !== "undefined" ? document.activeElement : null);
  useEffect(() => {
    panelRef.current?.focus();
    const opener = openerRef.current;
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const onKeyDown = (e) => {
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll("button:not(:disabled), input")];
    const i = items.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
    e.preventDefault();
    items[next]?.focus();
  };

  // Kept in the order ticked: the first ticked is the one thing.
  const toggle = (uuid) => setPicked(p => p.includes(uuid) ? p.filter(u => u !== uuid) : [...p, uuid]);

  return (
    <>
      <div className="more-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="more-sheet week-sheet" role="dialog" aria-modal="true" aria-label="From This week" tabIndex={-1} onKeyDown={onKeyDown}>
        <span className="more-grip" aria-hidden="true" />
        <p className="more-title">From This week</p>
        <ul className="week-sheet-list">
          {tasks.map(t => (
            <li key={t.uuid}>
              <label className="week-sheet-row">
                <input type="checkbox" checked={picked.includes(t.uuid)} onChange={() => toggle(t.uuid)} />
                <span className="week-sheet-title">{t.title}</span>
              </label>
            </li>
          ))}
        </ul>
        <button type="button" className="week-sheet-move" disabled={!picked.length} onClick={() => { onClose(); onMove(picked); }}>
          Move {picked.length} to Today
        </button>
        {onOpenPlan && (
          <button type="button" className="week-sheet-plan" onClick={() => { onClose(); onOpenPlan(); }}>Open This week in Plan</button>
        )}
      </div>
    </>
  );
}
