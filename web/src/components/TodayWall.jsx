import React, { useEffect, useRef, useState } from "react";
import LinkifyText from "./LinkifyText";
import { taskSteps } from "../utils/taskSteps";
import { startLengthOptions, chosenStartOption } from "../utils/focusSession";
import { formatEstimate } from "./TaskDetail";
import { IconPin, IconPlus, IconChevronDown, IconCheck } from "./ui/icons";
import { MiniRing } from "./FocusClock";
import "../styles/todayWall.css";

// Today's wall (turns 37, 40, 41, 49): the goal band, one anchor line, then the
// one thing — a large title that wraps and never shrinks, its first step, and
// one filled "Start focus". The rest of the day is behind the peek.

function pad2(n) {
  return String(n).padStart(2, "0");
}

// A length as the Start figure shows it: "25:00", "1:30:00".
export function startFigure(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return m >= 60 ? `${Math.floor(m / 60)}:${pad2(m % 60)}:00` : `${pad2(m)}:00`;
}

// The title's size follows its length (53/57b): ≤28 / ≤56 / ≤90 / longer.
export function titleLength(title) {
  const n = String(title || "").length;
  return n <= 28 ? "s" : n <= 56 ? "m" : n <= 90 ? "l" : "xl";
}

// "3H · 1 / 4" beside the kicker on a phone (53f): the estimate, then which
// step is next of how many.
function kickerMeta(task, steps, nextIndex) {
  const parts = [];
  const est = Number(task.timeEstimateMinutes);
  if (est > 0) parts.push(formatEstimate(est).toUpperCase());
  if (steps.length && nextIndex !== -1) parts.push(`${nextIndex + 1} / ${steps.length}`);
  return parts.join(" · ");
}

// "The task is 3h. Start runs one 25-minute block; the chevron changes it." —
// only when the task is longer than what Start runs (53e).
function StartHelper({ task, blockMinutes, startChoice }) {
  const est = Number(task.timeEstimateMinutes);
  const chosen = chosenStartOption(startChoice, blockMinutes, est);
  if (!(est > chosen.minutes)) return null;
  const runs = chosen.choice === "block" ? `one ${chosen.minutes}-minute block` : `${chosen.minutes} minutes`;
  return <p className="wall-start-helper">The task is {formatEstimate(est)}. Start runs {runs}; the chevron changes it.</p>;
}

// Start, and beside it the chevron that picks its length (53e): 5 minutes,
// one block, 50 minutes, the whole task. ↓ on Start opens it too; 1–4 pick;
// the choice is remembered. A running session only resumes — no chooser.
// Q41: at block end the row's ring is full, then counts the break; its
// figure reads BLOCK n DONE, BREAK 4:12, then BREAK'S OVER.
function liveRing(live) {
  const phase = live.blockEnd?.phase;
  if (phase === "break") return { secondsLeft: live.blockEnd.breakLeft, maxSeconds: live.blockEnd.breakSeconds, paused: false };
  if (phase) return { secondsLeft: 1, maxSeconds: 1, paused: false };
  return { secondsLeft: live.secondsLeft, maxSeconds: live.maxSeconds, paused: !live.running };
}
function liveFigure(live) {
  const phase = live.blockEnd?.phase;
  if (phase === "done") return `BLOCK ${Math.max(1, live.blockNumber || 1)} DONE`;
  if (phase === "break") {
    const s = Math.max(0, live.blockEnd.breakLeft);
    return `BREAK ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  if (phase === "over") return "BREAK’S OVER";
  return null;
}

function StartButton({ task, blockMinutes, startChoice, onChooseStart, onStartFocus, timerLabel, live = null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const moreRef = useRef(null);
  const options = startLengthOptions(blockMinutes, task.timeEstimateMinutes);
  const chosen = chosenStartOption(startChoice, blockMinutes, task.timeEstimateMinutes);
  const resuming = !!timerLabel;
  // A session that starts (Start, Space) closes the chooser: a length only
  // applies to a new start, never to a running session (Codex review of #420).
  useEffect(() => { if (resuming) setOpen(false); }, [resuming]);
  const menuOpen = open && !resuming;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const first = wrapRef.current?.querySelector('.wall-start-option[aria-checked="true"]');
    first?.focus();
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const close = () => { setOpen(false); moreRef.current?.focus(); };
  const pick = (o) => { if (o.choice !== startChoice) onChooseStart?.(o.choice); close(); };
  const onMenuKey = (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= options.length) { e.preventDefault(); e.stopPropagation(); pick(options[n - 1]); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...wrapRef.current.querySelectorAll(".wall-start-option")];
      const at = items.indexOf(document.activeElement);
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
    // Space and Enter act on the focused option; keep them off the page.
    if (e.key === " " || e.key === "Enter") e.stopPropagation();
  };

  return (
    <div className="wall-start" data-flip="primary" ref={wrapRef}>
      <button
        type="button"
        className="wall-primary"
        onClick={onStartFocus}
        onKeyDown={resuming ? undefined : (e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
      >
        {/* 59f: a session running on it reads "Back to focus 18:42", with a
            small ring. */}
        {resuming && live && <MiniRing size={22} {...liveRing(live)} />}
        <span>{resuming ? "Back to focus" : "Start focus"}</span>
        <span className="wall-primary-figure">{(resuming && live && liveFigure(live)) || timerLabel || startFigure(chosen.minutes)}</span>
        <kbd className="wall-key is-on-fill" aria-hidden="true">Space</kbd>
      </button>
      {!resuming && (
        <button
          ref={moreRef}
          type="button"
          className="wall-start-more"
          aria-label="How long"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setOpen(o => !o)}
        >
          <IconChevronDown size={20} />
        </button>
      )}
      {menuOpen && (
        <div className="wall-start-menu" role="menu" aria-label="How long" onKeyDown={onMenuKey}>
          {options.map((o, i) => (
            <button
              key={String(o.choice)}
              type="button"
              role="menuitemradio"
              aria-checked={o.choice === chosen.choice}
              className="wall-start-option"
              onClick={() => pick(o)}
            >
              <span className="wall-start-check" aria-hidden="true">{o.choice === chosen.choice && <IconCheck size={18} />}</span>
              <span className="wall-start-text">
                <span className="wall-start-label">{o.choice === "whole" ? `${o.label} · ${formatEstimate(o.minutes)}` : o.label}</span>
                {o.sub && <span className="wall-start-sub">{o.sub}</span>}
              </span>
              <kbd className="wall-start-key" aria-hidden="true">{i + 1}</kbd>
            </button>
          ))}
          <p className="wall-start-note">Loci remembers your choice for tomorrow. Space always starts it.</p>
        </div>
      )}
    </div>
  );
}

// "22 days · 1 of 5" — the count only when the goal has countable items, i.e.
// it is a front with tasks on it (Addendum M1). An overdue goal has no days.
function goalFigures(goal) {
  const parts = [];
  if (Number.isFinite(goal.daysLeft)) {
    parts.push(`${goal.daysLeft} ${goal.daysLeft === 1 ? "day" : "days"}`);
  }
  if (goal.total > 0) parts.push(`${goal.done} of ${goal.total}`);
  return parts.join(" · ");
}

// Q49: tapping the band opens Settings → Key deadline, where it is set.
function GoalBand({ goal, onOpen }) {
  const hasCount = goal.total > 0;
  const figures = goalFigures(goal);
  const label = `Your goal: ${goal.name}${figures ? `, ${figures}` : ""}${goal.target ? `. Target: ${goal.target}` : ""}`;
  const open = onOpen ? {
    role: "button",
    tabIndex: 0,
    "aria-label": `${label}. Open Key deadline`,
    onClick: onOpen,
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } },
  } : { role: "group", "aria-label": label };
  return (
    <div className={`wall-goal${onOpen ? " is-link" : ""}`} data-flip="goal" {...open}>
      <div className="wall-goal-head">
        <span className="wall-goal-kicker">
          YOUR GOAL
          {/* A phone's thin goal line (53f): the days join the kicker, the
              count sits at the right, and a 2px rule runs under the name. */}
          {Number.isFinite(goal.daysLeft) && (
            <span className="wall-goal-days"> · {goal.daysLeft} {goal.daysLeft === 1 ? "DAY" : "DAYS"}</span>
          )}
        </span>
        {figures && <span className="wall-goal-figures">{figures}</span>}
        {hasCount && <span className="wall-goal-count">{goal.done} OF {goal.total}</span>}
      </div>
      <div className="wall-goal-name">{goal.name}</div>
      {/* Q49: the least you'll do each day toward it. */}
      {goal.target && (
        <div className="wall-goal-target"><span className="wall-goal-target-label">Target ·</span> {goal.target}</div>
      )}
      <span className={`wall-goal-track${hasCount ? "" : " is-rule"}`} aria-hidden="true">
        {hasCount && <span className="wall-goal-fill" style={{ width: `${Math.round((goal.done / goal.total) * 100)}%` }} />}
      </span>
    </div>
  );
}

// An absolute day number for the local date (days since 1970-01-01), counted
// in UTC so neither a DST change (a 23- or 25-hour local day) nor New Year
// can repeat or skip a day.
export function localDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

// One anchor a day, in turn; tap for the next (40a). The day's anchor is fixed
// by the date, so it is the same one each time you open Today.
function AnchorLine({ anchors }) {
  const [offset, setOffset] = useState(0);
  const index = (localDayNumber(new Date()) + offset) % anchors.length;
  return (
    <button
      type="button"
      className="wall-anchor"
      data-flip="anchor"
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
  onOpenGoal = null,
  anchors = [],
  focusMinutes = 25,
  startChoice,
  onChooseStart,
  timerLabel = null,
  // 59f: the running session — { secondsLeft, maxSeconds, running,
  // onPauseResume } — for the ring and the Pause beside Mark done.
  live = null,
  peekOpen,
  onTogglePeek,
  onAdd,
  onOpenDayMap,
  onOpenTask,
  onStepDone,
  remainingCount = 0,
  nextTitle = null,
  onStartFocus,
  onMarkDone,
  onSplit,
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

  const top = (
    <>
      {goal && <GoalBand goal={goal} onOpen={onOpenGoal} />}
      {anchors.length > 0 && <AnchorLine anchors={anchors} />}
    </>
  );

  // Rescue sits beside "Feeling scattered?" on every Today state (Y4).
  const links = (onScattered || onRescue) && (
    <div className="wall-links" data-flip="links">
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
        {/* The goal band and the anchor stay with nothing committed too: a
            Key Deadline you set always shows (L1). */}
        {top}
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

  // The steps as the sheet shows them (52): the next one is the first not yet
  // done, and it shows only when the task has steps (53: no placeholder).
  const steps = taskSteps(task);
  const nextIndex = steps.findIndex(s => s && !s.done && s.text);
  const nextStep = nextIndex === -1 ? null : steps[nextIndex];
  const meta = kickerMeta(task, steps, nextIndex);

  return (
    <section className={`today-wall${peekOpen ? " is-open" : ""}`}>
      {top}

      <div className="wall-hero">
        <div className="wall-kicker-row" data-flip="kicker">
          <span className="wall-kicker">
            <span className="wall-kicker-wide">TODAY, ONE THING</span>
            <span className="wall-kicker-phone">TODAY · THE ONE THING</span>
          </span>
          {meta && <span className="wall-kicker-meta">{meta}</span>}
        </div>
        {/* The title opens the task (its sheet: edit it, or let go of it).
            A link inside the title keeps its own click. */}
        <h2
          className={`wall-title${onOpenTask ? " is-openable" : ""}`}
          data-len={titleLength(task.title)}
          data-flip="title"
          tabIndex={onOpenTask ? -1 : undefined}
          title={onOpenTask ? "Open the task · E" : undefined}
          onClick={onOpenTask ? (e) => { if (!e.target.closest("a")) onOpenTask(); } : undefined}
        >
          <LinkifyText text={task.title} />
        </h2>
        {/* "Details ›" (52a, 57b answer 15): touch has no hover, so the
            title's sheet gets a visible way in — at the end of the step
            line, or under the title when there is no step. */}
        {/* The next step is a checkbox (53, 57b answer 13): ticking it moves
            on to the one after. */}
        {nextStep ? (
          <div className="wall-first-step" data-flip="step">
            <button
              type="button"
              role="checkbox"
              aria-checked="false"
              className="wall-step-check"
              aria-label={`Mark step done: ${nextStep.text}`}
              onClick={() => onStepDone?.(nextStep.id)}
            />
            <p className="wall-first-step-text">
              <span className="wall-first-step-label">Next step</span> — <LinkifyText text={nextStep.text} />
              {onOpenTask && <>{" "}<button type="button" className="wall-details" onClick={onOpenTask}>Details ›</button></>}
            </p>
          </div>
        ) : onOpenTask && (
          <p className="wall-details-line" data-flip="step">
            <button type="button" className="wall-details" onClick={onOpenTask}>Details ›</button>
          </p>
        )}

        <StartButton
          task={task}
          blockMinutes={focusMinutes}
          startChoice={startChoice}
          onChooseStart={onChooseStart}
          onStartFocus={onStartFocus}
          timerLabel={timerLabel}
          live={live}
        />

        {!timerLabel && <StartHelper task={task} blockMinutes={focusMinutes} startChoice={startChoice} />}

        <div className="wall-actions" data-flip="actions">
          {/* 59f: with a session running, Pause (or Resume) and Mark done. At
              block end (Q41): Take a break, then Start block n+1. */}
          {timerLabel && live && live.blockEnd?.phase === "done" && (
            <button type="button" className="wall-action" onClick={live.onStartBreak}>Take a break</button>
          )}
          {timerLabel && live && live.blockEnd?.phase === "over" && (
            <button type="button" className="wall-action" onClick={live.onStartNext}>Start block {Math.max(1, live.blockNumber || 1) + 1}</button>
          )}
          {timerLabel && live && !live.blockEnd?.phase && (
            <button type="button" className="wall-action" onClick={live.onPauseResume}>
              {live.running ? "Pause" : "Resume"}
            </button>
          )}
          <button type="button" className="wall-action" onClick={onMarkDone}>
            Mark done <kbd className="wall-key" aria-hidden="true">D</kbd>
          </button>
          {!(timerLabel && live) && (
            <button type="button" className="wall-action" onClick={onSplit}>
              Split it <kbd className="wall-key" aria-hidden="true">S</kbd>
            </button>
          )}
        </div>

        {/* Laptop, list shown (51a): the Day map link sits under the task. */}
        {onOpenDayMap && (
          <button type="button" className="wall-daymap" data-flip-enter="" onClick={onOpenDayMap}>
            Day map → <kbd className="wall-key" aria-hidden="true">M</kbd>
          </button>
        )}
      </div>

      {/* The foot: on phones and tablets the links, then the peek. On a
          laptop with the list hidden (51b) one centred row: "Show list · N ·
          L" and a 44px "+". */}
      <div className="wall-foot">
        {links}

        {/* 49a: "+" at the right of the peek, within a thumb's reach. */}
        <div className="wall-peek-row" data-flip-controls="">
          <button
            type="button"
            className="wall-peek"
            onClick={onTogglePeek}
            aria-expanded={peekOpen}
          >
            <span className="wall-peek-grabber" aria-hidden="true" />
            <span className="wall-peek-label">
              {peekOpen ? "Hide list" : nextTitle ? `Up next · ${nextTitle}` : `After that · ${remainingCount}`}
            </span>
            {!peekOpen && (
              <span className="wall-peek-wide">
                Show list · {remainingCount} <kbd className="wall-key" aria-hidden="true">L</kbd>
              </span>
            )}
          </button>
          {onAdd && (
            <button type="button" className="wall-peek-add" onClick={onAdd} aria-label="Add a task to Today">
              <IconPlus size={20} />
              {/* The bottom bar's words (54a/c), from 1024px with the list hidden. */}
              <span className="wall-peek-add-label" aria-hidden="true">Add a task <kbd className="wall-key">N</kbd></span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
