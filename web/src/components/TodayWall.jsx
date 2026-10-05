import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import LinkifyText from "./LinkifyText";
import { taskSteps } from "../utils/taskSteps";
import { formatClock24, formatSpanCaps } from "../utils/dayMapPlan";
import { startLengthOptions, chosenStartOption } from "../utils/focusSession";
import { formatEstimate } from "./TaskDetail";
import { IconPin, IconPlus, IconChevronDown, IconChevronLeft, IconCheck } from "./ui/icons";
import { MiniRing } from "./FocusClock";
import GoalRecord from "./GoalRecord";
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
function GoalBand({ goal, onOpen, record = null }) {
  const [recordOpen, setRecordOpen] = useState(false);
  const bandRef = useRef(null);
  const hasCount = goal.total > 0;
  const figures = goalFigures(goal);
  const label = `Your goal: ${goal.name}${figures ? `, ${figures}` : ""}${goal.target ? `. Target: ${goal.target}` : ""}`;
  // Q57.2: with a record, the band opens it; Edit goal is a link inside.
  const act = record ? () => setRecordOpen(o => !o) : onOpen;
  const closeRecord = () => { setRecordOpen(false); bandRef.current?.focus(); };
  const open = act ? {
    role: "button",
    tabIndex: 0,
    "aria-label": `${label}. ${record ? "Open goal record" : "Open Key deadline"}`,
    ...(record ? { "aria-expanded": recordOpen, "aria-haspopup": "dialog" } : {}),
    onClick: act,
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } },
  } : { role: "group", "aria-label": label };
  const caret = recordOpen ? <span className="wall-goal-caret" aria-hidden="true">▴</span> : null;
  return (
    <div className="wall-goal-wrap">
    <div ref={bandRef} className={`wall-goal${act ? " is-link" : ""}`} data-flip="goal" {...open}>
      <div className="wall-goal-head">
        <span className="wall-goal-kicker">
          YOUR GOAL
          {/* A phone's thin goal line (53f): the days join the kicker, the
              count sits at the right, and a 2px rule runs under the name. */}
          {Number.isFinite(goal.daysLeft) && (
            <span className="wall-goal-days"> · {goal.daysLeft} {goal.daysLeft === 1 ? "DAY" : "DAYS"}</span>
          )}
        </span>
        {figures && <span className="wall-goal-figures">{figures}{caret}</span>}
        {hasCount && <span className="wall-goal-count">{goal.done} OF {goal.total}</span>}
      </div>
      <div className="wall-goal-name">{goal.name}</div>
      {/* 58.2: on a phone the band is one line, "name · 14 days · 0 of 2 ›";
          only the name gives way when it is long. */}
      <div className="wall-goal-line" aria-hidden="true">
        <span className="wall-goal-line-name">{goal.name}</span>
        {figures && <span className="wall-goal-line-figures"><span className="wall-goal-line-dot">&nbsp;· </span>{figures}</span>}
        {act && <span className="wall-goal-line-caret">›</span>}
      </div>
      {/* Q49: the least you'll do each day toward it. */}
      {goal.target && (
        <div className="wall-goal-target"><span className="wall-goal-target-label">Target ·</span> {goal.target}</div>
      )}
      <span className={`wall-goal-track${hasCount ? "" : " is-rule"}`} aria-hidden="true">
        {hasCount && <span className="wall-goal-fill" style={{ width: `${Math.round((goal.done / goal.total) * 100)}%` }} />}
      </span>
    </div>
    {record && recordOpen && (
      <GoalRecord
        goal={goal}
        {...record}
        bandRef={bandRef}
        onClose={closeRecord}
        onEditGoal={onOpen ? () => { setRecordOpen(false); onOpen(); } : null}
        onMakeOneThing={(task) => { setRecordOpen(false); record.onMakeOneThing(task); }}
      />
    )}
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
  goalRecord = null,
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
  nextMinutes = null,
  onStartFocus,
  onMarkDone,
  onSplit,
  doneTask = null,
  doneMinutes = 0,
  proposal = null,
  onCommitProposal,
  onDismissProposal,
  commitBlocked = false,
  // 67i/67j: with no one thing, the top three open tasks to pick from (each
  // { uuid, title, minutes }), how many are open, and This week's count.
  picks = [],
  openCount = 0,
  onPick,
  onShowAll,
  onAddTask,
  weekCount = 0,
  onFromWeek,
  onScattered,
  onRescue,
  // Q58: open Today tasks, the one thing included (the phone's NOW · 1 OF N),
  // and the phone's More sheet.
  nowCount = 0,
  onMore = null,
  // Q59 (72): the one thing's stop ends at nowUntil (Loci minutes); with the
  // list away, then = { at, title, dayEnd }: the next stop and the day's end.
  nowUntil = null,
  then = null,
  // Q55.2: { line, onOpen, onNotToday } while the Rescue hint shows.
  rescueHint = null,
}) {
  // 58.4: whether the title is cut (three lines on the phone), measured after
  // layout and again when the window changes size.
  const titleRef = useRef(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const el = titleRef.current;
      setClamped(!!el && el.scrollHeight - el.clientHeight > 2);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [task?.title]);
  // timerLabel is supplied only while a session is already running on this
  // task, where the button has to name what tapping will resume.

  const top = (
    <>
      {goal && <GoalBand goal={goal} onOpen={onOpenGoal} record={goalRecord} />}
      {anchors.length > 0 && <AnchorLine anchors={anchors} />}
    </>
  );

  // Rescue sits beside "Feeling scattered?" on every Today state (Y4).
  const links = (onScattered || onRescue) && (
    <div className="wall-links" data-flip="links">
      {onScattered && (
        <button type="button" className="wall-link is-scattered" onClick={onScattered}>Feeling scattered?</button>
      )}
      {onRescue && (
        <button type="button" className="wall-link" onClick={onRescue}>I’m stuck</button>
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

  // — no one thing (67i), or nothing in Today (67j) —
  //
  // With open tasks, the top three (in the list's order) are one tap from
  // being the one thing, with Undo; the rest are a link away. No Start: the
  // choice comes first. With none, Add a task, or bring some in from This
  // week. Evening Guard (after 8pm) says why nothing new can be added.
  if (!task) {
    return (
      <section className="today-wall is-empty">
        {/* The goal band and the anchor stay with nothing committed too: a
            Key Deadline you set always shows (L1). */}
        {top}
        {openCount > 0 && picks.length === 0 ? (
          // Only set-time things open (47.6): none can be the one thing.
          <div className="wall-empty">
            <h2 className="wall-empty-title">Only set-time things left</h2>
            {onShowAll && (
              <button type="button" className="wall-link wall-pick-all" onClick={onShowAll}>
                All {openCount} {openCount === 1 ? "task" : "tasks"}
              </button>
            )}
            {links}
          </div>
        ) : picks.length > 0 ? (
          <div className="wall-empty wall-pick">
            <h2 className="wall-empty-title">Pick the one thing</h2>
            <ul className="wall-pick-list">
              {picks.map(t => (
                <li key={t.uuid}>
                  <button type="button" className="wall-pick-row" onClick={() => onPick?.(t)}>
                    <span className="wall-pick-title">{t.title}</span>
                    {t.minutes > 0 && <span className="wall-pick-dur">{t.minutes} MIN</span>}
                  </button>
                </li>
              ))}
            </ul>
            {onShowAll && (
              <button type="button" className="wall-link wall-pick-all" onClick={onShowAll}>
                All {openCount} {openCount === 1 ? "task" : "tasks"}
              </button>
            )}
            {links}
          </div>
        ) : (
          <div className="wall-empty">
            <h2 className="wall-empty-title">Nothing in Today yet</h2>
            {commitBlocked ? (
              <p className="wall-empty-line">Evening Guard is on — no new tasks after 8pm. Rest; this will be here tomorrow.</p>
            ) : (
              <>
                {onAddTask && (
                  <button type="button" className="wall-empty-add" onClick={onAddTask}>Add a task</button>
                )}
                {weekCount > 0 && onFromWeek && (
                  <button type="button" className="wall-link wall-empty-week" onClick={onFromWeek}>
                    From This week · {weekCount}
                  </button>
                )}
              </>
            )}
            {links}
          </div>
        )}
      </section>
    );
  }

  // The steps as the sheet shows them (52): the next one is the first not yet
  // done, and it shows only when the task has steps (53: no placeholder).
  const steps = taskSteps(task);
  const nextIndex = steps.findIndex(s => s && !s.done && s.text);
  const nextStep = nextIndex === -1 ? null : steps[nextIndex];
  const meta = kickerMeta(task, steps, nextIndex);
  // Q58: the phone's quiet row (I'm stuck · Done · More) stands in for the
  // action buttons and links while no session runs.
  const quiet = !!onMore && !timerLabel;

  return (
    <section className={`today-wall${peekOpen ? " is-open" : ""}${quiet ? " has-quiet" : ""}`}>
      {top}

      <div className="wall-hero">
        {/* 75a, 75c: the mantra, above the kicker. */}
        <p className="wall-mantra" data-flip="mantra">ONE task at a time.</p>
        <div className="wall-kicker-row" data-flip="kicker">
          <span className="wall-kicker">
            <span className="wall-kicker-wide">{nowUntil != null ? `NOW · UNTIL ${formatClock24(nowUntil)}` : "NOW"}</span>
            <span className="wall-kicker-phone">{nowCount > 0 ? `NOW · 1 OF ${nowCount}` : "NOW"}</span>
          </span>
          {meta && <span className="wall-kicker-meta">{meta}</span>}
        </div>
        {/* The title opens the task (its sheet: edit it, or let go of it).
            A link inside the title keeps its own click. */}
        <h2
          className={`wall-title${onOpenTask ? " is-openable" : ""}`}
          ref={titleRef}
          data-len={titleLength(task.title)}
          data-flip="title"
          tabIndex={onOpenTask ? -1 : undefined}
          title={onOpenTask ? "Open the task · E" : undefined}
          onClick={onOpenTask ? (e) => { if (!e.target.closest("a")) onOpenTask(); } : undefined}
        >
          <LinkifyText text={task.title} />
        </h2>
        {/* 58.4: a title cut at three lines on the phone says so. */}
        {clamped && onOpenTask && (
          <button type="button" className="wall-full-title" onClick={onOpenTask}>Full title and details</button>
        )}
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
              <span className="wall-first-step-label">Next step<span className="wall-first-step-dash"> — </span></span><LinkifyText text={nextStep.text} />
              {onOpenTask && <>{" "}<button type="button" className="wall-details" onClick={onOpenTask}>Details ›</button></>}
            </p>
            {/* 72: where it is in the steps, "1 / 4". */}
            <span className="wall-step-count" aria-hidden="true">{nextIndex + 1} / {steps.length}</span>
          </div>
        ) : onOpenTask && (
          <p className="wall-details-line" data-flip="step">
            <button type="button" className="wall-details" onClick={onOpenTask}>Details ›</button>
          </p>
        )}

        {/* 72: Start, Mark done and Split it share one row from 840px. */}
        <div className="wall-buttons">
        <StartButton
          task={task}
          blockMinutes={focusMinutes}
          startChoice={startChoice}
          onChooseStart={onChooseStart}
          onStartFocus={onStartFocus}
          timerLabel={timerLabel}
          live={live}
        />


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
        </div>
        {!timerLabel && <StartHelper task={task} blockMinutes={focusMinutes} startChoice={startChoice} />}

        {quiet && (
          <div className="wall-quiet" data-flip="quiet">
            {onRescue && <button type="button" className="wall-quiet-link is-muted" onClick={onRescue}>I’m stuck</button>}
            <span className="wall-quiet-end">
              <button type="button" className="wall-quiet-link" onClick={onMarkDone}>Done</button>
              <button type="button" className="wall-quiet-link" onClick={onMore} aria-haspopup="dialog">More</button>
            </span>
          </div>
        )}

        {/* Q55.2: the Rescue hint, under the buttons and their links. It
            stays until tapped, so it doesn't take the quiet row's place
            (66e): that would hide Done and More all day. */}
        {rescueHint && (
          <p className="wall-hint" role="status">
            <span className="wall-hint-line">{rescueHint.line}</span>
            <span className="wall-hint-actions">
              <button type="button" className="wall-hint-open" onClick={rescueHint.onOpen}>Open Rescue →</button>
              <button type="button" className="wall-hint-later" onClick={rescueHint.onNotToday}>Not today</button>
            </span>
          </p>
        )}

        {/* 72c: with the list away, what comes next and where the day ends. */}
        {then && (
          <p className="wall-then">
            <span className="wall-then-kicker">THEN</span>
            {then.title ? <> {formatClock24(then.at)} · {then.title} · </> : " "}
            DAY ENDS {formatClock24(then.dayEnd)}
          </p>
        )}

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
            {/* The list put away on a laptop: an arrow at the right edge
                brings it back, as a chat app's sidebar does (Rohan). */}
            <span className="wall-peek-edge" aria-hidden="true"><IconChevronLeft size={20} /></span>
            {/* 58.1 (67a): the phone's Next strip, "NEXT" and the next task;
                with none, it still says what it opens. */}
            {!peekOpen && (nextTitle ? (
              <span className="wall-peek-next">
                <span className="wall-peek-next-kicker">NEXT</span> <span className="wall-peek-next-title">{nextTitle}</span>
                {/* 75c: how long it takes. */}
                {nextMinutes > 0 && <span className="wall-peek-next-dur">{formatSpanCaps(nextMinutes)}</span>}
              </span>
            ) : (
              <span className="wall-peek-next"><span className="wall-peek-next-title">{remainingCount > 0 ? `After that · ${remainingCount}` : "Nothing else on Today"}</span></span>
            ))}
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
