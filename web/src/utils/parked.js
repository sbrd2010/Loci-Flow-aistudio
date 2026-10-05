// Parked (62d): tasks set aside by Bad Day Reset or Park, shown in a fold at
// the bottom of Today's list until restored or dropped.

export function parkedTasks(tasks = []) {
  return tasks
    .filter(t => t.isParked && !t.isDeleted && !t.isCompleted)
    .sort((a, b) => parkedSince(a) - parkedSince(b));
}

// Tasks parked before parkedAt existed fall back to their last edit.
export function parkedSince(task) {
  return Number(task.parkedAt) || Number(task.lastUpdated) || 0;
}

// Restore puts the task at the bottom of Today's list, and so of the route
// (Q59): its old stop is let go, and it joins the route anew. `before` holds
// what Undo needs to put it back.
export function restoreParked(tasks, uuid, now = Date.now()) {
  const task = tasks.find(t => t.uuid === uuid && t.isParked && !t.isDeleted);
  if (!task) return { tasks, before: null };
  const bottom = tasks
    .filter(t => t.horizonLevel === "today" && !t.isDeleted && !t.isParked && t.uuid !== uuid)
    .reduce((max, t) => Math.max(max, Number(t.orderIndex) || 0), -1) + 1;
  // parkedAt keeps "since" (and the fold's order) through an Undo, also for a
  // task parked before parkedAt existed.
  const before = { horizonLevel: task.horizonLevel, orderIndex: task.orderIndex ?? null, deferredUntil: task.deferredUntil ?? null, parkedAt: parkedSince(task) || null };
  return {
    tasks: tasks.map(t => {
      if (t.uuid !== uuid) return t;
      const { dayMapDate, dayMapPeriod, dayMapStartMinutes, dayMapDurationMinutes, dayMapOrder, dayMapFixedMinutes, ...rest } = t;
      return { ...rest, isParked: false, horizonLevel: "today", orderIndex: bottom, deferredUntil: null, lastUpdated: now };
    }),
    before,
  };
}

// Undo of Restore: parked again, where it was — only if it is still as
// Restore left it.
export function undoRestoreParked(tasks, uuid, before, now = Date.now()) {
  return tasks.map(t => t.uuid === uuid && !t.isParked && !t.isDeleted && !t.isCompleted && t.horizonLevel === "today"
    ? { ...t, isParked: true, ...before, lastUpdated: now }
    : t);
}
