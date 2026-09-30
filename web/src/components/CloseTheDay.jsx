import React, { useEffect, useRef, useState } from "react";
import { IconX } from "./ui/icons";
import { defaultChoice, doneTodayCount, leftovers } from "../utils/closeDay";
import { confirmedMinimumDay } from "../utils/minimumDay";
import { formatSpan } from "../utils/dayMapPlan";
import { doneToday } from "../utils/dayMapFacts";
import { useFocusLedger } from "../hooks/useFocusLedger";

// Close the day (55d–e, Q47): one screen, under a minute. Done today (its
// focus time when known), the minimum day, each leftover → Tomorrow · Plan ·
// Drop, "First thing tomorrow?", an optional line about today, then Close
// the day (Enter). A dialog on a laptop, a sheet on a phone.
const OPTIONS = [{ to: "tomorrow", label: "Tomorrow" }, { to: "plan", label: "Plan" }, { to: "drop", label: "Drop" }];
const key = (t) => String(t.uuid || t.id);

export default function CloseTheDay({ payload, day, uid, windows, onClose, onCancel }) {
  const tasks = payload.tasks || [];
  const config = payload.config || {};
  // Today's focus time, from the sessions (59j), when the ledger answers.
  const { raw, status } = useFocusLedger(uid, 1, windows);
  const focusMin = status === "ready" ? doneToday(raw, tasks, day, windows).reduce((sum, r) => sum + r.minutes, 0) : null;
  const left = leftovers(tasks, day);
  const [choices, setChoices] = useState(() => Object.fromEntries(left.map(t => [key(t), defaultChoice(t)])));
  // The one thing, if it goes to tomorrow, is tomorrow's first thing too.
  const [first, setFirst] = useState(() => {
    const pinned = left.find(t => t.isNowFocus && defaultChoice(t) === "tomorrow");
    return pinned ? key(pinned) : null;
  });
  const [lineOpen, setLineOpen] = useState(false);
  const [note, setNote] = useState("");
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const done = doneTodayCount(tasks, day);
  const minIds = confirmedMinimumDay(config, day);
  const minDone = minIds ? minIds.filter(id => tasks.some(t => key(t) === id && t.isCompleted)).length : 0;
  const tomorrowBound = left.filter(t => choices[key(t)] === "tomorrow");
  const firstThing = first && tomorrowBound.some(t => key(t) === first) ? first : null;
  const close = () => onClose({
    choices, firstThing, note: lineOpen ? note : "",
    summary: { focusMin, minimum: minIds ? { done: minDone, total: minIds.length } : null },
  });

  return (
    <div className="eh-scrim" onClick={onCancel}>
      <div
        className="eh cd"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cd-title"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === "Enter" && !e.defaultPrevented && e.target.tagName !== "BUTTON") { e.preventDefault(); close(); } }}
      >
        <header className="eh-head">
          <h2 className="eh-title" id="cd-title" tabIndex={-1} ref={titleRef}>Close the day</h2>
          <button type="button" className="eh-close" aria-label="Not yet" onClick={onCancel}><IconX size={20} /></button>
        </header>
        <p className="cd-done">
          Done today · {done}{Number.isFinite(focusMin) && focusMin > 0 ? ` · ${formatSpan(focusMin)}` : ""}
        </p>
        {minIds && <p className="eh-note cd-min">Minimum day · {minDone} of {minIds.length} done</p>}

        {left.length > 0 && (
          <>
            <ul className="eh-places">
              {left.map(t => (
                <li key={key(t)} className="eh-place">
                  <span className="eh-place-title">{t.title}</span>
                  <span className="eh-seg" role="radiogroup" aria-label={`Where ${t.title} goes`}>
                    {OPTIONS.map(o => (
                      <button key={o.to} type="button" role="radio" className="eh-seg-opt" aria-checked={choices[key(t)] === o.to}
                        onClick={() => setChoices(c => ({ ...c, [key(t)]: o.to }))}>
                        {o.label}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {tomorrowBound.length > 0 && (
              <fieldset className="cd-first">
                <legend className="eh-sub">First thing tomorrow?</legend>
                {tomorrowBound.map(t => (
                  <label key={key(t)} className="cd-first-opt">
                    <input type="radio" name="cd-first" checked={firstThing === key(t)} onChange={() => setFirst(key(t))} />
                    <span>{t.title}</span>
                  </label>
                ))}
                <label className="cd-first-opt">
                  <input type="radio" name="cd-first" checked={!firstThing} onChange={() => setFirst(null)} />
                  <span>Decide tomorrow</span>
                </label>
              </fieldset>
            )}
          </>
        )}

        {/* 47.2: one optional line, where the evening note went. */}
        {lineOpen ? (
          <>
            <label className="eh-label" htmlFor="cd-line">A line about today</label>
            <input id="cd-line" className="eh-input" value={note} maxLength={280} autoFocus placeholder="How did today go?" onChange={e => setNote(e.target.value)} />
          </>
        ) : (
          <button type="button" className="cd-line-open" onClick={() => setLineOpen(true)}>Add a line about today</button>
        )}

        <div className="eh-actions">
          <button type="button" className="eh-btn is-primary" onClick={close}>Close the day</button>
          <button type="button" className="eh-btn" onClick={onCancel}>Not yet</button>
        </div>
      </div>
    </div>
  );
}
