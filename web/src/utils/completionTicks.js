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
export function removeCompletionTick(contributions, dayStr, now = Date.now()) {
  const next = [...(contributions || [])];
  const idx = next.findIndex((c) => c && c.dateString === dayStr);
  if (idx !== -1 && next[idx].count > 0) next[idx] = { ...next[idx], count: next[idx].count - 1, lastUpdated: now };
  return next;
}
