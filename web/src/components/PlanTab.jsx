import React, { useMemo, useState } from "react";
import LinkifyText from "./LinkifyText";
import {
  frontsFromConfig,
  normalizeFronts,
  sortFronts,
  frontNextMove,
  frontProgress,
  frontDueLabel,
  frontDaysLeft,
  planFooterSentence,
  makeFront,
  FRONT_NAME_MAX,
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

function FrontBlock({ front, tasks, isLead, now }) {
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

export default function PlanTab({ payload = {}, saveConfigPatch, onOpenHorizons }) {
  const { tasks = [], config = {} } = payload;
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDate, setDraftDate] = useState("");

  // One `now` per render so every front on screen is measured against the same
  // instant — otherwise a render spanning midnight could show two different days.
  const now = useMemo(() => new Date(), [tasks, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const fronts = useMemo(() => sortFronts(frontsFromConfig(config), now), [config, now]);
  const footer = useMemo(() => planFooterSentence(fronts, tasks, now), [fronts, tasks, now]);

  const commitFront = () => {
    const front = makeFront({ name: draftName, dueAt: draftDate || null });
    if (!front) return;
    // Write only the STORED fronts plus the new one. The legacy Key Deadline is
    // a read-time projection; materialising it here would silently turn it into
    // stored data the user never asked to create.
    saveConfigPatch?.({ fronts: [...normalizeFronts(config.fronts), front] });
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
        >
          New front
        </button>
      </header>

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
            <button type="button" className="plan-new-commit" disabled={!draftName.trim()} onClick={commitFront}>
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
            <FrontBlock key={front.id} front={front} tasks={tasks} isLead={i === 0 && !front.parked} now={now} />
          ))}
        </div>
      )}

      {footer && <p className="plan-footer">{footer}</p>}

      {onOpenHorizons && (
        <button type="button" className="plan-horizons-link" onClick={onOpenHorizons}>
          Plan by time horizon instead
        </button>
      )}
    </div>
  );
}
