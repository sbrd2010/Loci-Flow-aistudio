// Minimum day (56a–b, 57b answer 6, Q33.1): "If today goes wrong, do these
// 3". Loci suggests up to three of today's open tasks — must-dos first, then
// goal tasks, each in the order they come today — and you Confirm or Change
// them. Confirmed, they carry MIN on Today's list and the Day map. It resets
// daily: stored as config.minimumDay = { date, ids } for one Loci day only.

import { isEventTask } from "./dayMapRoute";

export const MINIMUM_DAY_SIZE = 3;

const idOf = (t) => String(t.uuid || t.id);

// The confirmed ids for `todayStr`, or null when today has none yet.
export function confirmedMinimumDay(config, todayStr) {
  const m = config?.minimumDay;
  return m && m.date === todayStr && Array.isArray(m.ids) ? m.ids.map(String) : null;
}

// The suggestion: `ordered` is today's open tasks in the order they come
// (the route, then the rest of the list); `isGoal` says whether a task is on
// the goal front.
// Something at a set time (Q36.3) is never suggested as work (Codex review
// of #431); it can still be picked by hand.
// Turn 76 (d): only tasks that fit before the day ends, so it may suggest
// fewer than three. "Fit" is about the minimum day itself, not today's full
// order: if today goes wrong, the optional tasks are what you drop. So the
// candidates are taken in turn while their minutes together fit in the
// `budget` (the focus time left, less what's at a set time); one too long is
// skipped and a later, shorter one can still go in. `minutesOf(t)` is a
// task's time on the route.
export function pickMinimumDay(ordered, isGoal, { budget = Infinity, minutesOf = () => 0 } = {}) {
  ordered = ordered.filter(t => !isEventTask(t));
  const candidates = [...ordered.filter(t => t.isMVD), ...ordered.filter(t => !t.isMVD && isGoal(t))];
  const ids = [];
  let used = 0;
  let unfit = 0;
  for (const t of candidates) {
    if (ids.length >= MINIMUM_DAY_SIZE) break;
    const mins = Math.max(0, Number(minutesOf(t)) || 0);
    if (used + mins > budget) { unfit += 1; continue; }
    used += mins;
    ids.push(idOf(t));
  }
  return { ids, unfit };
}

export function suggestMinimumDay(ordered, isGoal, fit) {
  return pickMinimumDay(ordered, isGoal, fit).ids;
}

// What the page shows: the confirmed pick (open ones only, in today's
// order), or the suggestion. `state` is "confirmed" or "suggested"; a
// suggestion also counts the must-dos and goal tasks left out for time
// (`unfit`), so an empty one can say why. A confirmed pick stays as chosen,
// fitting or not.
export function minimumDay({ config, todayStr, ordered, isGoal, budget, minutesOf }) {
  const confirmed = confirmedMinimumDay(config, todayStr);
  if (confirmed) {
    const set = new Set(confirmed);
    return { state: "confirmed", ids: ordered.map(idOf).filter(id => set.has(id)) };
  }
  return { state: "suggested", ...pickMinimumDay(ordered, isGoal, { budget, minutesOf }) };
}

// The config patch that confirms `ids` for today (at most three).
export function confirmMinimumDay(config, todayStr, ids, now = Date.now()) {
  return { ...config, minimumDay: { date: todayStr, ids: ids.slice(0, MINIMUM_DAY_SIZE).map(String) }, lastUpdated: now };
}
