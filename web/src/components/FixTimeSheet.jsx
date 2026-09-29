import React, { useMemo, useRef, useState } from "react";
import { formatClock24, formatSpan } from "../utils/dayMapPlan";
import { defaultFixTime, describeFixMoves, previewFix, timeChips, toLociMinutes } from "../utils/fixedTime";
import { IconChevronRight, IconLock, IconPlus, IconX } from "./ui/icons";

// Setting a fixed time (58c–e). Step 1 chooses what: a stop on today's
// route, an unscheduled task, or something new (a call, a meeting). Step 2
// picks the time: six half-hour chips, the time typed, ↑↓ for 5 minutes,
// and a plain sentence of what moves before you confirm. A stop's own sheet
// ("Fix time") opens straight at step 2.

const LENGTHS = [15, 30, 45, 60, 90, 120];
const DRAFT_ID = "__fix-draft__";

const toClock = (m) => formatClock24(m);
function parseClock(text) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(text).trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export default function FixTimeSheet({
  routeTasks, unscheduledTasks, stops, task: initialTask, from, breaks, nowMins, dayStart, durationOf, getTaskId, onFix, onClose,
}) {
  const [task, setTask] = useState(initialTask || null);
  const [draft, setDraft] = useState(null); // { title, minutes } for something new
  const projected = initialTask ? routeTasks.find(t => getTaskId(t) === getTaskId(initialTask))?.dayMapStartMinutes : undefined;
  const [at, setAt] = useState(() => defaultFixTime(initialTask?.dayMapFixedMinutes ?? projected, nowMins));
  const [typed, setTyped] = useState(null);
  const [page, setPage] = useState(0);
  const timeRef = useRef(null);

  const step = task || draft ? "time" : "choose";
  const subject = task || (draft && { uuid: DRAFT_ID, title: draft.title.trim() || "it", timeEstimateMinutes: draft.minutes });
  const moves = useMemo(() => {
    if (!subject) return null;
    const durations = (t) => (getTaskId(t) === DRAFT_ID ? draft.minutes : durationOf(t));
    return describeFixMoves(previewFix(stops, subject, at, { from, breaks, durationOf: durations }), subject);
  }, [subject, at, stops, from, breaks, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (t) => {
    setTask(t);
    const start = routeTasks.find(r => getTaskId(r) === getTaskId(t))?.dayMapStartMinutes;
    setAt(defaultFixTime(t.dayMapFixedMinutes ?? start, nowMins));
    setPage(0);
  };
  const back = () => {
    if (initialTask) { onClose(); return; }
    setTask(null); setDraft(null); setTyped(null);
  };
  const setTime = (m) => { setAt(toLociMinutes(m, dayStart)); setTyped(null); setPage(0); };
  const confirm = () => {
    if (draft && !draft.title.trim()) return;
    onFix(task || { title: draft.title.trim(), minutes: draft.minutes }, at, !task);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    // Modal: Tab and Shift+Tab stay inside it.
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll("button:enabled, input, select")];
    const i = items.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
    e.preventDefault();
    items[next]?.focus();
  };

  const title = step === "choose" ? "Fix a time" : task ? task.title : "Something else";
  return (
    <>
      <div className="dm-sheet-scrim fx-scrim" onClick={onClose} aria-hidden="true" />
      <div className="fx-dialog" role="dialog" aria-modal="true" aria-label={step === "choose" ? "Fix a time" : `Fix a time: ${title}`} onKeyDown={onKeyDown}>
        <div className="fx-head">
          <div>
            <h2 className="fx-title">{title}</h2>
            <p className="fx-sub">{step === "choose" ? "Choose what happens at a set time." : task ? "It stays at this time; the rest of the route flows around it." : "A fixed stop that isn’t on your list yet."}</p>
          </div>
          <button type="button" className="dm-sheet-close" onClick={onClose} aria-label="Close" autoFocus={step === "choose"}>
            <IconX size={20} />
          </button>
        </div>

        {step === "choose" ? (
          <div className="fx-choose">
            {routeTasks.length > 0 && <h3 className="fx-group">ON TODAY’S ROUTE</h3>}
            <ul className="fx-list">
              {routeTasks.map(t => (
                <li key={getTaskId(t)}>
                  <button type="button" className="fx-option" onClick={() => pick(t)}>
                    <span className="fx-option-title">{t.title}</span>
                    <span className="fx-option-meta">{toClock(t.dayMapStartMinutes)} · {formatSpan(durationOf(t))}</span>
                    <IconChevronRight size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {unscheduledTasks.length > 0 && <h3 className="fx-group">UNSCHEDULED</h3>}
            <ul className="fx-list">
              {unscheduledTasks.map(t => (
                <li key={getTaskId(t)}>
                  <button type="button" className="fx-option" onClick={() => pick(t)}>
                    <span className="fx-option-title">{t.title}</span>
                    <span className="fx-option-meta">{formatSpan(durationOf(t))}</span>
                    <IconChevronRight size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="fx-else" onClick={() => { setDraft({ title: "", minutes: 30 }); setAt(defaultFixTime(undefined, nowMins)); }}>
              <IconPlus size={18} />
              <span className="fx-else-title">Something else…</span>
              <span className="fx-else-hint">a call, a meeting</span>
            </button>
          </div>
        ) : (
          <div className="fx-time">
            {draft && (
              <div className="fx-fields">
                <label className="fx-field is-what">
                  <span className="fx-label">What</span>
                  <input className="fx-input" value={draft.title} autoFocus placeholder="Call with…" onChange={e => setDraft({ ...draft, title: e.target.value })} />
                </label>
                <label className="fx-field is-length">
                  <span className="fx-label">Length</span>
                  <select className="fx-input" value={draft.minutes} onChange={e => setDraft({ ...draft, minutes: Number(e.target.value) })}>
                    {LENGTHS.map(m => <option key={m} value={m}>{formatSpan(m)}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="fx-at">
              <span className="fx-label" id="fx-at-label">At</span>
              <input
                ref={timeRef}
                className="fx-clock"
                aria-labelledby="fx-at-label"
                aria-describedby="fx-at-help"
                inputMode="numeric"
                autoFocus={!draft}
                value={typed ?? toClock(at)}
                onChange={e => { setTyped(e.target.value); const m = parseClock(e.target.value); if (m != null) { setAt(toLociMinutes(m, dayStart)); setPage(0); } }}
                onBlur={() => setTyped(null)}
                onKeyDown={e => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); setTime(at + (e.key === "ArrowUp" ? 5 : -5)); }
                  if (e.key === "Enter") { e.preventDefault(); confirm(); }
                }}
              />
            </div>
            <div className="fx-chips" role="radiogroup" aria-label="Times">
              {timeChips(at, page).map(m => (
                <button key={m} type="button" role="radio" aria-checked={m === at} className="fx-chip" onClick={() => setTime(m)}>
                  {toClock(m)}
                </button>
              ))}
            </div>
            <div className="fx-pager">
              <button type="button" className="fx-page" onClick={() => setPage(p => p - 1)}>Earlier ←</button>
              <span className="fx-help" id="fx-at-help">Tap the time to type it · ↑↓ = 5 min</span>
              <button type="button" className="fx-page" onClick={() => setPage(p => p + 1)}>→ Later</button>
            </div>
            {moves && (
              <div className="fx-moves" aria-live="polite">
                <p className="fx-moves-kicker">What moves</p>
                <p className="fx-moves-text">
                  {moves.fits && <>{moves.fits.title} ({toClock(moves.fits.start)}–{toClock(moves.fits.end)}) still fits before it. </>}
                  {moves.moved
                    ? <>{moves.moved.title} moves from {toClock(moves.moved.from)} to <strong>{toClock(moves.moved.to)}</strong>{moves.moved.to > at ? ", after it" : ""}{moves.moved.more ? `; ${moves.moved.more} more ${moves.moved.more === 1 ? "stop moves" : "stops move"} too` : ""}. </>
                    : "Nothing else moves. "}
                  Your day now ends at <strong>{toClock(moves.dayEnds)}</strong>.
                </p>
              </div>
            )}
            <div className="fx-foot">
              <button type="button" className="fx-confirm" onClick={confirm} disabled={!!draft && !draft.title.trim()}>
                <IconLock size={16} /> Fix at {toClock(at)}
              </button>
              <button type="button" className="fx-back" onClick={back}>Back</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
