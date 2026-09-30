import React, { useMemo, useRef, useState } from "react";
import { formatClock24, formatSpan } from "../utils/dayMapPlan";
import { defaultFixTime, describeFixMoves, previewFix, timeChips, toLociMinutes } from "../utils/fixedTime";
import { BREAK_LENGTHS, fitBreak } from "../utils/dayMapBreaks";
import { IconChevronRight, IconLock, IconPlus, IconX } from "./ui/icons";

// Setting a fixed time (58c–e). Step 1 chooses what: a stop on today's
// route, an unscheduled task, or something new (a call, a meeting). Step 2
// picks the time: six half-hour chips, the time typed, ↑↓ for 5 minutes,
// and a plain sentence of what moves before you confirm. A stop's own sheet
// ("Fix time") opens straight at step 2.
//
// A break (Q31) is chosen here too, on today's route only: now by default,
// or "Later…", the next free slot (Q36.1). It fits around fixed stops and
// other breaks, and says so (Q36.2, Q36a). A break row opens this sheet on
// its own break: Length, Time, Remove.

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
  routeTasks, unscheduledTasks, stops, task: initialTask, from, breaks, nowMins, dayStart, dayEnd, durationOf, getTaskId, onFix, onClose, newBlocked = false,
  breakDefault, laterAt, busy = [], breakItem = null, onBreak, onRemoveBreak, onTomorrow,
}) {
  const [task, setTask] = useState(initialTask || null);
  const [draft, setDraft] = useState(null); // { title, minutes } for something new
  const [brk, setBrk] = useState(breakItem ? { minutes: breakItem.lengthMin } : null); // { minutes } for a break
  const projected = initialTask ? routeTasks.find(t => getTaskId(t) === getTaskId(initialTask))?.dayMapStartMinutes : undefined;
  // Moving something whose time has passed ("Did it happen?" → Move, Q36a)
  // starts from now, not from the time it missed.
  const [at, setAt] = useState(() => (breakItem ? breakItem.start : onTomorrow ? defaultFixTime(undefined, nowMins) : defaultFixTime(initialTask?.dayMapFixedMinutes ?? projected, nowMins)));
  const [typed, setTyped] = useState(null);
  const [page, setPage] = useState(0);
  const timeRef = useRef(null);

  const step = task || draft || brk ? "time" : "choose";
  const fitted = brk ? fitBreak(at, brk.minutes, busy) : null;
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
    if (initialTask || breakItem) { onClose(); return; }
    setTask(null); setDraft(null); setBrk(null); setTyped(null);
  };
  const setTime = (m) => { setAt(toLociMinutes(m, dayStart, dayEnd)); setTyped(null); setPage(0); };
  // Evening Guard (Codex review of #425): something new is a new task, and
  // none are added at or after 8 PM while it is on; fixing a task's time is not.
  const blocked = !!draft && newBlocked;
  const confirm = () => {
    if (brk) { onBreak(fitted.start, fitted.lengthMin, breakItem ? breakItem.index : null); return; }
    if (draft && (!draft.title.trim() || blocked)) return;
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

  const title = step === "choose" ? "Fix a time" : task ? task.title : brk ? (breakItem ? "Break" : "A break") : "Something else";
  return (
    <>
      <div className="dm-sheet-scrim fx-scrim" onClick={onClose} aria-hidden="true" />
      <div className="fx-dialog" role="dialog" aria-modal="true" aria-label={step === "choose" ? "Fix a time" : breakItem ? "Break" : `Fix a time: ${title}`} onKeyDown={onKeyDown}>
        <div className="fx-head">
          <div>
            <h2 className="fx-title">{title}</h2>
            <p className="fx-sub">{step === "choose" ? "Choose what happens at a set time." : task && onTomorrow ? "A new time today, or tomorrow." : task ? "It stays at this time; the rest of the route flows around it." : brk ? "On today’s route only; what comes after it moves." : "A fixed stop that isn’t on your list yet."}</p>
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
            <button type="button" className="fx-else" onClick={() => { setBrk({ minutes: breakDefault.lengthMin }); setAt(breakDefault.start); }}>
              <IconPlus size={18} />
              <span className="fx-else-title">A break</span>
              <span className="fx-else-hint">on today’s route only</span>
            </button>
          </div>
        ) : (
          <div className="fx-time">
            {blocked && (
              <p className="add-warning" role="status">Evening Guard is on: adding tasks after 8 PM is blocked. Rest now.</p>
            )}
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
            {brk && (
              <div className="fx-fields">
                <label className="fx-field is-length">
                  <span className="fx-label">Length</span>
                  <select className="fx-input" autoFocus value={brk.minutes} onChange={e => setBrk({ minutes: Number(e.target.value) })}>
                    {[...new Set([...BREAK_LENGTHS, brk.minutes])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{formatSpan(m)}</option>)}
                  </select>
                </label>
                {!breakItem && <button type="button" className="fx-page fx-later" onClick={() => { setAt(laterAt); setTyped(null); setPage(0); }}>Later…</button>}
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
                autoFocus={!draft && !brk}
                value={typed ?? toClock(at)}
                onChange={e => { setTyped(e.target.value); const m = parseClock(e.target.value); if (m != null) { setAt(toLociMinutes(m, dayStart, dayEnd)); setPage(0); } }}
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
            {/* The live line stays mounted, empty or not: a region that
                appears with its text already in it is often not read (10b). */}
            <p className="fx-help fx-fit" aria-live="polite">
              {fitted?.after && <>Starts at {toClock(fitted.start)} · after {fitted.after}</>}
              {fitted?.after && fitted?.cut && <br />}
              {fitted?.cut && <>Ends at {toClock(fitted.start + fitted.lengthMin)} · {fitted.cut}</>}
            </p>
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
              <button type="button" className="fx-confirm" onClick={confirm} disabled={!!draft && (!draft.title.trim() || blocked)}>
                {brk ? (breakItem ? `Save · ${toClock(fitted.start)}` : `Add break at ${toClock(fitted.start)}`) : <><IconLock size={16} /> Fix at {toClock(at)}</>}
              </button>
              {breakItem && <button type="button" className="fx-back" onClick={() => onRemoveBreak(breakItem.index)}>Remove</button>}
              {task && onTomorrow && <button type="button" className="fx-back" onClick={onTomorrow}>Tomorrow</button>}
              <button type="button" className="fx-back" onClick={back}>{breakItem ? "Cancel" : "Back"}</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
