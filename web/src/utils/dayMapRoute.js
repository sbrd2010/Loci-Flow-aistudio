export function shouldReflowPastRoute(scheduledTasks, anchorMinutes) {
  if (!Array.isArray(scheduledTasks) || scheduledTasks.length === 0) return false;
  const firstStart = Number(scheduledTasks[0]?.dayMapStartMinutes);
  const anchor = Number(anchorMinutes);
  return Number.isFinite(firstStart) && Number.isFinite(anchor) && firstStart < anchor;
}
