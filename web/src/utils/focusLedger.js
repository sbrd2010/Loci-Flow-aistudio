// Reading minutes back out of the activity ledger.
//
// The addendum (F) asks for session minutes to be logged so that screen 8, the
// rail footer, the "+25m" ledger rows and "WHERE IT WENT" have data. They are
// ALREADY logged: every terminal focus event carries focusElapsedSeconds, and
// events are stored day-bucketed at
//   activityLogs/{uid}/events/{lociDateString}/{eventId}
// What has never existed is a reader — the client writes that path and never
// looks at it again. This module is the aggregation half of that reader; it is
// deliberately pure so it can be tested without Firebase.
//
// Two things the events do NOT carry: a task title and a frontId. taskSnapshot
// holds only category/priority/horizonLevel. So anything that needs a name or
// a front joins taskId back to the live tasks array, and gracefully reports
// nothing rather than guessing when that task is gone.

import { getLociDayStr, getFocusWindows } from "./focusWindows";

// Both terminal types count toward time. An abandoned session still moved the
// work — the addendum asks for the partial to be written precisely so it can.
export const FOCUS_TERMINAL_TYPES = new Set(["focus_completed", "focus_abandoned"]);

// A session under a minute rounds to zero and is not a "move". This keeps a
// three-second mis-tap out of the figures without discarding real short work.
export const MIN_COUNTABLE_MINUTES = 1;

export function eventMinutes(event) {
  const secs = Number(event?.focusElapsedSeconds);
  // Under a minute is zero, not a rounded-up one. Math.round alone turned a
  // 45-second mis-tap into a whole minute, and dailyTotals then counted it as
  // a move — inflating days-moved, the one figure that has to stay honest.
  if (!Number.isFinite(secs) || secs < MIN_COUNTABLE_MINUTES * 60) return 0;
  return Math.round(secs / 60);
}

export function isFocusTerminal(event) {
  return !!event && FOCUS_TERMINAL_TYPES.has(event.type);
}

// RTDB hands back { "2026-11-04": { eventId: event, ... }, ... }. Flatten it to
// the focus events that carry time, tolerating the shape being partly absent.
export function flattenFocusEvents(raw) {
  if (!raw || typeof raw !== "object") return [];
  const out = [];
  for (const [dateString, byId] of Object.entries(raw)) {
    if (!byId || typeof byId !== "object") continue;
    for (const event of Object.values(byId)) {
      if (!isFocusTerminal(event)) continue;
      out.push({ ...event, lociDateString: event.lociDateString || dateString });
    }
  }
  return out;
}

// The N loci days ending today, oldest first. Uses the same day-boundary rule
// the writes use, so a session logged at 01:00 lands on the day it belonged to
// rather than the calendar date it happened on.
export function lociDayWindow(days = 7, now = new Date(), windows) {
  // Resolved exactly as the WRITE path resolves it (activityLog's
  // resolveWindows), so a session reads back into the same day-bucket it was
  // written to. getLociDayStr itself requires a real array.
  const resolved = windows || getFocusWindows();
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(getLociDayStr(d, resolved));
  }
  return out;
}

// { [lociDateString]: { minutes, moves } }
export function dailyTotals(events) {
  const totals = {};
  for (const event of events) {
    const mins = eventMinutes(event);
    const key = event.lociDateString;
    if (!key) continue;
    if (!totals[key]) totals[key] = { minutes: 0, moves: 0 };
    totals[key].minutes += mins;
    if (mins >= MIN_COUNTABLE_MINUTES) totals[key].moves += 1;
  }
  return totals;
}

// "WHERE IT WENT" — minutes per front, joining taskId back to the live tasks.
// Work on no front is collected under a null key rather than invented into one.
export function minutesByFront(events, tasks = []) {
  const frontOf = new Map();
  for (const t of tasks) {
    if (t?.uuid) frontOf.set(t.uuid, t.frontId || null);
  }
  const out = new Map();
  for (const event of events) {
    const mins = eventMinutes(event);
    if (mins <= 0) continue;
    // The front the task was ON at the time, recorded in the event itself.
    // Reading the live task alone meant reassigning a task retroactively moved
    // all of its past sessions in this breakdown.
    //
    // PRESENCE is what distinguishes a recorded state from a legacy event, not
    // truthiness: the snapshot stores "" for "was on no front", so an empty
    // string is an answer and an absent key is "we did not record one". Testing
    // truthiness instead treated a genuinely unassigned session as legacy and
    // fell through to the live task — re-attributing it the moment that task
    // joined a front.
    //
    // Only events written before the field existed take the fallback, which
    // also covers a task deleted since the session — its time counts under
    // "no front".
    const snapshotFront = event.taskSnapshot?.frontId;
    const frontId = typeof snapshotFront === "string"
      ? (snapshotFront || null)
      : (frontOf.has(event.taskId) ? frontOf.get(event.taskId) : null);
    out.set(frontId, (out.get(frontId) || 0) + mins);
  }
  return out;
}

// The hour the user most often actually starts focusing, 0-23, or null when
// there is not enough evidence to say. This is what makes "Protect tomorrow's
// 08:00?" a real proposal rather than a guess at a respectable-sounding hour.
export function commonestStartHour(events, minSessions = 3) {
  const byHour = new Map();
  for (const event of events || []) {
    const started = Number(event?.focusStartedAt);
    if (!Number.isFinite(started) || started <= 0) continue;
    if (eventMinutes(event) < MIN_COUNTABLE_MINUTES) continue;
    const hour = new Date(started).getHours();
    byHour.set(hour, (byHour.get(hour) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  // Ties resolve to the earlier hour: of two equally common start times, the
  // earlier one is the one worth defending.
  for (const [hour, count] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) { best = hour; bestCount = count; }
  }
  return bestCount >= minSessions ? best : null;
}

export function formatMinutes(mins) {
  const n = Math.max(0, Math.round(Number(mins) || 0));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}m`;
}

/**
 * Everything screen 8 and the momentum strip need, from one pass.
 *
 * This used to also return a `hasMinutes` flag, so callers could switch to
 * rendering MOVES when no time was logged. That switch was unreachable:
 * `moves` only increments for an event yielding at least a minute, and
 * `totalMinutes` sums those same minutes, so zero minutes implies zero moves.
 * Callers show the duration and let an empty week read as empty.
 */
export function weekSummary(raw, tasks = [], now = new Date(), windows, days = 7) {
  const window = lociDayWindow(days, now, windows);
  const inWindow = new Set(window);
  // Everything this returns is scoped to the same window, byFront included.
  // "WHERE IT WENT" sits under the week's own figure, so attributing a session
  // from two months ago to a front there would contradict the number above it.
  const events = flattenFocusEvents(raw).filter(e => inWindow.has(e.lociDateString));
  const totals = dailyTotals(events);

  const perDay = window.map(date => ({
    date,
    minutes: totals[date]?.minutes || 0,
    moves: totals[date]?.moves || 0,
  }));

  const totalMinutes = perDay.reduce((n, d) => n + d.minutes, 0);
  const totalMoves = perDay.reduce((n, d) => n + d.moves, 0);

  return {
    events,
    perDay,
    totalMinutes,
    totalMoves,
    // Momentum is "days moved, not tasks completed" — so it counts days with a
    // session, never days with a completion. A day you worked and finished
    // nothing still counts, which is the whole point.
    daysMoved: perDay.filter(d => d.moves > 0).length,
    byFront: minutesByFront(events, tasks),
  };
}
