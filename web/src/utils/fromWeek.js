// "From This week" (67j, 67s): with nothing in Today, chosen This week tasks
// move to Today in the order picked, at the bottom of the list (and so of the
// route), and the first becomes the one thing. `before` holds what Undo needs.

export function weekTasks(tasks = []) {
  return tasks
    .filter(t => t.horizonLevel === "week" && !t.isDeleted && !t.isCompleted && !t.isParked)
    .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
}

export function pullFromWeek(tasks, uuids, now = Date.now()) {
  // The same tasks the picker lists (weekTasks): one parked meanwhile, say on
  // another device, is no longer one of them (Codex review of #486).
  const chosen = uuids.filter(u => tasks.some(t => t.uuid === u && t.horizonLevel === "week" && !t.isDeleted && !t.isCompleted && !t.isParked));
  if (!chosen.length) return { tasks, before: [] };
  const bottom = tasks
    .filter(t => t.horizonLevel === "today" && !t.isDeleted)
    .reduce((max, t) => Math.max(max, Number(t.orderIndex) || 0), -1) + 1;
  const before = chosen.map(u => {
    const t = tasks.find(x => x.uuid === u);
    return { uuid: u, horizonLevel: t.horizonLevel, orderIndex: t.orderIndex ?? null };
  });
  const first = chosen[0];
  return {
    tasks: tasks.map(t => {
      const i = chosen.indexOf(t.uuid);
      if (i === -1) {
        // The one thing is exclusive: whatever held it lets go.
        return t.isNowFocus ? { ...t, isNowFocus: false, lastUpdated: now } : t;
      }
      // It joins the route anew, as Restore does.
      const { dayMapDate, dayMapPeriod, dayMapStartMinutes, dayMapDurationMinutes, dayMapOrder, dayMapFixedMinutes, ...rest } = t;
      return { ...rest, horizonLevel: "today", orderIndex: bottom + i, isNowFocus: t.uuid === first, lastUpdated: now };
    }),
    before,
  };
}

// Whether the move takes the one thing from a task that held it: then that
// task's open session has to end (Codex review of #486). The new one thing is
// the first chosen, so a held task ticked later still loses the pin.
export function takesPinFrom(tasks, next) {
  const held = tasks.find(t => t.isNowFocus && !t.isDeleted);
  if (!held) return false;
  const now = next.find(t => t.isNowFocus && !t.isDeleted);
  return !now || now.uuid !== held.uuid;
}

// Undo: back to This week, where they were — the ones still open in Today.
// lastUpdated can't tell a user's change from the route taking them in
// (joinRoute stamps it at once), so it isn't checked; Undo lasts 5 seconds.
// The route fields they picked up go with them.
export function undoPullFromWeek(tasks, before, now = Date.now()) {
  const byId = new Map(before.map(b => [b.uuid, b]));
  return tasks.map(t => {
    const b = byId.get(t.uuid);
    if (!b || t.isDeleted || t.isCompleted || t.horizonLevel !== "today") return t;
    const { dayMapDate, dayMapPeriod, dayMapStartMinutes, dayMapDurationMinutes, dayMapOrder, dayMapFixedMinutes, ...rest } = t;
    return { ...rest, horizonLevel: b.horizonLevel, orderIndex: b.orderIndex, isNowFocus: false, lastUpdated: now };
  });
}
