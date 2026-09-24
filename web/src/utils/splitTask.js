// Split a task (45d): one task becomes N smaller ones, in its place, and the
// original is replaced (deleted, restorable). Steps are 45 minutes or less.
export const MAX_STEP_MINUTES = 45;
export const STEP_MINUTE_OPTIONS = [10, 15, 20, 25, 30, 45];

// N durations that share `total` minutes as evenly as the step options allow,
// each capped at 45: 120 over 3 → [45, 45, 30].
export function evenMinutes(total, n) {
  if (n <= 0) return [];
  const t = Math.max(10, Number(total) || 25);
  const opts = STEP_MINUTE_OPTIONS;
  // Start every step on the largest option at or under its fair share...
  const start = [...opts].reverse().find(o => o <= t / n) ?? opts[0];
  const out = Array(n).fill(start);
  let left = t - start * n;
  // ...then step them up in order while the total still allows.
  for (let i = 0; i < n && left > 0; i++) {
    let j = opts.indexOf(out[i]);
    while (j + 1 < opts.length && opts[j + 1] - out[i] <= left) {
      left -= opts[j + 1] - out[i];
      out[i] = opts[++j];
    }
  }
  return out;
}

// The steps a split opens with, when the task already names them: its open
// sub-steps (two or more). Otherwise none — the caller may ask the AI.
export function stepsFromSubSteps(task) {
  const open = (task?.subSteps || []).filter(s => s && !s.done && String(s.text || "").trim());
  if (open.length < 2) return [];
  const minutes = evenMinutes(task.timeEstimateMinutes || 25 * open.length, open.length);
  return open.slice(0, 8).map((s, i) => ({ text: String(s.text).trim(), minutes: minutes[i] }));
}

// The tasks the split creates, in the original's place, and the list with the
// original replaced. Steps without text are dropped. The first new task takes
// the original's pin.
export function buildSplit(allTasks, original, steps, { now = Date.now(), makeId } = {}) {
  const real = steps.filter(s => String(s.text || "").trim());
  const base = Number(original.orderIndex) || 0;
  const created = real.map((s, i) => ({
    id: now + i,
    uuid: makeId(),
    userId: original.userId,
    title: String(s.text).trim(),
    horizonLevel: original.horizonLevel,
    priority: original.priority,
    category: original.category,
    frontId: original.frontId || null,
    ...(original.isMVD ? { isMVD: true } : {}),
    timeEstimateMinutes: Math.min(MAX_STEP_MINUTES, Number(s.minutes) || 25),
    // Fractions keep the new tasks together at the original's place; the list
    // re-numbers order on its next reorder.
    orderIndex: base + i / real.length,
    isNowFocus: !!original.isNowFocus && i === 0,
    isCompleted: false,
    isParked: false,
    isDeleted: false,
    dateCompletedString: null,
    deadlineTimestamp: null,
    reminderAt: null,
    subSteps: [],
    splitFrom: original.uuid,
    lastUpdated: now,
  }));
  const tasks = [
    ...allTasks.map(t => t.uuid === original.uuid ? { ...t, isDeleted: true, isNowFocus: false, lastUpdated: now } : t),
    ...created,
  ];
  return { tasks, created };
}

// Undo: the original comes back as it was, and the tasks the split made go.
export function undoSplit(allTasks, original, createdIds, now = Date.now()) {
  const made = new Set(createdIds);
  const pinnedElsewhere = allTasks.some(t => t.isNowFocus && !t.isDeleted && !t.isCompleted && !made.has(t.uuid) && t.uuid !== original.uuid);
  return allTasks
    .map(t => {
      if (t.uuid === original.uuid) return { ...t, isDeleted: false, isNowFocus: !!original.isNowFocus && !pinnedElsewhere, lastUpdated: now };
      if (made.has(t.uuid)) return { ...t, isDeleted: true, isNowFocus: false, lastUpdated: now };
      return t;
    });
}
