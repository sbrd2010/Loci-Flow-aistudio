// Clear my day (Q52, frames 64n–p): one action, inside Rescue, that replaces
// Bad Day Reset and Clean Slate. It touches Today's open tasks only; tasks at
// a fixed time and done tasks stay, and nothing is deleted. The one thing can
// stay. Undo puts every moved task back as it was.

import { isOnToday } from "./deferral";
import { isFixedStop } from "./dayMapRoute";
import { moveToTomorrow, nextDateStr } from "./dayMapPlan";

export const CLEAR_DESTINATIONS = [
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "park", label: "Park" },
];

const idOf = (t) => String(t.uuid || t.id);

// What Clear my day would move: Today's open tasks minus fixed times and,
// when kept, the one thing.
export function clearMyDayPlan(tasks, { todayStr, keepUuid = null } = {}) {
  const open = (tasks || []).filter(t => t && !t.isDeleted && !t.isCompleted && !t.isParked && isOnToday(t, todayStr));
  const fixed = open.filter(t => isFixedStop(t));
  const movable = open
    .filter(t => !isFixedStop(t) && !(keepUuid && idOf(t) === keepUuid))
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  return { openCount: open.length, fixedCount: fixed.length, movable };
}

// Returns { tasks, before, ids, appliedAt } or null when nothing would move.
export function clearMyDay(tasks, { dest = "week", todayStr, keepUuid = null, now = Date.now() } = {}) {
  const { movable } = clearMyDayPlan(tasks, { todayStr, keepUuid });
  if (!movable.length) return null;
  const ids = movable.map(idOf);
  const before = movable.map(t => ({ ...t }));
  if (dest === "tomorrow") {
    const moved = moveToTomorrow(tasks, ids, nextDateStr(todayStr), now);
    return { tasks: moved.tasks, before, ids, appliedAt: now };
  }
  // In Today's order, under whatever This week already holds.
  const bottom = (tasks || [])
    .filter(t => t.horizonLevel === "week" && !t.isDeleted && !ids.includes(idOf(t)))
    .reduce((m, t) => Math.max(m, Number(t.orderIndex) || 0), -1);
  const place = new Map(ids.map((id, i) => [id, bottom + 1 + i]));
  const next = tasks.map(t => {
    if (!place.has(idOf(t))) return t;
    if (dest === "park") return { ...t, isParked: true, parkedAt: now, isNowFocus: false, lastUpdated: now };
    return { ...t, horizonLevel: "week", orderIndex: place.get(idOf(t)), deferredUntil: null, isNowFocus: false, lastUpdated: now };
  });
  return { tasks: next, before, ids, appliedAt: now };
}

// Undo: each moved task goes back as it was, unless it has changed since.
export function undoClearMyDay(tasks, { before = [], appliedAt }) {
  const byId = new Map(before.map(t => [idOf(t), t]));
  return (tasks || []).map(t => {
    const was = byId.get(idOf(t));
    return was && t.lastUpdated === appliedAt ? was : t;
  });
}
