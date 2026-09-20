import React, { useEffect, useMemo, useState } from "react";
import LinkifyText from "./LinkifyText";
import { narrowDown, numberWord } from "../utils/narrowDown";
import "../styles/scattered.css";

// Screen 14 — "When you're scattered". Fourteen open things become one,
// visibly, because being told "do this one" isn't persuasive but watching
// thirteen things get eliminated for stated reasons is.
//
// Every figure here is computed (see narrowDown.js). Nothing on this screen is
// generated prose, and nothing is written: the tasks that drop out of the
// ledger are untouched in the payload and still on the user's list. The copy
// below has to say exactly that. It previously said they were "parked until
// tomorrow", which is a promise this flow does not keep — and "parked" is
// already a real state in this app (isParked / task_parked), so it read as a
// claim that a mutation had happened when none had.
//
// Starting a session follows Day Map's pattern rather than driving the timer
// directly — pin the task, hand the confirmed-write promise up, and let the
// owner of the session lifecycle open it. Reimplementing that here would risk
// orphaned sessions and missing ledger events.

export default function ScatteredFlow({
  payload = {},
  savePayload,
  savePayloadAsync,
  flushNow,
  onStartFocus,
  onBack,
}) {
  const { tasks = [], config = {} } = payload;
  const [showParked, setShowParked] = useState(false);

  // The entry point sits at the foot of Plan, so without this you arrive
  // scrolled halfway down with the headline behind the app header — on the one
  // screen whose whole job is to orient someone who is already overwhelmed.
  useEffect(() => {
    document.querySelector(".screen-content")?.scrollTo?.({ top: 0 });
    window.scrollTo?.({ top: 0 });
  }, []);

  // Nothing on this screen was clock-driven, so the remaining-time cut — and
  // therefore the chosen task — stayed frozen at the moment it opened. Left
  // open at 11:30 inside a window ending at noon, it went on claiming thirty
  // minutes and keeping a 25-minute task that no longer fits. State only
  // changes when the minute number actually does, so this is not a re-render
  // every thirty seconds. The trade is that the choice can shift under a
  // screen left open a long time; a recommendation that cannot be acted on is
  // the worse of the two.
  const [minuteTick, setMinuteTick] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const id = setInterval(() => setMinuteTick(Math.floor(Date.now() / 60000)), 30000);
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), [tasks, config, minuteTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const result = useMemo(() => narrowDown(tasks, config, now), [tasks, config, now]);
  const { total, rows, chosen, why, parked } = result;

  const start = (minutes) => {
    if (!chosen) return;
    const stamp = Date.now();
    const nextTasks = tasks.map(t => {
      const shouldFocus = t.uuid === chosen.uuid;
      if (t.isNowFocus === shouldFocus) return t;
      return { ...t, isNowFocus: shouldFocus, lastUpdated: stamp };
    });
    const next = { ...payload, tasks: nextTasks, timestamp: stamp };
    const pinPromise = typeof savePayloadAsync === "function"
      ? savePayloadAsync(next)
      : (savePayload?.(next), Promise.resolve());
    flushNow?.();
    onStartFocus?.(pinPromise, minutes);
  };

  if (!chosen) {
    return (
      <div className="scattered">
        <header className="scattered-head">
          {onBack && <button type="button" className="scattered-back" onClick={onBack}>Back</button>}
          <span className="scattered-kicker">NOTHING TO NARROW</span>
        </header>
        <p className="scattered-empty">
          There's nothing open. That isn't a gap to fill — it's the state the
          rest of this app is trying to get you to.
        </p>
      </div>
    );
  }

  return (
    <div className="scattered">
      <header className="scattered-head">
        {onBack && <button type="button" className="scattered-back" onClick={onBack}>Back</button>}
        <span className="scattered-kicker">NARROWING DOWN</span>
      </header>

      <h1 className="scattered-headline">
        {numberWord(total)} open {total === 1 ? "thing" : "things"}. Let's get it down to one.
      </h1>

      {/* The reduction, shown rather than summarised. */}
      <ol className="scattered-ledger">
        {rows.map(row => (
          <li key={row.key} className={`scattered-row${row.isFinal ? " is-final" : ""}`}>
            <span className="scattered-figure">{row.figure}</span>
            <span className="scattered-reason">{row.reason}</span>
          </li>
        ))}
      </ol>

      <section className="scattered-pick">
        <div className="scattered-pick-kicker">SO — THIS ONE</div>
        <h2 className="scattered-pick-title"><LinkifyText text={chosen.title} /></h2>
        {why && <p className="scattered-why">{why}</p>}

        <div className="scattered-pick-rule" />

        <div className="scattered-small-kicker">START SMALL — 5 MINUTES</div>
        {chosen.concreteStep ? (
          <p className="scattered-first-action"><LinkifyText text={chosen.concreteStep} /></p>
        ) : (
          <p className="scattered-first-action">
            Open it and do the smallest visible piece. Badly is fine.
          </p>
        )}

        <div className="scattered-actions">
          <button type="button" className="scattered-primary" onClick={() => start(5)}>
            Just 5 minutes
          </button>
          <button type="button" className="scattered-secondary" onClick={() => start(25)}>
            Full 25 instead
          </button>
        </div>
      </section>

      {parked.length > 0 && (
        <footer className="scattered-foot">
          <p className="scattered-parked-line">
            The other {parked.length} {parked.length === 1 ? "is" : "are"} out of the way, not gone.{" "}
            <button type="button" className="scattered-show" onClick={() => setShowParked(v => !v)}>
              {showParked ? "Hide them" : "Show them"}
            </button>
          </p>
          {showParked && (
            <ul className="scattered-parked-list">
              {parked.map(t => (
                <li key={t.uuid || t.id} className="scattered-parked-row">
                  <LinkifyText text={t.title} />
                </li>
              ))}
            </ul>
          )}
          <p className="scattered-reassure">
            Nothing was changed or deleted. They are still on your list, waiting
            for when you have room for them.
          </p>
        </footer>
      )}
    </div>
  );
}
