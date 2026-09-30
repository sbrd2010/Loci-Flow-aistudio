import React, { useEffect, useRef, useState } from "react";
import { IconX } from "./ui/icons";

// The horizon review (57f) and Work · older Sort (57b.27) share one sheet:
// a dialog on a laptop, a sheet on a phone (the Edit horizons frame). Each
// row gets its place, then Done. "Later" leaves it for the Today line.
//
// review: { title, name, tasks } — each leftover: the same horizon's new
//   period (default) · Today · Drop.
// sort: { tasks, horizons } — each old Work task: a horizon (default This
//   week) or Drop, in a compact picker.
export default function HorizonReview({ review = null, sort = null, onDone, onClose }) {
  const tasks = (review || sort).tasks;
  const first = review ? "keep" : (sort.horizons.some(h => h.id === "week") ? "week" : sort.horizons[0]?.id);
  const [choices, setChoices] = useState(() => Object.fromEntries(tasks.map(t => [t.uuid, first])));
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, [review?.id]);
  useEffect(() => {
    setChoices(Object.fromEntries(tasks.map(t => [t.uuid, first])));
  }, [review?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const set = (uuid, to) => setChoices(c => ({ ...c, [uuid]: to }));
  const title = review ? review.title : "Work · older";
  const sub = review
    ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} left. Keep each for the new period, move it to Today, or drop it.`
    : "Give each a horizon, once.";
  const options = review ? [{ to: "keep", label: review.name }, { to: "today", label: "Today" }, { to: "drop", label: "Drop" }] : null;

  return (
    <div className="eh-scrim" onClick={onClose}>
      <div className="eh" role="dialog" aria-modal="true" aria-labelledby="rv-title" onClick={e => e.stopPropagation()}>
        <header className="eh-head">
          <h2 className="eh-title" id="rv-title" tabIndex={-1} ref={titleRef}>{title}</h2>
          <button type="button" className="eh-close" aria-label="Later" onClick={onClose}><IconX size={20} /></button>
        </header>
        <p className="eh-note">{sub}</p>
        <ul className="eh-places">
          {tasks.map(t => (
            <li key={t.uuid} className="eh-place">
              <span className="eh-place-title">{t.title}</span>
              {review ? (
                <span className="eh-seg" role="radiogroup" aria-label={`Where ${t.title} goes`}>
                  {options.map(o => (
                    <button key={o.to} type="button" role="radio" className="eh-seg-opt" aria-checked={choices[t.uuid] === o.to} onClick={() => set(t.uuid, o.to)}>
                      {o.label}
                    </button>
                  ))}
                </span>
              ) : (
                <select className="eh-input rv-pick" aria-label={`Where ${t.title} goes`} value={choices[t.uuid]} onChange={e => set(t.uuid, e.target.value)}>
                  {sort.horizons.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  <option value="drop">Drop</option>
                </select>
              )}
            </li>
          ))}
        </ul>
        <div className="eh-actions">
          <button type="button" className="eh-btn is-primary" onClick={() => onDone(choices)}>Done</button>
          <button type="button" className="eh-btn" onClick={onClose}>Later</button>
        </div>
      </div>
    </div>
  );
}
