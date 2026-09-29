import { mergeWindowSpans } from "./focusWindows";

// The earliest stop that flows from the route's start has started in the
// past: time the route again from now. Earliest, not first in order: a stop
// pulled forward starts before the ones ahead of it. Fixed stops keep their
// time (58), so a fixed stop the day has passed never asks for this.
export function shouldReflowPastRoute(scheduledTasks, anchorMinutes) {
  if (!Array.isArray(scheduledTasks) || scheduledTasks.length === 0) return false;
  const starts = scheduledTasks.filter(t => !isFixedStop(t)).map(t => Number(t.dayMapStartMinutes)).filter(Number.isFinite);
  const anchor = Number(anchorMinutes);
  return starts.length > 0 && Number.isFinite(anchor) && Math.min(...starts) < anchor;
}

// ── The route engine (turn 57b answers 2–4; 58c–f) ─────────────────────────
// Times are Loci minutes, the scale getLociNowMinutes and the route use: a
// window past midnight runs on past 1440.

// 5 minutes after each task, fixed or not, and the next start rounded up to
// a 5-minute mark (Q35: a task ending 13:02 → the next at 13:10). None after
// a break, and none when the next stop is fixed or a break: that gap absorbs
// it (Q35a). NOW, "From" and fixed times keep their exact minute.
export const ROUTE_BUFFER = 5;
export function afterTask(end) { return Math.ceil((end + ROUTE_BUFFER) / 5) * 5; }
// A gap before a fixed stop shorter than this is not worth a "free" row.
export const MIN_FREE = 5;

export function isFixedStop(task) {
  return task?.dayMapFixedMinutes != null && Number.isFinite(Number(task.dayMapFixedMinutes));
}

// Q31: "Something else" — a call, a meeting — while it has its time. Never
// the one thing or a focus session; unfixed, it is a task like any other
// (loopcheck of #430), and fixed again, an event again.
export function isEventTask(task) {
  return task?.fixedKind === "event" && isFixedStop(task);
}

// Breaks are the gaps between focus windows (09:00–13:35 and 14:15–17:30
// make 13:35–14:15 a break). With one window there are none.
export function breaksFromWindows(windows, name = "Break") {
  const spans = mergeWindowSpans(windows);
  const breaks = [];
  for (let i = 1; i < spans.length; i += 1) {
    breaks.push({ start: spans[i - 1][1], end: spans[i][0], name });
  }
  return breaks;
}

// Where `minutes` of work starting at `start` actually runs: a flexible task
// that reaches a break stops for it and continues after it (the user's call
// on the 58a line "The CV continues after lunch").
function runThrough(start, minutes, breaks) {
  const parts = [];
  let at = start;
  let left = minutes;
  for (const b of breaks) {
    if (b.end <= at) continue;
    if (b.start <= at) { at = b.end; continue; }
    if (at + left <= b.start) break;
    parts.push({ start: at, end: b.start });
    left -= b.start - at;
    at = b.end;
  }
  parts.push({ start: at, end: at + left });
  return parts;
}

function afterBreaks(at, breaks) {
  // In start order, so a break that runs into another carries on to its end.
  for (const b of breaks) if (b.start <= at && at < b.end) at = b.end;
  return at;
}

// Lays out today's route. `stops` is the route in its order; `durationOf`
// gives a stop's minutes. Returns the rows in time order:
//   { kind: "stop", task, start, end, fixed, late, pulledForward, continues, continued }
//   { kind: "break", name, start, end, added }  (added: a break you added, by index)
//   { kind: "free", start, end }
// A task split by a break gives two stop rows (the first `continues`, the
// second is `continued`).
//
// Breaks between focus windows split a task that reaches them (it continues
// after). A break you added (`added` set) is a wall, like a fixed stop: a
// task never crosses it but goes after it whole, and the time before it takes
// a later stop that fits (Q36.2). No buffer after a break (Q35a).
//
// The rule (58): fixed stops never move. Flexible stops flow in order from
// `from`. One that would overlap a fixed stop goes after it, order kept; the
// gap before the fixed stop takes the earliest later stop that fits whole
// (pulled forward), and what is left shows as free. If now has passed a fixed
// stop's time, it is `late` and nothing is pushed.
export function layoutRoute(stops, { from, breaks = [], now = -Infinity, durationOf }) {
  const allBreaks = [...breaks].sort((a, b) => a.start - b.start);
  const sortedBreaks = allBreaks.filter(b => b.added == null);
  const walls = [
    ...stops.filter(isFixedStop).map(task => ({ task, start: Number(task.dayMapFixedMinutes), minutes: durationOf(task) })),
    ...allBreaks.filter(b => b.added != null).map(b => ({ start: b.start, minutes: b.end - b.start })),
  ].sort((a, b) => a.start - b.start);
  // The time a wall holds the route: a fixed stop and its buffer, a break
  // to its end.
  const wallEnd = (x) => (x.task ? afterTask(x.start + x.minutes) : x.start + x.minutes);
  const queue = stops.filter(t => !isFixedStop(t));
  const rows = [];
  let cursor = from;
  let w = 0;

  // The one thing sits at NOW (53–56): heading the route, it starts at
  // `from` and stops for a fixed stop as it does for a break, continuing
  // after it (and its buffer). It never goes after the fixed stop, and no
  // shorter stop takes its place (Codex review of #427).
  if (queue[0]?.isNowFocus) {
    const task = queue.shift();
    const pauses = [...sortedBreaks, ...walls.map(x => ({ start: x.start, end: wallEnd(x) }))]
      .sort((a, b) => a.start - b.start);
    const parts = runThrough(afterBreaks(from, pauses), durationOf(task), pauses);
    parts.forEach((p, i) => rows.push({
      kind: "stop", task, start: p.start, end: p.end, fixed: false, late: false,
      pulledForward: false, continues: i < parts.length - 1, continued: i > 0,
    }));
    cursor = afterTask(parts[parts.length - 1].end);
  }

  while (queue.length || w < walls.length) {
    const wall = walls[w];
    if (wall && wall.start <= cursor) {
      if (wall.task) rows.push({ kind: "stop", task: wall.task, start: wall.start, end: wall.start + wall.minutes, fixed: true, late: now >= wall.start });
      cursor = Math.max(cursor, wallEnd(wall));
      w += 1;
      continue;
    }
    const limit = wall ? wall.start : Infinity;
    const at = afterBreaks(cursor, sortedBreaks);
    const fits = (task) => {
      const parts = runThrough(at, durationOf(task), sortedBreaks);
      return parts[parts.length - 1].end <= limit;
    };
    const j = at < limit ? queue.findIndex(fits) : -1;
    if (j === -1) {
      // Nothing fits before the fixed stop: the time up to it is free,
      // less any break inside it.
      let s = cursor;
      for (const b of sortedBreaks) {
        if (b.end <= s || b.start >= limit) continue;
        if (b.start - s >= MIN_FREE) rows.push({ kind: "free", start: s, end: b.start });
        s = Math.max(s, b.end);
      }
      if (limit - s >= MIN_FREE) rows.push({ kind: "free", start: s, end: limit });
      cursor = limit;
      continue;
    }
    const [task] = queue.splice(j, 1);
    const parts = runThrough(at, durationOf(task), sortedBreaks);
    parts.forEach((p, i) => rows.push({
      kind: "stop", task, start: p.start, end: p.end, fixed: false, late: false,
      pulledForward: j > 0, continues: i < parts.length - 1, continued: i > 0,
    }));
    // A fixed stop or break right after it absorbs the buffer: it keeps its
    // own time whatever the cursor says.
    cursor = afterTask(parts[parts.length - 1].end);
  }

  // A break shows only between stops: one with nothing after it is just the
  // end of the day's work — unless you added it (Q31): that one shows.
  // A fixed stop inside a break (a call over lunch) takes that time: the
  // break shows only around it (Codex review of #421). Breaks that overlap
  // show their time once — except one you added, which always keeps its
  // own row, to open (loopcheck of #430).
  const lastEnd = Math.max(-Infinity, ...rows.filter(r => r.kind === "stop").map(r => r.end));
  const fixedRows = rows.filter(r => r.fixed).sort((a, b) => a.start - b.start);
  let shownTo = -Infinity;
  for (const b of allBreaks) {
    if (b.end <= from || (b.start >= lastEnd && b.added == null)) continue;
    const row = (start, end) => rows.push({ kind: "break", name: b.name, start, end, ...(b.added != null ? { added: b.added } : {}) });
    let s = b.added != null ? b.start : Math.max(b.start, shownTo);
    shownTo = Math.max(shownTo, b.end);
    for (const f of fixedRows) {
      if (f.end <= s || f.start >= b.end) continue;
      if (f.start > s) row(s, f.start);
      s = Math.max(s, f.end);
    }
    if (s < b.end) row(s, b.end);
  }
  return rows.sort((a, b) => a.start - b.start);
}

// Each task's start as laid out (its first part, for a split one).
export function layoutStarts(rows) {
  const starts = new Map();
  for (const r of rows) {
    if (r.kind === "stop" && !starts.has(r.task)) starts.set(r.task, r.start);
  }
  return starts;
}
