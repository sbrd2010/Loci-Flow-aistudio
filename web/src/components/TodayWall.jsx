import React, { useState } from "react";
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
  timerLabel = null,
  peekOpen,
  onTogglePeek,
  remainingCount = 0,
  doneCount = 0,
  minutesInLabel,
  lowEnergy = false,
  onStartFocus,
  onMarkDone,
  onSplit,
  onStartSmall,
  doneTask = null,
  doneMinutes = 0,
  proposal = null,
  onCommitProposal,
  onDismissProposal,
  commitBlocked = false,
  onCommitNewTask,
  onPickExisting,
  pickOptions = [],
  onScattered,
  openCount = 0,
}) {
  // Only the empty wall uses this, but hooks cannot sit behind its early
  // return.
  const [draft, setDraft] = useState("");
  // timerLabel is supplied only while a session is already running on this
  // task, where the chip has to name what tapping will resume.
  const resuming = !!timerLabel;
  const timer = timerLabel || `${pad2(focusMinutes)}:00`;
  // "The kicker becomes the front name *or* nothing — never 'Uncategorised'."
  const kicker = frontName ? `${frontName} · YOU COMMITTED TO` : "YOU COMMITTED TO";
  // J3: the day count is --alert ONLY under three days, otherwise --gold-lift.
  // The Key Deadline strip's information lives here now, and the one alert
  // colour is spent only on something genuinely imminent.
  const hasDays = Number.isFinite(daysLeft) && daysLeft !== null;
  const pressing = hasDays && daysLeft < 3;

  // J1: "clamped so a long title drops to 34 then 29 rather than wrapping past
  // three lines". Chosen by length rather than by measuring: at 390px the wall
  // fits roughly 13 characters per line at 42px and 17 at 34px, so these are
  // the points where a title would otherwise reach a fourth line. Approximate
  // by construction — a measured fit would need a layout pass per render.
  const titleLen = (task?.title || "").length;
  const wallSize = titleLen <= 40 ? "is-42" : titleLen <= 58 ? "is-34" : "is-29";

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
  // — the commitment, finished (J2b/K2/K3) —
  //
  // The hero becomes the closing line, not the proposal: what you did is the
  // dominant element, and what you might do next is offered beneath it. There
  // is NO auto-commit, ever — "Not now" leaves this standing for the rest of
  // the day rather than proposing something else.
  if (doneTask && !task) {
    return (
      <section className="today-wall is-done">
        {header}
        <div className="wall-done">
          <div className="wall-done-was">{doneTask.title}</div>
          {/* K2: the figure is minutes on THIS task today. Zero reads just
              "Done." — no "0m logged", no "no time logged", no apology. */}
          <h2 className="wall-done-line">
            {doneMinutes > 0 ? `Done. ${doneMinutes}m logged.` : "Done."}
          </h2>

          {proposal && (
            <div className="wall-proposal">
              <div className="wall-proposal-kicker">NEXT, IF YOU WANT</div>
              <p className="wall-proposal-title">{proposal.title}</p>
              <button type="button" className="wall-proposal-commit" onClick={onCommitProposal}>
                Commit to this
              </button>
              <button type="button" className="wall-proposal-not-now" onClick={onDismissProposal}>
                Not now
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  // — nothing committed yet: screen 10's field, on the same ground (J2a/K1) —
  //
  // The field takes free text and CREATES a task, because the thing you commit
  // to may not exist in the app yet — without that, first launch has no exit.
  // The guard against a near-duplicate is not a restriction but a view: the
  // "Or pick one" rows filter to open items matching what is being typed, so
  // an existing version of the same thing is visible before it is committed.
  // Tapping a row commits that task instead of creating a second one. No
  // fuzzy-merge prompt, no "did you mean".
  if (!task) {
    const query = draft.trim().toLowerCase();
    const matches = (query
      ? pickOptions.filter(t => (t.title || "").toLowerCase().includes(query))
      : pickOptions
    ).slice(0, 3);
    const commit = () => {
      const title = draft.trim();
      if (!title || commitBlocked) return;
      setDraft("");
      onCommitNewTask?.(title);
    };
    // Picking an existing task clears the draft too. TodayWall stays mounted,
    // so a query left behind reappears in the field if that task is ever
    // unpinned — and an accidental submit then creates exactly the duplicate
    // these rows exist to prevent.
    const pick = (t) => {
      setDraft("");
      onPickExisting?.(t);
    };
    return (
      <section className="today-wall is-empty">
        {header}
        <div className="wall-empty">
          <div className="wall-kicker">TODAY</div>
          <form
            className="wall-commit"
            onSubmit={(e) => { e.preventDefault(); commit(); }}
          >
            <input
              type="text"
              className="wall-commit-field"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What's the one thing?"
              aria-label="Today's one thing"
              autoComplete="off"
              maxLength={1000}
            />
            <p className="wall-empty-line">
              {commitBlocked
                ? "Evening Guard is on — no new tasks after 8pm. Rest; this will be here tomorrow."
                : "You can change it whenever. That\u2019s not failure."}
            </p>
            {/* K1: screen 10's Commit button survives — J2a's "the field is the
                only affordance" meant no illustration and no onboarding CTA,
                not a keyboard-only commit. Enter commits too, via the form. */}
            <button type="submit" className="wall-commit-btn" disabled={!draft.trim() || commitBlocked}>
              Commit
            </button>
          </form>

          {matches.length > 0 && (
            <div className="wall-pick">
              <div className="wall-pick-kicker">OR PICK ONE</div>
              {matches.map(t => (
                <button
                  key={t.uuid}
                  type="button"
                  className="wall-pick-row"
                  onClick={() => pick(t)}
                >
                  <span className="wall-pick-title">{t.title}</span>
                </button>
              ))}
            </div>
          )}
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
            <span>{resuming ? "Resume focus" : "Start focus"}</span>
            <span className="wall-primary-figure">· {timer}</span>
          </button>
        </div>
      ) : (
        // — the wall — the task IS the button
        <button type="button" className="wall-hero" onClick={onStartFocus}>
          <span className="wall-kicker">{kicker}</span>
          <span className="wall-rule-short" aria-hidden="true" />
          {/* Plain text, not LinkifyText: an <a> inside this <button> is
              invalid nested interactive content, gives assistive technology
              conflicting button/link semantics, and breaks the "tap anywhere
              to begin" contract — tapping the linked words would open a tab
              instead of starting focus. The desk state below is ordinary
              markup, so links work there. */}
          <span className={`wall-title is-wall ${wallSize}`}>{task.title}</span>
          {support && (
            <span className="wall-support is-wall">{support}</span>
          )}
          <span className="wall-start-row">
            <span className="wall-chip">▸ {timer}</span>
            <span className="wall-start-hint">{resuming ? "tap anywhere to resume" : "tap anywhere to begin"}</span>
          </span>
        </button>
      )}

      <div className={`wall-actions${peekOpen ? " is-desk" : ""}`}>
        <button type="button" className="wall-action" onClick={onMarkDone}>Mark done</button>
        {/* Low Energy swaps the split action for a smaller start, per Addendum A.
            No banner and no badge — a low-energy day must not look degraded.
            The handler swaps with the label: a button that says "5 minutes" and
            opens the task editor is a control that lies about what it does. */}
        <button type="button" className="wall-action" onClick={lowEnergy ? onStartSmall : onSplit}>
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
