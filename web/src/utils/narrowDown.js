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

// Minutes between now and the end of the working day. dayEndHour may exceed 24
// (the app lets a day end at 2am, stored as 26), so it is measured from the
// start of today rather than clamped into a single calendar date.
export function minutesLeftToday(config = {}, now = new Date()) {
  const endHour = Number(config.dayEndHour);
  const end = Number.isFinite(endHour) ? endHour : 22;
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endMs = startOfDay.getTime() + end * 3600000;
  return Math.max(0, Math.round((endMs - now.getTime()) / 60000));
}

export function formatMinutesLeft(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
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

// Of what survives, the one to actually do: nearest real deadline first, then
// priority, then the order the user already put them in.
function pickOne(pool) {
  return [...pool].sort((a, b) => {
    const da = Number(a.deadlineTimestamp) || Infinity;
    const db = Number(b.deadlineTimestamp) || Infinity;
    if (da !== db) return da - db;
    const pa = priorityRank(a), pb = priorityRank(b);
    if (pa !== pb) return pa - pb;
    return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
  })[0] || null;
}

// Why this one — stated only from what is demonstrably true of the pool it was
// chosen from. Never an encouragement, never a guess.
function reasonFor(chosen, pool) {
  if (!chosen) return null;
  const dated = pool.filter(t => Number(t.deadlineTimestamp) > 0);
  if (Number(chosen.deadlineTimestamp) > 0) {
    return dated.length === 1
      ? "It's the only thing left with a date on it."
      : "It has the nearest date of everything still standing.";
  }
  const rank = priorityRank(chosen);
  if (rank <= 2 && pool.some(t => priorityRank(t) > rank)) {
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

  const frontCount = new Set(open.map(t => t.frontId).filter(Boolean)).size;
  const rows = [{
    key: "open",
    figure: String(open.length),
    reason: frontCount > 0
      ? `open across ${numberWord(frontCount).toLowerCase()} ${frontCount === 1 ? "front" : "fronts"}`
      : "open across your lists",
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

  const chosen = pickOne(pool);
  rows.push({ key: "one", figure: "1", reason: "is actually yours, today", isFinal: true });

  return {
    total: open.length,
    rows,
    chosen,
    why: reasonFor(chosen, pool),
    parked: open.filter(t => t !== chosen),
    minutesLeft,
  };
}
