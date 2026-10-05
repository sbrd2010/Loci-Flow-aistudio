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
// Turn 76 (d): only tasks that fit before the day ends (`fits`), so it may
// suggest fewer than three.
export function suggestMinimumDay(ordered, isGoal, fits = () => true) {
  ordered = ordered.filter(t => !isEventTask(t) && fits(t));
  const must = ordered.filter(t => t.isMVD);
  const goal = ordered.filter(t => !t.isMVD && isGoal(t));
  return [...must, ...goal].slice(0, MINIMUM_DAY_SIZE).map(idOf);
}

// What the page shows: the confirmed pick (open ones only, in today's
// order), or the suggestion. `state` is "confirmed" or "suggested".
// A confirmed pick stays as chosen, fitting or not.
export function minimumDay({ config, todayStr, ordered, isGoal, fits }) {
  const confirmed = confirmedMinimumDay(config, todayStr);
  if (confirmed) {
    const set = new Set(confirmed);
    return { state: "confirmed", ids: ordered.map(idOf).filter(id => set.has(id)) };
  }
  return { state: "suggested", ids: suggestMinimumDay(ordered, isGoal, fits) };
}

// The config patch that confirms `ids` for today (at most three).
export function confirmMinimumDay(config, todayStr, ids, now = Date.now()) {
  return { ...config, minimumDay: { date: todayStr, ids: ids.slice(0, MINIMUM_DAY_SIZE).map(String) }, lastUpdated: now };
}
