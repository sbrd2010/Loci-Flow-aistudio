import React, { useState } from "react";
import LinkifyText from "./LinkifyText";
import { IconPin, IconPlus } from "./ui/icons";
import "../styles/todayWall.css";

// Today's wall (turns 37, 40, 41, 49): the goal band, one anchor line, then the
// one thing — a large title that wraps and never shrinks, its first step, and
// one filled "Start focus". The rest of the day is behind the peek.

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "22 days · 1 of 5" — the count only when the goal has countable items, i.e.
// it is a front with tasks on it (Addendum M1). An overdue goal has no days.
function goalFigures(goal, compact) {
  const parts = [];
  if (Number.isFinite(goal.daysLeft)) {
    parts.push(compact ? `${goal.daysLeft}d` : `${goal.daysLeft} ${goal.daysLeft === 1 ? "day" : "days"}`);
  }
  if (goal.total > 0) parts.push(compact ? `${goal.done}/${goal.total}` : `${goal.done} of ${goal.total}`);
  return parts.join(" · ");
}

function GoalBand({ goal }) {
  const hasCount = goal.total > 0;
  const figures = goalFigures(goal, false);
  const compactFigures = goalFigures(goal, true);
  return (
    <div className="wall-goal" role="group" aria-label={`Your goal: ${goal.name}${figures ? `, ${figures}` : ""}`}>
      <div className="wall-goal-head">
        <span className="wall-goal-kicker">YOUR GOAL</span>
        {figures && <span className="wall-goal-figures">{figures}</span>}
      </div>
      <div className="wall-goal-name">{goal.name}</div>
      {compactFigures && <span className="wall-goal-figures is-compact">{compactFigures}</span>}
      {hasCount && (
        <span className="wall-goal-track" aria-hidden="true">
          <span className="wall-goal-fill" style={{ width: `${Math.round((goal.done / goal.total) * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

// One anchor a day, in turn; tap for the next (40a). The day's anchor is fixed
// by the date, so it is the same one each time you open Today.
function AnchorLine({ anchors }) {
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const index = (dayOfYear + offset) % anchors.length;
  return (
    <button
      type="button"
      className="wall-anchor"
      onClick={() => setOffset(o => o + 1)}
      aria-label={`Anchor ${index + 1} of ${anchors.length}: ${anchors[index].text}. Show the next one.`}
    >
      <IconPin size={16} />
      <span className="wall-anchor-text">{anchors[index].text}</span>
      <span className="wall-anchor-count" aria-hidden="true">{index + 1} / {anchors.length} ›</span>
    </button>
  );
}

export default function TodayWall({
  task,
  goal = null,
  anchors = [],
  focusMinutes = 25,
  timerLabel = null,
  peekOpen,
  onTogglePeek,
  onAdd,
  remainingCount = 0,
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
  mindBoxCount = 0,
  onOpenMindBox,
  onScattered,
  onRescue,
}) {
  // Only the empty wall uses this, but hooks cannot sit behind its early
  // return.
  const [draft, setDraft] = useState("");
  // timerLabel is supplied only while a session is already running on this
  // task, where the button has to name what tapping will resume.
  const resuming = !!timerLabel;
  const timer = timerLabel || `${pad2(focusMinutes)}:00`;

  const top = (
    <>
      {goal && <GoalBand goal={goal} />}
      {anchors.length > 0 && <AnchorLine anchors={anchors} />}
    </>
  );

  // Rescue sits beside "Feeling scattered?" on every Today state (Y4).
  const links = (onScattered || onRescue) && (
    <div className="wall-links">
      {onScattered && (
        <button type="button" className="wall-link" onClick={onScattered}>Feeling scattered?</button>
      )}
      {onRescue && (
        <button type="button" className="wall-link" onClick={onRescue}>Open Rescue</button>
      )}
    </div>
  );

  // — the commitment, finished (J2b/K2/K3) —
  //
  // The hero becomes the closing line, not the proposal: what you did is the
  // dominant element, and what you might do next is offered beneath it. There
  // is NO auto-commit, ever — "Not now" leaves this standing for the rest of
  // the day rather than proposing something else.
  if (doneTask && !task) {
    return (
      <section className="today-wall is-done">
        {top}
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
          {links}
        </div>
      </section>
    );
  }

  // — nothing committed yet (37f) —
  //
  // The field takes free text and CREATES a task, because the thing you commit
  // to may not exist in the app yet — without that, first launch has no exit.
  // Enter commits. What already exists is one tap away: the Today list below,
  // and Mind Box.
  if (!task) {
    const commit = () => {
      const title = draft.trim();
      if (!title) return;
      // The handler decides, and the draft is cleared only if it accepted.
      // commitBlocked is a render-time value that can be up to a minute
      // stale, so a wall left open across 20:00 would otherwise swallow what
      // the user typed: cleared here, rejected there, nothing to show for it.
      if (onCommitNewTask?.(title) === false) return;
      setDraft("");
    };
    return (
      <section className="today-wall is-empty">
        <div className="wall-empty">
          <div className="wall-kicker">TODAY, ONE THING</div>
          <h2 className="wall-empty-title">Nothing committed yet.</h2>
          <p className="wall-empty-line">
            {commitBlocked
              ? "Evening Guard is on — no new tasks after 8pm. Rest; this will be here tomorrow."
              : "Pick one thing. Just one. The rest can wait in Mind Box."}
          </p>
          <form
            className="wall-commit"
            onSubmit={(e) => { e.preventDefault(); commit(); }}
          >
            <label className="wall-commit-box">
              <IconPlus size={20} />
              <input
                type="text"
                className="wall-commit-field"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What's the one thing today?"
                aria-label="Today's one thing"
                enterKeyHint="done"
                autoComplete="off"
                maxLength={1000}
              />
            </label>
          </form>
          {mindBoxCount > 0 && onOpenMindBox && (
            <p className="wall-empty-or">
              Or{" "}
              <button type="button" className="wall-link" onClick={() => onOpenMindBox()}>
                pick from Mind Box ({mindBoxCount})
              </button>
            </p>
          )}
          {links}
        </div>
      </section>
    );
  }

  const firstStep = task.concreteStep || null;

  return (
    <section className={`today-wall${peekOpen ? " is-open" : ""}`}>
      {top}

      <div className="wall-hero">
        <div className="wall-kicker">TODAY, ONE THING</div>
        <h2 className="wall-title"><LinkifyText text={task.title} /></h2>
        {firstStep && (
          <p className="wall-first-step">
            <span className="wall-first-step-label">First step</span> — <LinkifyText text={firstStep} />
          </p>
        )}

        <button type="button" className="wall-primary" onClick={onStartFocus}>
          <span>{resuming ? "Resume focus" : "Start focus"}</span>
          <span className="wall-primary-figure">{timer}</span>
          <kbd className="wall-key is-on-fill" aria-hidden="true">Space</kbd>
        </button>

        <div className="wall-actions">
          <button type="button" className="wall-action" onClick={onMarkDone}>
            Mark done <kbd className="wall-key" aria-hidden="true">D</kbd>
          </button>
          {/* Low Energy swaps the split action for a smaller start, per Addendum A.
              No banner and no badge — a low-energy day must not look degraded.
              The handler swaps with the label: a button that says "5 minutes" and
              opens the task editor is a control that lies about what it does. */}
          {lowEnergy ? (
            <button type="button" className="wall-action" onClick={onStartSmall}>
              Start small — 5 minutes
            </button>
          ) : (
            <button type="button" className="wall-action" onClick={onSplit}>
              Split it <kbd className="wall-key" aria-hidden="true">S</kbd>
            </button>
          )}
        </div>

        {links}
      </div>

      {/* 49a: "+" at the right of the peek, within a thumb's reach. */}
      <div className="wall-peek-row">
        <button
          type="button"
          className="wall-peek"
          onClick={onTogglePeek}
          aria-expanded={peekOpen}
        >
          <span className="wall-peek-grabber" aria-hidden="true" />
          <span className="wall-peek-label">
            {peekOpen ? "Hide list" : `After that · ${remainingCount}`}
          </span>
        </button>
        {onAdd && (
          <button type="button" className="wall-peek-add" onClick={onAdd} aria-label="Add a task to Today">
            <IconPlus size={20} />
          </button>
        )}
      </div>
    </section>
  );
}
