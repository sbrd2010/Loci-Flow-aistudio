// A finished task adds one tick to contributions[] for the day it counts toward.
// That day is the Loci day, the same value the task's dateCompletedString
// carries: a task finished at 00:30 in a window that runs to 02:00 belongs to
// the day you are still in, on the Today list and in the counts alike. Every
// place that completes or reopens a task goes through these two functions, so
// the two records cannot drift apart again.

function userIdOf(payload) {
  return payload?.userId || payload?.config?.userId || "";
}

// contributions with one more tick on `dayStr` (a new array; the input is not touched).
export function addCompletionTick(contributions, dayStr, payload, now = Date.now()) {
  const next = [...(contributions || [])];
  const idx = next.findIndex((c) => c && c.dateString === dayStr);
  if (idx === -1) {
    const uid = userIdOf(payload);
    next.push({ compositeKey: `${uid}_${dayStr}`, userId: uid, dateString: dayStr, count: 1, lastUpdated: now });
  } else {
    next[idx] = { ...next[idx], count: (Number(next[idx].count) || 0) + 1, lastUpdated: now };
  }
  return next;
}

// contributions with one tick taken back from `dayStr`, never below zero.
// No day, no change (a row with no dateString must not match "no day").
export function removeCompletionTick(contributions, dayStr, now = Date.now()) {
  const next = [...(contributions || [])];
  if (!dayStr) return next;
  const idx = next.findIndex((c) => c && c.dateString === dayStr);
  if (idx !== -1 && next[idx].count > 0) next[idx] = { ...next[idx], count: next[idx].count - 1, lastUpdated: now };
  return next;
}

// Reopening a task takes its tick back from the day the task was finished on,
// the day it is stamped with, which is not always today. `fallbackDay` is for a
// task with no stamp. Undo of a completion does the same.
export function takeBackTick(contributions, task, fallbackDay, now = Date.now()) {
  return removeCompletionTick(contributions, task?.dateCompletedString || fallbackDay, now);
}
