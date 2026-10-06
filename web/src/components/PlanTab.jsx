import React, { useEffect, useMemo, useRef, useState } from "react";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import { IconChevronLeft, IconChevronRight, IconPlus } from "./ui/icons";
import {
  frontsFromConfig,
  normalizeFronts,
  sortFronts,
  frontNextMove,
  frontProgress,
  tasksForFront,
  parseDueDate,
  frontDaysLeft,
  frontForCommitment,
  commitmentKickerFront,
  makeFront,
  FRONT_NAME_MAX,
  FRONT_LIMIT,
  LEGACY_DEADLINE_FRONT_ID,
} from "../utils/fronts";
import { isDeferred } from "../utils/deferral";
import { getFocusWindows } from "../utils/focusWindows";
import { useLociDayStr } from "../hooks/useTodayStr";
import "../styles/plan.css";
// Plan 76: the runway and horizon cards, after plan.css.
import "../styles/plan76.css";

// Plan's Fronts (45i): one card per front — its name, GOAL on the goal
// front, how many tasks are open on it and its next move. The card opens the
// front's own page (52f–g): its open tasks by horizon, Add to this front, and
// Park / Close, both with Undo.

// Open and done tasks on a front. Open is every horizon's, Today's too;
// the page lists Plan's horizons only, so it says how many of them are on
// Today, and how many were moved to tomorrow (still Today's horizon, off
// Today until their day).
function frontCounts(tasks, frontId, lociDay) {
  const mine = tasksForFront(tasks, frontId);
  const open = mine.filter(t => !t.isCompleted && !t.isParked);
  const today = open.filter(t => t.horizonLevel === "today");
  const tomorrow = lociDay ? today.filter(t => isDeferred(t, lociDay)).length : 0;
  return {
    open: open.length,
    onToday: today.length - tomorrow,
    tomorrow,
    done: mine.filter(t => t.isCompleted).length,
  };
}

// "DUE 14 NOV · 18 DAYS" (52f), or nothing for a front with no deadline.
function frontDueLine(front, now) {
  const due = parseDueDate(front.dueAt);
  if (!due) return null;
  const days = frontDaysLeft(front, now);
  const date = `${due.getDate()} ${due.toLocaleString("en-GB", { month: "short" })}`.toUpperCase();
  const left = days < 0 ? "OVERDUE" : days === 0 ? "TODAY" : `${days} ${days === 1 ? "DAY" : "DAYS"}`;
  return `DUE ${date} · ${left}`;
}

// 57b answer 25: the tab (45i) and the column (57a) show the same card —
// "N OPEN", its next move, a 2px progress line with "done / total", and its
// deadline when it has one.
function FrontCard({ front, tasks, isGoal, now, isOpen = false, onOpen }) {
  const nextMove = frontNextMove(front, tasks);
  const { open } = frontCounts(tasks, front.id);
  // done / total counts every live task on it, parked ones too (Codex review of #442).
  const { done, total } = frontProgress(tasks, front.id);
  const due = frontDueLine(front, now);
  return (
    <button
      type="button"
      className={`plan-front${front.parked ? " is-parked" : ""}${isOpen ? " is-open" : ""}`}
      data-front-id={front.id}
      aria-current={isOpen ? "true" : undefined}
      onClick={() => onOpen(front)}
    >
      <span className="plan-front-head">
        <span className="plan-front-name">{front.name}</span>
        {isGoal && <span className="task-tag is-goal">GOAL</span>}
        <span className="plan-front-open">{front.parked ? "PARKED" : `${open} OPEN`}</span>
      </span>
      <span className="plan-front-move">
        {nextMove ? (
          // Plain text: a link inside the card's button would be a control
          // inside a control.
          <span className="plan-front-move-line">Next: <span className="plan-front-move-text">{nextMove}</span></span>
        ) : (
          <span className="plan-front-move-line plan-front-move-empty">No next move yet.</span>
        )}
        <IconChevronRight size={18} aria-hidden="true" />
      </span>
      <span className="plan-front-progress">
        <span className="plan-front-bar"><span style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></span>
        <span className="plan-front-tally">{done} / {total}</span>
      </span>
      {due && <span className="plan-front-due">{due}</span>}
    </button>
  );
}

// A front's page (52f–g). The tasks come from Plan's own rows and sheet
// (renderTasks), so a row here behaves as it does in Horizons.
function FrontPage({ front, tasks, lociDay, isGoal, now, onBack, onPark, onClose, onAdd, renderTasks }) {
  const { open, onToday, tomorrow, done } = frontCounts(tasks, front.id, lociDay);
  const due = frontDueLine(front, now);
  // The Key Deadline front is projected from Settings, not stored: there is
  // nothing here to park or close.
  const stored = front.id !== LEGACY_DEADLINE_FRONT_ID;
  const backRef = useRef(null);
  useEffect(() => { backRef.current?.focus(); }, [front.id]);

  // The phone's Park / Close bar sits on the nav, whose height depends on
  // the safe area and the text size, so it is measured.
  const [navHeight, setNavHeight] = useState(0);
  useEffect(() => {
    const nav = document.querySelector(".tab-bar");
    if (!nav || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setNavHeight(nav.getBoundingClientRect().height));
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  // Esc goes back, as the Day map's does — unless a sheet, drawer or dialog
  // is open, which takes it first.
  const backFn = useRef(onBack);
  backFn.current = onBack;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (document.querySelector("[role='dialog']")) return;
      backFn.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const actions = stored && (
    <>
      <button type="button" className="plan-fp-action" onClick={() => onPark(front)}>
        {front.parked ? "Unpark front" : "Park front"}
      </button>
      <button type="button" className="plan-fp-action is-close" onClick={() => onClose(front)}>
        Close front
      </button>
    </>
  );

  return (
    <div className={`plan-fp${actions ? " has-bar" : ""}`} style={{ "--fp-nav-h": `${navHeight}px` }}>
      <button type="button" className="plan-fp-back" ref={backRef} onClick={onBack} aria-label="Back to Fronts">
        <IconChevronLeft size={20} aria-hidden="true" />
        <span>Fronts</span>
        <kbd className="wall-key plan-fp-key" aria-hidden="true">Esc</kbd>
      </button>
      <header className="plan-fp-head">
        <div className="plan-fp-heading">
          <h2 className="plan-fp-name">
            {front.name}
            {isGoal && <span className="task-tag is-goal">GOAL</span>}
            {front.parked && <span className="task-tag plan-fp-parked">PARKED</span>}
          </h2>
          <p className="plan-fp-stats">
            {`${open} OPEN${onToday ? ` · ${onToday} ON TODAY` : ""}${tomorrow ? ` · ${tomorrow} TOMORROW` : ""} · ${done} DONE`}
            {due && <span className="plan-fp-due"> · {due}</span>}
          </p>
        </div>
        {actions && <div className="plan-fp-actions is-inline">{actions}</div>}
      </header>
      {renderTasks?.(front)}
      <button type="button" className="plan-add-front plan-fp-add" onClick={() => onAdd?.(front)}>
        <IconPlus size={20} aria-hidden="true" />
        Add to this front
      </button>
      {actions && <div className="plan-fp-actions is-bar">{actions}</div>}
    </div>
  );
}

// wide (57a, ≥1600): Plan's third column beside the ladder, and a front's
// page in place of the open list; the ladder places both (display: contents).
export default function PlanTab({ payload = {}, saveConfigPatch, openFrontId = null, onOpenFront, onAddToFront, renderFrontTasks, wide = false }) {
  const { tasks = [], config = {} } = payload;
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDate, setDraftDate] = useState("");
  // Undo for Park and Close (52f): { kind, front, index, at }.
  const [undo, setUndo] = useState(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Front deadlines are CALENDAR days parsed at local midnight, so this ticks
  // on the local date: a page left open across midnight would otherwise keep
  // yesterday's day count and order.
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

  // The Loci day too: a window past midnight moves it on at the window's end,
  // when the calendar date doesn't change — and tomorrow's tasks come back.
  const lociDay = useLociDayStr(getFocusWindows(config));
  const now = useMemo(() => new Date(), [tasks, config, dayKey, lociDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const fronts = useMemo(() => sortFronts(frontsFromConfig(config), now), [config, now]);
  // The LIMIT applies to stored fronts. frontsFromConfig can return one more
  // than this (the legacy Key Deadline projection), which is not stored and so
  // does not consume a slot.
  const stored = useMemo(() => normalizeFronts(config.fronts), [config]);
  const atFrontLimit = stored.length >= FRONT_LIMIT;
  // GOAL: the same rule as the rows' — the front the wall's kicker names.
  const goalFront = commitmentKickerFront(frontForCommitment(tasks.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted), fronts), config);
  const isGoal = (front) => !!goalFront && front.id === goalFront.id;

  const openFront = openFrontId ? fronts.find(f => f.id === openFrontId) : null;
  // A front closed elsewhere (another device) leaves its page.
  useEffect(() => {
    if (openFrontId && !openFront) onOpenFront?.(null);
  }, [openFrontId, openFront]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusLater = (selector) => requestAnimationFrame(() => document.querySelector(selector)?.focus());
  const cardSelector = (id) => `.plan-fronts [data-front-id="${CSS.escape(id)}"]`;
  const backToList = (focusId) => {
    onOpenFront?.(null);
    focusLater(focusId ? cardSelector(focusId) : ".plan-new-front");
  };

  // Park and Close go back to Fronts, where the card shows the result and
  // the Undo sits. Closing removes the front from config.fronts only: its
  // tasks keep their frontId, so they read as on no front, and Undo puts the
  // front back where it was with them still on it.
  const parkFront = (front) => {
    const list = normalizeFronts(configRef.current.fronts);
    const index = list.findIndex(f => f.id === front.id);
    if (index === -1 || typeof saveConfigPatch !== "function") return;
    saveConfigPatch({ fronts: list.map(f => (f.id === front.id ? { ...f, parked: !front.parked } : f)) });
    setUndo({ kind: front.parked ? "unpark" : "park", front, index, at: Date.now() });
    backToList(front.id);
  };
  const closeFront = (front) => {
    const list = normalizeFronts(configRef.current.fronts);
    const index = list.findIndex(f => f.id === front.id);
    if (index === -1 || typeof saveConfigPatch !== "function") return;
    saveConfigPatch({ fronts: list.filter(f => f.id !== front.id) });
    setUndo({ kind: "close", front, index, at: Date.now() });
    backToList(null);
  };
  const handleUndo = () => {
    if (!undo) return;
    const { kind, front, index } = undo;
    const list = normalizeFronts(configRef.current.fronts);
    if (kind === "close") {
      // Not if it came back some other way, or the list filled up meanwhile.
      if (!list.some(f => f.id === front.id) && list.length < FRONT_LIMIT) {
        const next = [...list];
        next.splice(Math.min(index, next.length), 0, front);
        saveConfigPatch({ fronts: next });
      }
    } else {
      saveConfigPatch({ fronts: list.map(f => (f.id === front.id ? { ...f, parked: front.parked } : f)) });
    }
    setUndo(null);
    focusLater(cardSelector(front.id));
  };
  const UNDO_LABELS = { park: "Parked", unpark: "Unparked", close: "Closed" };
  const undoText = undo ? `${UNDO_LABELS[undo.kind]}: ${undo.front.name}` : "";

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
    focusLater(cardSelector(front.id));
  };

  const toast = (
    <>
      <UndoAnnouncer message={undoText} />
      {undo && <UndoToast key={undo.at} message={undoText} onUndo={handleUndo} onClose={() => setUndo(null)} />}
    </>
  );

  const frontPage = openFront && (
    <FrontPage
      front={openFront}
      tasks={tasks}
      lociDay={lociDay}
      isGoal={isGoal(openFront)}
      now={now}
      onBack={() => backToList(openFront.id)}
      onPark={parkFront}
      onClose={closeFront}
      onAdd={onAddToFront}
      renderTasks={renderFrontTasks}
    />
  );
  const frontsList = (
    <>
      {fronts.length === 0 ? (
        <p className="plan-empty">
          Nothing is running yet. A front is one piece of work with its own deadline —
          a paper, a rig, a resubmission. Name the first one.
        </p>
      ) : (
        <div className="plan-fronts">
          {fronts.map(front => (
            <FrontCard key={front.id} front={front} tasks={tasks} isGoal={isGoal(front)} now={now} isOpen={wide && front.id === openFrontId} onOpen={f => onOpenFront?.(f.id)} />
          ))}
        </div>
      )}

      {adding ? (
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
            onKeyDown={e => {
              if (e.key === "Enter" && draftName.trim()) commitFront();
              if (e.key === "Escape") { e.preventDefault(); setAdding(false); focusLater(".plan-new-front"); }
            }}
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
            <button type="button" className="plan-new-cancel" onClick={() => { setAdding(false); focusLater(".plan-new-front"); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="plan-add-front plan-new-front" onClick={() => setAdding(true)} disabled={atFrontLimit}>
          <IconPlus size={20} aria-hidden="true" />
          New front
        </button>
      )}

      {atFrontLimit && (
        <p className="plan-limit-note">
          That is {FRONT_LIMIT} fronts — the most Loci holds. Close one to make room.
        </p>
      )}
    </>
  );

  if (wide) {
    const active = fronts.filter(f => !f.parked).length;
    return (
      <div className="plan-tab is-wide">
        {frontPage}
        <aside className="plan-fronts-col" aria-labelledby="plan-fronts-col-title">
          <h2 className="plan-fronts-col-title" id="plan-fronts-col-title">
            Fronts <span className="plan-fronts-col-count">· {active} ACTIVE</span>
          </h2>
          {frontsList}
        </aside>
        {toast}
      </div>
    );
  }

  if (openFront) {
    return (
      <div className="plan-tab is-front-page">
        {frontPage}
        {toast}
      </div>
    );
  }

  return (
    <div className="plan-tab">
      {frontsList}
      {toast}
    </div>
  );
}
