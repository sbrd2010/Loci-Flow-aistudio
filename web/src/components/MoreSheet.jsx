import React, { useEffect, useRef, useState } from "react";
import "../styles/moreSheet.css";

// More (58.3, 67d): the one thing's other actions, on the phone. Split it ·
// Details · Move to… (Tomorrow, This week, This month; horizons only, no
// date) · Park · Not the one thing, then Delete apart, in --danger. Every
// action happens at once, with the Undo toast (Q58 check: no confirm).
// Esc, the scrim or a choice closes it; Tab stays inside it. A horizon
// hidden in Settings isn't offered: a task moved there would drop off Plan.

const MOVES = [
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
];

export default function MoreSheet({ task, hiddenHorizons = [], onSplit, onDetails, onMove, onPark, onUnpin, onDelete, onClose }) {
  const [moveOpen, setMoveOpen] = useState(false);
  const moves = MOVES.filter(m => !hiddenHorizons.includes(m.id));
  const panelRef = useRef(null);
  // Focus goes back to what opened it (More), so a flow it starts, such as
  // Split, can hand focus back there in turn.
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

  // Modal: Tab and Shift+Tab stay inside it.
  const onKeyDown = (e) => {
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
    e.preventDefault();
    items[next]?.focus();
  };

  const act = (fn) => () => { onClose(); fn?.(); };
  const row = (label, sub, onClick, extra = {}) => (
    <button type="button" className="more-row" onClick={onClick} {...extra}>
      <span className="more-row-title">{label}</span>
      {sub && <span className="more-row-sub">{sub}</span>}
    </button>
  );

  return (
    <>
      <div className="more-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="more-sheet" role="dialog" aria-modal="true" aria-label={`More: ${task.title}`} tabIndex={-1} onKeyDown={onKeyDown}>
        <span className="more-grip" aria-hidden="true" />
        <p className="more-title">{task.title}</p>
        {onSplit && row("Split it", "Break it into smaller steps", act(onSplit))}
        {onDetails && row("Details", "Full title, notes, step list", act(onDetails))}
        {onMove && row("Move to…", moves.map(m => m.label).join(", "), () => setMoveOpen(o => !o), { "aria-expanded": moveOpen })}
        {onMove && moveOpen && (
          <div className="more-moves" role="group" aria-label="Move to">
            {moves.map(m => (
              <button key={m.id} type="button" className="more-move" onClick={act(() => onMove(m.id))}>{m.label}</button>
            ))}
          </div>
        )}
        {onPark && row("Park", "Out of Today, into the parked fold", act(onPark))}
        {onUnpin && row("Not the one thing", "Keep it in Today, pick another", act(onUnpin))}
        {onDelete && (
          <button type="button" className="more-delete" onClick={act(onDelete)}>Delete</button>
        )}
      </div>
    </>
  );
}
