// "Move to tomorrow" (Day map; Evening review's Tomorrow later): the task
// keeps its Today horizon but carries the Loci day it comes back on — the day
// after the one it was moved on. Callers pass the current Loci day
// (getLociDayStr), so a window that runs past midnight keeps it off Today
// until that window ends, not until 00:00.
// Until then it is not today's — not on Today's list or wall, not in the
// Coach's picture of today, not in Reset today. On that date it simply
// reappears, at the top of the list (its orderIndex was set below the rest).
function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isDeferred(task, todayStr = localDateString(new Date())) {
  return typeof task?.deferredUntil === "string" && task.deferredUntil > todayStr;
}

// On Today, and not waiting for a later day.
export function isOnToday(task, todayStr) {
  return task?.horizonLevel === "today" && !isDeferred(task, todayStr);
}
