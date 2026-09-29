// Block end (59i, Q38.2, Q40.2–3): the over-estimate note and Re-estimate.

// Well over the estimate: at least half as much again, and 15 minutes past
// it — counted on everything done on the task today (Q38.2a–b).
export function isWellOver(estimate, doneMinutes) {
  const e = Number(estimate) || 0;
  const d = Number(doneMinutes) || 0;
  return e > 0 && d >= e * 1.5 && d - e >= 15;
}

// Re-estimate (Q40.3): up to four lengths above what is already spent.
const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480];
export function reestimateChoices(doneMinutes) {
  const d = Number(doneMinutes) || 0;
  return ESTIMATES.filter(m => m > d).slice(0, 4);
}

// Once per task per day, on this device only (Q40.2): shown again only once
// a new estimate is passed too. `seen` is { [taskId]: { day, estimate } }.
export function noteDue(seen, taskId, day, estimate) {
  const s = seen?.[taskId];
  return !(s && s.day === day && s.estimate === estimate);
}

export function markNoteSeen(seen, taskId, day, estimate) {
  // Keep only today's entries, so the store never grows.
  const kept = Object.fromEntries(Object.entries(seen || {}).filter(([, v]) => v?.day === day));
  return { ...kept, [taskId]: { day, estimate } };
}
