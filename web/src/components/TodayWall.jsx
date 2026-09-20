import React from "react";
import LinkifyText from "./LinkifyText";
import "../styles/todayWall.css";

// Screen 1 — "Today, the wall with a peek". Two states, one screen.
//
// CLOSED ("the wall", 9b): the commitment fills the screen and IS the start
// button. There is deliberately no separate filled primary competing with it —
// the handoff is explicit that the task itself is what you tap.
//
// OPEN ("the desk", 9c): the hero stops being a button and becomes plain
// markup, the title drops, and a conventional filled "Start focus" button
// appears. Once the list below is visible an explicit button is needed, or
// tapping the task competes with the rows for "what does tapping do here".
//
// The sizes come from the two-state prose in the handoff (42/800 closed,
// 29/700 open), not from its type table or its Components list, which both
// predate Resolved Decision 1's merge of the two heroes and still describe a
// single 34/700 hero. Raised with the designer.

function pad2(n) {
  return String(n).padStart(2, "0");
}

export default function TodayWall({
  task,
  frontName,
  daysLeft,
  dateLabel,
  hoursLeftLabel,
  focusMinutes = 25,
  peekOpen,
  onTogglePeek,
  remainingCount = 0,
  doneCount = 0,
  minutesInLabel,
  lowEnergy = false,
  onStartFocus,
  onMarkDone,
  onSplit,
  onChooseCommitment,
  onScattered,
  openCount = 0,
}) {
  const timer = `${pad2(focusMinutes)}:00`;
  // "The kicker becomes the front name *or* nothing — never 'Uncategorised'."
  const kicker = frontName ? `${frontName} · YOU COMMITTED TO` : "YOU COMMITTED TO";
  // Clay is time pressure ONLY. A deadline a year out is not pressure, so the
  // figure still shows but drops to the quiet tier — otherwise the one alert
  // colour in the design is spent on something that isn't urgent.
  const hasDays = Number.isFinite(daysLeft) && daysLeft !== null;
  const pressing = hasDays && daysLeft <= 14;

  const header = (
    <header className="wall-head">
      <span className="wall-head-when">
        {dateLabel}{hoursLeftLabel ? ` · ${hoursLeftLabel}` : ""}
      </span>
      {hasDays && (
        <span className={`wall-head-days${pressing ? " is-pressing" : ""}`}>{daysLeft}d</span>
      )}
    </header>
  );

  // Nothing committed yet. The handoff says the wall renders the first-launch
  // question inline; that screen is not built, so this asks the same question
  // with the picker the app already has, rather than inventing a second one.
  if (!task) {
    return (
      <section className={`today-wall${peekOpen ? " is-open" : ""}`}>
        {header}
        <div className="wall-empty">
          <div className="wall-kicker">SO — WHAT'S THE ONE THING TODAY?</div>
          <p className="wall-empty-line">
            One thing. You can change it whenever — that's not failure.
          </p>
          <button type="button" className="wall-primary" onClick={onChooseCommitment}>
            Choose today's one thing
          </button>
        </div>
      </section>
    );
  }

  const support = task.concreteStep || null;

  return (
    <section className={`today-wall${peekOpen ? " is-open" : ""}`}>
      {header}

      {peekOpen ? (
        // — the desk —
        <div className="wall-body">
          <div className="wall-kicker">{kicker}</div>
          <h2 className="wall-title is-desk"><LinkifyText text={task.title} /></h2>
          {support && (
            <div className="wall-support-row">
              <span className="wall-rule" aria-hidden="true" />
              <span className="wall-support"><LinkifyText text={support} /></span>
            </div>
          )}
          <button type="button" className="wall-primary" onClick={onStartFocus}>
            <span className="wall-primary-glyph" aria-hidden="true">▸</span>
            <span>Start focus</span>
            <span className="wall-primary-figure">· {timer}</span>
          </button>
        </div>
      ) : (
        // — the wall — the task IS the button
        <button type="button" className="wall-hero" onClick={onStartFocus}>
          <span className="wall-kicker">{kicker}</span>
          <span className="wall-rule-short" aria-hidden="true" />
          <span className="wall-title is-wall"><LinkifyText text={task.title} /></span>
          {support && (
            <span className="wall-support is-wall"><LinkifyText text={support} /></span>
          )}
          <span className="wall-start-row">
            <span className="wall-chip">▸ {timer}</span>
            <span className="wall-start-hint">tap anywhere to begin</span>
          </span>
        </button>
      )}

      <div className={`wall-actions${peekOpen ? " is-desk" : ""}`}>
        <button type="button" className="wall-action" onClick={onMarkDone}>Mark done</button>
        {/* Low Energy swaps the split action for a smaller start, per Addendum A.
            No banner and no badge — a low-energy day must not look degraded. */}
        <button type="button" className="wall-action" onClick={onSplit}>
          {lowEnergy ? "Start small — 5 minutes" : (peekOpen ? "Split it" : "Too big — split it")}
        </button>
      </div>

      <button
        type="button"
        className="wall-peek"
        onClick={onTogglePeek}
        aria-expanded={peekOpen}
      >
        <span className="wall-peek-chevron" aria-hidden="true">{peekOpen ? "⌄" : "⌃"}</span>
        <span className="wall-peek-label">
          {peekOpen
            ? `AFTER THAT · ${remainingCount} — TAP TO COLLAPSE`
            : `${remainingCount} more today${doneCount ? ` · ${doneCount} done` : ""}`}
        </span>
        {minutesInLabel && <span className="wall-peek-figure">{minutesInLabel} IN</span>}
      </button>

      {/* The door into screen 14, where you'd actually reach for it. */}
      {peekOpen && onScattered && openCount > 0 && (
        <div className="wall-scattered">
          <p className="wall-scattered-line">
            Feeling scattered? There are {openCount} open things across your fronts.
          </p>
          <button type="button" className="wall-scattered-link" onClick={onScattered}>
            Help me narrow it down
          </button>
        </div>
      )}
    </section>
  );
}
