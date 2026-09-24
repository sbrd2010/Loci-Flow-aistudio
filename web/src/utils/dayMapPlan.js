import { getRemainingFocusMinutes } from "./focusWindows";

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

// Focus time left from the route's start: the focus windows still ahead of
// that moment, gaps excluded. The day ends when it runs out ("compute day end
// from time left", Y5), so with one window it is that window's end.
export function dayLeftFrom(startMinutes, now, windows) {
  const at = new Date(now);
  at.setHours(0, 0, 0, 0);
  at.setMinutes(startMinutes);
  return Math.max(0, Math.round(getRemainingFocusMinutes(at, windows)));
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

const SCHEDULE_FIELDS = ["dayMapDate", "dayMapPeriod", "dayMapStartMinutes", "dayMapDurationMinutes", "dayMapOrder"];

// Moves these tasks to the top of tomorrow's route, in their current order.
// They stay on Today; tomorrow's Day map picks them up first (a negative
// order sorts ahead of anything already there) and times them from its own
// start. Returns the new task list and what Undo needs to put them back.
export function moveToTomorrow(allTasks, ids, tomorrowStr, now = Date.now()) {
  const order = new Map(ids.map((id, i) => [id, i - ids.length]));
  const before = [];
  const tasks = allTasks.map(t => {
    const id = String(t.uuid || t.id);
    if (!order.has(id)) return t;
    before.push(t);
    const { dayMapPeriod, dayMapStartMinutes, ...rest } = t; // eslint-disable-line no-unused-vars
    return { ...rest, dayMapDate: tomorrowStr, dayMapOrder: order.get(id), lastUpdated: now };
  });
  return { tasks, before };
}

// Undo for moveToTomorrow: restores only the schedule fields, so an edit made
// to one of those tasks in the meantime (a new title, say) survives.
export function restoreSchedule(allTasks, before, now = Date.now()) {
  const saved = new Map(before.map(t => [String(t.uuid || t.id), t]));
  return allTasks.map(t => {
    const old = saved.get(String(t.uuid || t.id));
    if (!old) return t;
    const next = { ...t, lastUpdated: now };
    for (const f of SCHEDULE_FIELDS) {
      if (old[f] === undefined) delete next[f];
      else next[f] = old[f];
    }
    return next;
  });
}
