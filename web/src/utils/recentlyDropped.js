// Recently dropped (57b answers 11 and 24): a task you Drop or Delete stays
// 30 days in Settings → Data, where Restore puts it back. After that it
// leaves the list but stays in your data (nothing is erased).
import { horizonsFromConfig, TODAY_ID, WORK_OLDER_ID } from "./horizons";

export const DROP_KEEP_DAYS = 30;
const DAY_MS = 86400000;

// Newest first. Only tasks dropped with a date (deletedAt): a split's
// replaced original is not something you dropped.
export function recentlyDropped(tasks = [], now = Date.now()) {
  return tasks
    .filter(t => t.isDeleted && Number(t.deletedAt) > 0 && now - t.deletedAt < DROP_KEEP_DAYS * DAY_MS)
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

// "Dropped today · 30 days left", "Dropped 3 days ago · 27 days left".
export function droppedLine(task, now = Date.now()) {
  const ago = Math.floor((now - task.deletedAt) / DAY_MS);
  const left = DROP_KEEP_DAYS - ago;
  const when = ago === 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`;
  return `Dropped ${when} · ${left} ${left === 1 ? "day" : "days"} left`;
}

// Back where it was — or This week when its horizon is gone or hidden, or
// the first horizon shown if This week is hidden too, so a restored task is
// never out of sight (Codex review of #445).
export function restoreDropped(payload, uuid, day, now = Date.now()) {
  const visible = horizonsFromConfig(payload.config || {}, day).filter(h => !h.hidden).map(h => h.id);
  const shown = new Set([TODAY_ID, WORK_OLDER_ID, ...visible]);
  const fallback = visible.includes("week") ? "week" : visible[0] || TODAY_ID;
  const tasks = payload.tasks || [];
  const place = (id) => tasks.filter(t => t.horizonLevel === id && !t.isDeleted && !t.isCompleted).length;
  return {
    ...payload,
    tasks: tasks.map(t => {
      if (t.uuid !== uuid || !t.isDeleted) return t;
      const horizonLevel = shown.has(t.horizonLevel) ? t.horizonLevel : fallback;
      return { ...t, isDeleted: false, deletedAt: null, isNowFocus: false, horizonLevel, orderIndex: place(horizonLevel), lastUpdated: now };
    }),
  };
}
