import { normalizePayload } from "../../web/src/utils/normalizePayload.js";
import { getFocusWindows, getLociDayStr } from "../../web/src/utils/focusWindows.js";
import { isActiveLociTask } from "../../web/src/utils/lociAIContext.js";
import { frontsFromConfig } from "../../web/src/utils/fronts.js";
import { assertUtcRuntime, dateString, daysBetween, wallClock } from "./time.js";

// Longest list any tool returns. A guard for the Worker and the model's context,
// far above what a real plan holds; a list that hits it says so (see cap()).
export const LIST_LIMIT = 200;
// A task's own deadline must be a real moment before 2100; 0, negatives and absurd
// values are treated as "no date" instead of becoming 1970 or a crash.
const MAX_DEADLINE_MS = Date.UTC(2100, 0, 1);

// Everything the tools share, worked out once from the raw sync/{uid} record.
export function prepare(raw, nowMs, timeZone) {
  assertUtcRuntime();
  const { tasks, config, contributions, brainDump } = normalizePayload(raw);
  const wall = wallClock(nowMs, timeZone);
  const windows = getFocusWindows(config);
  const live = tasks.filter(t => !t.isDeleted);
  return {
    tasks, live, active: live.filter(isActiveLociTask), config, contributions, brainDump, timeZone, nowMs, wall, windows,
    // Two different "todays", as in the app. The Loci day runs until the user's
    // window ends (past midnight for some), and rules the Today list, deferral and
    // dateCompletedString. The calendar date rules deadlines (frontDaysLeft) and
    // contributions[].dateString.
    calendarToday: dateString(wall),
    lociDay: getLociDayStr(wall, windows),
  };
}

// A task as the app holds it, minus the owner's id. Every other field is passed
// through, so a field the app adds later reaches the AI without a change here.
export function taskView(task) {
  const { userId, ...rest } = task;
  return rest;
}

// Pinned task first, then the user's own list order.
export const todayOrder = (a, b) => Number(!!b.isNowFocus) - Number(!!a.isNowFocus) || (a.orderIndex ?? 0) - (b.orderIndex ?? 0);

export const minutesOf = (t) => Number(t.timeEstimateMinutes) || Number(t.dayMapDurationMinutes) || 25;

// Keeps a list within LIST_LIMIT and records that it was cut, so the AI is told
// instead of assuming it saw everything.
export function cap(list, name, truncated) {
  if (list.length > LIST_LIMIT) truncated.push({ list: name, total: list.length, shown: LIST_LIMIT });
  return list.slice(0, LIST_LIMIT);
}

export function deadlineStatus(daysLeft) {
  if (daysLeft === null) return "no date";
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "due today";
  return "upcoming";
}

// Open tasks that have a date, nearest first. A task's own date wins; otherwise it
// takes its front's, as the app's narrowDown does. The app only ever sets a task's
// own date to null, so in practice nearly every task deadline is its front's.
export function datedTasks(c) {
  const fronts = new Map(frontsFromConfig(c.config).filter(f => !f.parked).map(f => [f.id, f]));
  return c.active
    .map(task => {
      const own = Number(task.deadlineTimestamp);
      if (Number.isFinite(own) && own > 0 && own < MAX_DEADLINE_MS) {
        return { task, due: dateString(wallClock(own, c.timeZone)), viaFront: null };
      }
      const front = fronts.get(task.frontId);
      return front?.dueAt ? { task, due: front.dueAt, viaFront: front.name } : null;
    })
    .filter(Boolean)
    .map(d => ({ ...d, daysLeft: daysBetween(c.calendarToday, d.due) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
