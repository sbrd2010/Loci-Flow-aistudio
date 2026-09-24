import { getLociNowMinutes, mergeWindowSpans } from "./focusWindows";

// The Day map's arithmetic (Addendum Y5; 33a, 34c, 37d). The route is a
// queue of today's tasks laid end to end from a start time; the day ends
// when the focus time left runs out. Everything that starts after that line
// won't fit, and can be moved to the top of tomorrow's route — nothing is
// deleted.

// "11:00", "16:10" — the design's timeline is 24-hour throughout.
export function formatClock24(minutes) {
  const n = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

// "25m", "3h", "1h25m", "14h50m" — the same compact form as the header clock.
export function formatSpan(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}m` : `${h}h`;
}

// Clock minutes from the route's start to where the day ends: the end of the
// last focus window (brief: "the day end is the end of the last focus
// window"). The route runs on the clock, gaps included, so the line must too:
// with 09:00–12:00 and 14:00–17:00, a route from 10:00 ends its day at 17:00,
// not at 10:00 plus five hours of focus time.
export function dayLeftFrom(startMinutes, now, windows) {
  const at = new Date(now);
  at.setHours(0, 0, 0, 0);
  at.setMinutes(startMinutes);
  const lociStart = getLociNowMinutes(at, windows);
  const lastEnd = Math.max(...mergeWindowSpans(windows).map(([, end]) => end));
  return Math.max(0, Math.round(lastEnd - lociStart));
}

// Where the day ends along the route, and what that means for each stop.
// `route` is the reflowed route ({ dayMapStartMinutes, dayMapDurationMinutes }).
export function planDay(route, startMinutes, dayLeft) {
  const dayEnd = startMinutes + dayLeft;
  const last = route[route.length - 1];
  const routeEnd = last ? Number(last.dayMapStartMinutes) + Number(last.dayMapDurationMinutes) : startMinutes;
  const overIndex = route.findIndex(t => Number(t.dayMapStartMinutes) >= dayEnd);
  const fitting = overIndex === -1 ? route : route.slice(0, overIndex);
  const lastFitting = fitting[fitting.length - 1];
  const lastFittingEnd = lastFitting ? Number(lastFitting.dayMapStartMinutes) + Number(lastFitting.dayMapDurationMinutes) : startMinutes;
  return {
    dayEnd,
    planned: routeEnd - startMinutes,
    dayLeft,
    overBy: Math.max(0, routeEnd - dayEnd),
    // Index of the first stop that starts at or after the day end (-1: none).
    overIndex,
    wontFit: overIndex === -1 ? [] : route.slice(overIndex),
    // The last stop that starts in time but runs past the line ("The 14:35
    // CV runs 1h25m past"), or null.
    runsPast: lastFitting && lastFittingEnd > dayEnd ? { task: lastFitting, by: lastFittingEnd - dayEnd } : null,
  };
}

// "2026-09-23" → "2026-09-24", in local calendar terms.
export function nextDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

// What a move to tomorrow touches, and so what its Undo puts back.
const MOVE_FIELDS = ["dayMapDate", "dayMapPeriod", "dayMapStartMinutes", "dayMapDurationMinutes", "dayMapOrder", "deferredUntil", "orderIndex"];

// Moves these tasks to tomorrow, in their current order. They keep the Today
// horizon but leave today (deferredUntil, see deferral.js); tomorrow they head
// both the list (a negative orderIndex) and the Day map's route (a negative
// dayMapOrder), which times them from its own start. A pinned one is unpinned:
// the one thing is today's. Returns the new list and what Undo needs.
export function moveToTomorrow(allTasks, ids, tomorrowStr, now = Date.now()) {
  // A later batch goes after any already moved to that day, still ahead of
  // the rest of the list (orders below 0): -3..-1 then -0.67, -0.33.
  const earlier = allTasks
    .filter(t => t.deferredUntil === tomorrowStr && !ids.includes(String(t.uuid || t.id)))
    .map(t => Number(t.orderIndex))
    .filter(n => Number.isFinite(n) && n < 0);
  const hi = earlier.length ? Math.max(...earlier) : null;
  const n = ids.length;
  const order = new Map(ids.map((id, i) => [id, hi === null ? i - n : hi + ((i + 1) * -hi) / (n + 1)]));
  const before = [];
  const tasks = allTasks.map(t => {
    const id = String(t.uuid || t.id);
    if (!order.has(id)) return t;
    before.push(t);
    const { dayMapPeriod, dayMapStartMinutes, ...rest } = t; // eslint-disable-line no-unused-vars
    return {
      ...rest,
      dayMapDate: tomorrowStr,
      dayMapOrder: order.get(id),
      deferredUntil: tomorrowStr,
      orderIndex: order.get(id),
      isNowFocus: false,
      lastUpdated: now,
    };
  });
  return { tasks, before };
}

// Undo for moveToTomorrow: restores only what the move changed, so an edit
// made to one of those tasks in the meantime (a new title, say) survives. A
// pin comes back only if nothing else was pinned since.
export function restoreSchedule(allTasks, before, now = Date.now()) {
  const saved = new Map(before.map(t => [String(t.uuid || t.id), t]));
  const pinnedElsewhere = allTasks.some(t => t.isNowFocus && !t.isDeleted && !t.isCompleted && !saved.has(String(t.uuid || t.id)));
  return allTasks.map(t => {
    const old = saved.get(String(t.uuid || t.id));
    if (!old) return t;
    const next = { ...t, lastUpdated: now };
    for (const f of MOVE_FIELDS) {
      if (old[f] === undefined) delete next[f];
      else next[f] = old[f];
    }
    if (old.isNowFocus && !pinnedElsewhere) next.isNowFocus = true;
    return next;
  });
}
