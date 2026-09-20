// Evening Guard — "Blocks adding new tasks after 8 PM."
//
// The rule lived inline in AddTaskDialog and again in coachActions, and a
// third creation path (the wall's commit field) was written without it and
// bypassed the setting entirely. One predicate, so the next new path has
// something to call rather than something to remember.
//
// The copy stays at each call site: the dialog shows a form error, Coach
// answers in its own voice, and the wall says it in one line. Only the
// decision is shared.

export const EVENING_GUARD_HOUR = 20;

export function isEveningGuardBlocked(config = {}, now = new Date()) {
  if (!config?.eveningGuardWindowActive) return false;
  const at = now instanceof Date ? now : new Date(now);
  return at.getHours() >= EVENING_GUARD_HOUR;
}
