import React, { useEffect, useMemo, useState } from "react";
import LinkifyText from "./LinkifyText";
import ConfirmDialog from "./ConfirmDialog";
import {
  frontsFromConfig,
  normalizeFronts,
  sortFronts,
  frontNextMove,
  frontProgress,
  unassignedTasks,
  frontDueLabel,
  frontDaysLeft,
  planFooterSentence,
  makeFront,
  FRONT_NAME_MAX,
  FRONT_LIMIT,
  LEGACY_DEADLINE_FRONT_ID,
} from "../utils/fronts";
import "../styles/plan.css";

// Plan — screen 4 of the redesign: every front, each showing its single next
// move. Hairline rows, no cards, exactly one dominant element (the front with
// the nearest deadline).
//
// This does not replace the horizon board. Roadmap's week/month/quarter/6-month
// planning is real functionality the redesign has no screen for, so it stays
// reachable from the footer until the designer says where it goes.

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function countLabel(n) {
  const word = NUMBER_WORDS[n] ?? String(n);
  return `${word} ${n === 1 ? "front" : "fronts"}`;
}

function FrontBlock({ front, tasks, isLead, now, onClose }) {
  const nextMove = frontNextMove(front, tasks);
  const { done, total } = frontProgress(tasks, front.id);
  const due = frontDueLabel(front, now);
  const days = frontDaysLeft(front, now);
  // Clay is time pressure only, and only on the one that is actually pressing.
  const pressing = !front.parked && days !== null && days <= 14;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section className={`plan-front${front.parked ? " is-parked" : ""}${isLead ? " is-lead" : ""}`}>
      <div className="plan-front-head">
        <h3 className="plan-front-name">{front.name}</h3>
        {due && (
          <span className={`plan-front-due${pressing ? " is-pressing" : ""}${front.parked ? " is-parked-tag" : ""}`}>
            {due}
          </span>
        )}
        {onClose && (
          <button
            type="button"
            className="plan-front-close"
            aria-label={`Close the front ${front.name}`}
            onClick={() => onClose(front)}
          >
            Close
          </button>
        )}
      </div>

      {nextMove ? (
        <div className="plan-front-move">
          <span className="plan-front-rule" aria-hidden="true" />
          <span className="plan-front-move-text"><LinkifyText text={nextMove} /></span>
        </div>
      ) : (
        <div className="plan-front-move">
          <span className="plan-front-rule" aria-hidden="true" />
          <span className="plan-front-move-text plan-front-move-empty">No next move yet.</span>
        </div>
      )}

      {total > 0 && (
        <div className="plan-front-progress">
          <div className="plan-front-track">
            <div className="plan-front-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="plan-front-figure">{done}/{total}</span>
        </div>
      )}
    </section>
  );
}

export default function PlanTab({ payload = {}, savePayload, saveConfigPatch, onOpenHorizons, onScattered }) {
  const { tasks = [], config = {} } = payload;
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDate, setDraftDate] = useState("");

  // One `now` per render so every front on screen is measured against the same
  // instant — otherwise a render spanning midnight could show two different days.
  // Front deadlines are CALENDAR days parsed at local midnight, so this ticks on
  // the local date — not the loci day The week uses. Without it, a screen left
  // open across midnight (or resumed after sleep) kept "1d" instead of "0d" or
  // OVERDUE, and the ordering, the lead front and the fortnight footer all
  // stayed on yesterday.
  const [dayKey, setDayKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const id = setInterval(
      () => setDayKey(prev => {
        const next = new Date().toDateString();
        return next === prev ? prev : next; // same day ⇒ same state ⇒ no render
      }),
      60_000,
    );
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), [tasks, config, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const fronts = useMemo(() => sortFronts(frontsFromConfig(config), now), [config, now]);
  const footer = useMemo(() => planFooterSentence(fronts, tasks, now), [fronts, tasks, now]);
  // A task needs no front (Addendum C). Loose tasks are listed, never labelled
  // "Uncategorised" and never counted against the fronts above.
  const loose = useMemo(
    // Pass the fronts that actually rendered: a task pointing at a front that
    // was dropped in normalization belongs here, not nowhere.
    () => unassignedTasks(tasks, fronts.map(f => f.id)).filter(t => !t.isCompleted && !t.isParked),
    [tasks, fronts],
  );

  // The LIMIT applies to stored fronts. frontsFromConfig can return one more
  // than this (the legacy Key Deadline projection), which is not stored and so
  // does not consume a slot.
  const stored = useMemo(() => normalizeFronts(config.fronts), [config]);
  const atFrontLimit = stored.length >= FRONT_LIMIT;

  // Putting a loose task on a front. This writes task.frontId and nothing else:
  // a front's next move and progress are DERIVED from the tasks on it
  // (frontNextMove, frontProgress), so assignment alone is what makes a front
  // real. No ledger event — the app writes those for horizon moves, not for
  // category-like fields, and this is the latter.
  const assignToFront = (task, nextFrontId) => {
    if (!task?.uuid || !nextFrontId || typeof savePayload !== "function") return;
    savePayload({
      ...payload,
      tasks: (payload.tasks || []).map(t => (
        t.uuid === task.uuid ? { ...t, frontId: nextFrontId, lastUpdated: Date.now() } : t
      )),
    });
  };

  // Closing a front. It is removed from config.fronts; the tasks on it are not
  // touched and reappear under "Not on a front" (unassignedTasks already counts
  // a frontId naming no front as loose). Without this the cap was a dead end:
  // at FRONT_LIMIT the screen told the user to close one and nothing could.
  //
  // The legacy Key Deadline front is PROJECTED from config.deadlineLabel at
  // read time rather than stored, so there is nothing here to remove — it is
  // closed by clearing the deadline in Settings, and offering a button that
  // silently did nothing would be worse than offering none.
  const [closing, setClosing] = useState(null);
  const closeFront = (front) => {
    if (!front?.id || typeof saveConfigPatch !== "function") return;
    saveConfigPatch({ fronts: normalizeFronts(config.fronts).filter(f => f.id !== front.id) });
    setClosing(null);
  };

  const commitFront = () => {
    const front = makeFront({ name: draftName, dueAt: draftDate || null });
    if (!front) return;
    // normalizeFronts caps the list at FRONT_LIMIT, so appending to a full list
    // saved a front that the very next render dropped: the form closed, the
    // typed name was gone, and nothing said why.
    if (atFrontLimit) return;
    // Write only the STORED fronts plus the new one. The legacy Key Deadline is
    // a read-time projection; materialising it here would silently turn it into
    // stored data the user never asked to create.
    saveConfigPatch?.({ fronts: [...stored, front] });
    setDraftName("");
    setDraftDate("");
    setAdding(false);
  };

  return (
    <div className="plan-tab">
      <header className="plan-header">
        <div className="plan-header-text">
          <h2 className="plan-title">{countLabel(fronts.length)}</h2>
          <div className="plan-kicker">ONE NEXT MOVE EACH</div>
        </div>
        <button
          type="button"
          className="plan-new-front"
          onClick={() => setAdding(v => !v)}
          aria-expanded={adding}
          disabled={atFrontLimit}
        >
          New front
        </button>
      </header>

      {atFrontLimit && (
        <p className="plan-limit-note">
          That is {FRONT_LIMIT} fronts — the most Loci holds. Close one to make room.
        </p>
      )}

      {adding && (
        <div className="plan-new-form">
          <label className="plan-new-label" htmlFor="plan-new-name">What is the front?</label>
          <input
            id="plan-new-name"
            className="plan-new-input"
            value={draftName}
            maxLength={FRONT_NAME_MAX}
            autoFocus
            placeholder="Membrane paper"
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && draftName.trim()) commitFront(); }}
          />
          <label className="plan-new-label" htmlFor="plan-new-date">Deadline, if it has one</label>
          <input
            id="plan-new-date"
            className="plan-new-input"
            type="date"
            value={draftDate}
            onChange={e => setDraftDate(e.target.value)}
          />
          <div className="plan-new-actions">
            <button type="button" className="plan-new-commit" disabled={!draftName.trim() || atFrontLimit} onClick={commitFront}>
              Add the front
            </button>
            <button type="button" className="plan-new-cancel" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {fronts.length === 0 ? (
        <p className="plan-empty">
          Nothing is running yet. A front is one piece of work with its own deadline —
          a paper, a rig, a resubmission. Name the first one.
        </p>
      ) : (
        <div className="plan-fronts">
          {fronts.map((front, i) => (
            <FrontBlock
              key={front.id}
              front={front}
              tasks={tasks}
              isLead={i === 0 && !front.parked}
              now={now}
              onClose={front.id === LEGACY_DEADLINE_FRONT_ID ? undefined : setClosing}
            />
          ))}
        </div>
      )}

      {loose.length > 0 && (
        <section className="plan-loose">
          <div className="plan-loose-head">
            <h3 className="plan-loose-name">Not on a front</h3>
            <span className="plan-loose-count">{loose.length}</span>
          </div>
          <ul className="plan-loose-list">
            {loose.map(t => (
              <li key={t.uuid || t.id} className="plan-loose-row">
                <span className="plan-loose-title"><LinkifyText text={t.title} /></span>
                {fronts.length > 0 && typeof savePayload === "function" && (
                  // Resets to "" after each change: it is an action, not a
                  // stored value — once assigned, the row leaves this list.
                  <select
                    className="plan-loose-assign"
                    value=""
                    aria-label={`Put ${t.title} on a front`}
                    onChange={e => assignToFront(t, e.target.value)}
                  >
                    <option value="">Put on a front…</option>
                    {fronts.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {footer && <p className="plan-footer">{footer}</p>}

      {onScattered && (
        <button type="button" className="plan-scattered" onClick={onScattered}>
          I'm scattered
        </button>
      )}

      {onOpenHorizons && (
        <button type="button" className="plan-horizons-link" onClick={onOpenHorizons}>
          Plan by time horizon instead
        </button>
      )}

      {closing && (
        <ConfirmDialog
          message={`Close "${closing.name}"?\n\nThe front goes away. Nothing on it is deleted — those tasks move back to "Not on a front".`}
          confirmLabel="Close the front"
          cancelLabel="Keep it"
          danger
          onConfirm={() => closeFront(closing)}
          onCancel={() => setClosing(null)}
        />
      )}
    </div>
  );
}
