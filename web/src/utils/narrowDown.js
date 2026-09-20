// The reduction behind screen 14 ("When you're scattered").
//
// The handoff is emphatic that the reasons must be REAL — "derived from
// deadlines, dependencies and hours remaining, not generated prose" — and the
// turn-11 addendum replaced the two reasons this schema could not answer with
// two it can:
//
//   14   open across four fronts
//   −6   aren't due this horizon            task.horizonLevel
//   −4   you haven't touched in 7 days      task.lastUpdated
//   −3   won't fit in the 8h19m you have left   estimate vs hours remaining
//    1   is actually yours, today
//
// Two rules shape the implementation:
//   - A row whose count is 0 is omitted, never rendered as "−0".
//   - A step that would empty the pool is SKIPPED, not applied. The screen must
//     always land on one task, and a reduction that eliminates everything is
//     not a reduction — it is a dead end shown to someone already overwhelmed.

import { getFocusWindows, getRemainingFocusMinutes } from "./focusWindows";
import { frontsFromConfig, parseDueDate } from "./fronts";

const STALE_DAYS = 7;
// Horizons further out than this week are not "due this horizon".
const BEYOND_THIS_HORIZON = new Set(["month", "quarter", "halfyear"]);

const NUMBER_WORDS = [
  "No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen", "Twenty",
];

export function numberWord(n) {
  return NUMBER_WORDS[n] ?? String(n);
}

export function openTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter(t => t && !t.isDeleted && !t.isCompleted && !t.isParked);
}

// Focus minutes left today, measured the way the rest of the app measures them.
// This read config.dayEndHour directly, which focusWindows superseded: for
// anyone with configured windows the two disagree outright — at 10:00 inside a
// 09:00-12:00 window it claimed twelve hours left where the app shows two, and
// so kept work that demonstrably cannot fit. getRemainingFocusMinutes also
// excludes the gaps between windows and handles a day ending after midnight,
// both of which this had to special-case by hand.
export function minutesLeftToday(config = {}, now = new Date()) {
  // Rounded at the source: getRemainingFocusMinutes carries the current seconds
  // as a fraction of a minute, and this value is both formatted for display and
  // compared against task estimates.
  return Math.round(getRemainingFocusMinutes(now, getFocusWindows(config)));
}

export function formatMinutesLeft(mins) {
  // Rounds defensively as well: a fractional minute reaching `% 60` rendered
  // "8h18.48333333333335m" on screen 14.
  const total = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

function isStale(task, now) {
  const ts = Number(task?.lastUpdated);
  if (!Number.isFinite(ts) || ts <= 0) return false; // unknown is not stale
  return now.getTime() - ts > STALE_DAYS * 86400000;
}

function estimateOf(task) {
  const n = Number(task?.timeEstimateMinutes);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function priorityRank(task) {
  const m = /^P([1-4])$/.exec(task?.priority || "");
  return m ? Number(m[1]) : 5;
}

// { id -> { name, dueAt } } for every front that has a date, so a task can
// inherit one.
function datedFronts(config) {
  const out = new Map();
  for (const front of frontsFromConfig(config)) {
    const due = parseDueDate(front.dueAt);
    if (due) out.set(front.id, { name: front.name, dueAt: due.getTime() });
  }
  return out;
}

// A task's deadline is its own, or — failing that — the deadline of the front
// it sits on. A front IS where a date usually lives now ("Membrane paper, due
// 4 Nov"), and a task on that front is due with it. Ranking on
// deadlineTimestamp alone treated such a task as undated and could pass over it
// for an undated P1, while the screen went on claiming priority was the
// deciding fact.
function effectiveDeadline(task, fronts) {
  const own = Number(task?.deadlineTimestamp);
  if (Number.isFinite(own) && own > 0) return { at: own, front: null };
  const front = task?.frontId ? fronts.get(task.frontId) : null;
  return front ? { at: front.dueAt, front } : null;
}

// Of what survives, the one to actually do: nearest real deadline first, then
// priority, then the order the user already put them in.
function pickOne(pool, fronts) {
  return [...pool].sort((a, b) => {
    const da = effectiveDeadline(a, fronts)?.at ?? Infinity;
    const db = effectiveDeadline(b, fronts)?.at ?? Infinity;
    if (da !== db) return da - db;
    const pa = priorityRank(a), pb = priorityRank(b);
    if (pa !== pb) return pa - pb;
    return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
  })[0] || null;
}

// Why this one — stated only from what is demonstrably true of the pool it was
// chosen from. Never an encouragement, never a guess.
function reasonFor(chosen, pool, fronts) {
  if (!chosen) return null;
  const dated = pool.filter(t => effectiveDeadline(t, fronts));
  const mine = effectiveDeadline(chosen, fronts);
  if (mine) {
    // Where the date came from is part of the reason being true. Saying a task
    // "has a date on it" when the date belongs to its front is the kind of
    // small dishonesty this screen exists not to commit.
    if (mine.front) {
      return dated.length === 1
        ? `It's the only thing left on a dated front — ${mine.front.name}.`
        : `Its front, ${mine.front.name}, has the nearest date of everything still standing.`;
    }
    return dated.length === 1
      ? "It's the only thing left with a date on it."
      : "It has the nearest date of everything still standing.";
  }
  // Any rank that beats another survivor is a priority edge, not just P1/P2.
  // The old `rank <= 2` gate meant a P3 chosen over a P4 fell through to "it's
  // first in the order you already put these in" — which pickOne had not done
  // and which was plainly false whenever the P4 sat higher in that order.
  const rank = priorityRank(chosen);
  if (pool.some(t => priorityRank(t) > rank)) {
    return "It's the highest priority of what's left.";
  }
  return "It's first in the order you already put these in.";
}

/**
 * Narrow every open task down to one, showing the arithmetic.
 * Returns { total, rows, chosen, why, parked, minutesLeft } — or chosen: null
 * when there is nothing open, which the screen renders as its empty state.
 */
export function narrowDown(tasks, config = {}, now = new Date()) {
  const open = openTasks(tasks);
  const minutesLeft = minutesLeftToday(config, now);
  if (open.length === 0) {
    return { total: 0, rows: [], chosen: null, why: null, parked: [], minutesLeft };
  }

  const fronts = datedFronts(config);
  // Counted through the fronts that actually EXIST, and the loose work is not
  // silently folded in. A raw frontId count reported a front the user had
  // closed, and a mix of assigned and loose tasks read as though everything
  // sat on the counted fronts — the opening figure of a screen whose whole
  // claim is that its numbers are real.
  const liveFrontIds = new Set(frontsFromConfig(config).map(f => f.id));
  const onFronts = new Set(open.map(t => t.frontId).filter(id => id && liveFrontIds.has(id)));
  const looseCount = open.filter(t => !t.frontId || !liveFrontIds.has(t.frontId)).length;
  const frontWord = `${numberWord(onFronts.size).toLowerCase()} ${onFronts.size === 1 ? "front" : "fronts"}`;
  const rows = [{
    key: "open",
    figure: String(open.length),
    reason: onFronts.size === 0
      ? "open across your lists"
      : (looseCount > 0
        ? `open across ${frontWord}, and ${looseCount} on none`
        : `open across ${frontWord}`),
  }];

  let pool = open;
  // Each cut is applied only if something survives it. The screen has to end on
  // one task; a cut that empties the pool is simply not shown.
  const cuts = [
    { key: "horizon", reason: "aren't due this horizon", match: t => BEYOND_THIS_HORIZON.has(t.horizonLevel) },
    { key: "stale", reason: `you haven't touched in ${STALE_DAYS} days`, match: t => isStale(t, now) },
    {
      key: "toobig",
      reason: `won't fit in the ${formatMinutesLeft(minutesLeft)} you have left`,
      match: t => estimateOf(t) > minutesLeft,
    },
  ];

  for (const cut of cuts) {
    const removed = pool.filter(cut.match);
    const kept = pool.filter(t => !cut.match(t));
    if (removed.length === 0 || kept.length === 0) continue;
    rows.push({ key: cut.key, figure: `−${removed.length}`, reason: cut.reason });
    pool = kept;
  }

  const chosen = pickOne(pool, fronts);
  rows.push({ key: "one", figure: "1", reason: "is actually yours, today", isFinal: true });

  return {
    total: open.length,
    rows,
    chosen,
    why: reasonFor(chosen, pool, fronts),
    parked: open.filter(t => t !== chosen),
    minutesLeft,
  };
}
