// "Make this the one thing" (50c–d): the task becomes the pinned one, and the
// task that was pinned goes back to the top of "After that" with its steps.
// Returns the new list and what Undo needs: the previous one thing as it was.

import { isEventTask } from "./dayMapRoute";

const key = t => String(t?.uuid || t?.id || "");

export function makeOneThing(allTasks, uuid, now = Date.now()) {
  // A call at a set time is never the one thing (Q36.3): every caller checks,
  // and so does this, for the next one that doesn't (10b).
  const target = allTasks.find(t => key(t) === uuid && !t.isDeleted && !t.isCompleted && !isEventTask(t));
  if (!target) return { tasks: allTasks, previous: null };
  const previous = allTasks.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted && key(t) !== uuid) || null;
  // Above every open Today task, so it heads the list whatever its priority.
  const orders = allTasks
    .filter(t => !t.isDeleted && !t.isCompleted && t.horizonLevel === "today" && key(t) !== uuid)
    .map(t => Number(t.orderIndex))
    .filter(Number.isFinite);
  const top = (orders.length ? Math.min(...orders) : 0) - 1;
  const tasks = allTasks.map(t => {
    if (key(t) === uuid) return t.isNowFocus && !t.deferredUntil ? t : { ...t, isNowFocus: true, deferredUntil: null, lastUpdated: now };
    if (previous && key(t) === key(previous)) return { ...t, isNowFocus: false, orderIndex: top, lastUpdated: now };
    if (t.isNowFocus) return { ...t, isNowFocus: false, lastUpdated: now };
    return t;
  });
  return { tasks, previous };
}

// Undo: the previous one thing goes back to its place and pin; the task made
// the one thing is unpinned. Nothing happens if the pin has moved on since.
export function undoOneThing(allTasks, uuid, previous, now = Date.now()) {
  const current = allTasks.find(t => key(t) === uuid);
  if (!current?.isNowFocus) return allTasks;
  const back = previous && allTasks.find(t => key(t) === key(previous) && !t.isDeleted && !t.isCompleted);
  return allTasks.map(t => {
    if (key(t) === uuid) return { ...t, isNowFocus: false, lastUpdated: now };
    if (back && key(t) === key(back)) return { ...t, isNowFocus: true, orderIndex: previous.orderIndex, lastUpdated: now };
    return t;
  });
}
