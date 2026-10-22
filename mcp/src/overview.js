import { normalizePayload } from "../../web/src/utils/normalizePayload.js";
import { getFocusWindows, getLociDayStr } from "../../web/src/utils/focusWindows.js";
import { isActiveLociTask } from "../../web/src/utils/lociAIContext.js";
import { isDeferred } from "../../web/src/utils/deferral.js";
import { frontsFromConfig } from "../../web/src/utils/fronts.js";
import { addDays, assertUtcRuntime, dateString, daysBetween, wallClock } from "./time.js";

const TODAY_LIST_LIMIT = 40;
const DEADLINE_LIST_LIMIT = 25;
const UPCOMING_DAYS = 14;

function deadlineStatus(daysLeft) {
  if (daysLeft === null) return "no date";
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "due today";
  return "upcoming";
}

function taskLine(t) {
  const steps = Array.isArray(t.subSteps) ? t.subSteps : [];
  return {
    title: t.title,
    nextStep: t.concreteStep || null,
    priority: t.priority,
    category: t.category,
    estimateMinutes: t.timeEstimateMinutes ?? null,
    isNowFocus: !!t.isNowFocus,
    subSteps: steps.length ? { done: steps.filter(s => s?.done).length, total: steps.length } : null,
  };
}

// What the connector says about a plan, from the raw sync/{uid} record.
// Deliberately leaves out chat history, Mind Box thoughts, names and anchors:
// the plan is what gets reviewed, not the user's private notes.
export function buildOverview(raw, nowMs, timeZone) {
  assertUtcRuntime();
  const { tasks, config, contributions } = normalizePayload(raw);
  const wall = wallClock(nowMs, timeZone);
  const todayStr = getLociDayStr(wall, getFocusWindows(config));
  const live = tasks.filter(t => !t.isDeleted);
  const active = live.filter(isActiveLociTask);

  const horizons = {};
  for (const t of active) {
    const key = t.horizonLevel === "today" && isDeferred(t, todayStr) ? "tomorrow" : t.horizonLevel;
    horizons[key] = (horizons[key] || 0) + 1;
  }

  const onToday = active.filter(t => t.horizonLevel === "today" && !isDeferred(t, todayStr));
  const doneToday = live.filter(t => t.isCompleted && t.dateCompletedString === todayStr);
  const plannedMinutes = onToday.reduce((sum, t) => sum + (Number(t.timeEstimateMinutes) || 0), 0);

  const dated = active
    .filter(t => Number.isFinite(t.deadlineTimestamp))
    .map(t => ({ t, due: dateString(wallClock(t.deadlineTimestamp, timeZone)) }))
    .map(({ t, due }) => ({ title: t.title, horizon: t.horizonLevel, due, daysLeft: daysBetween(todayStr, due) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const fronts = frontsFromConfig(config)
    .filter(f => !f.parked)
    .map(f => {
      const daysLeft = f.dueAt ? daysBetween(todayStr, f.dueAt) : null;
      const mine = live.filter(t => t.frontId === f.id);
      return {
        name: f.name,
        due: f.dueAt,
        daysLeft,
        status: deadlineStatus(daysLeft),
        nextMove: f.nextMove,
        tasks: { open: mine.filter(t => !t.isCompleted && !t.isParked).length, done: mine.filter(t => t.isCompleted).length },
      };
    })
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));

  const completedByDay = new Map(contributions.map(c => [c.dateString, Number(c.count) || 0]));
  const last7Days = [];
  for (let back = 6; back >= 0; back -= 1) {
    const day = addDays(todayStr, -back);
    last7Days.push({ date: day, completed: completedByDay.get(day) || 0 });
  }

  return {
    today: todayStr,
    timeZone,
    fronts,
    horizons,
    todayList: {
      openCount: onToday.length,
      plannedMinutes,
      completedCount: doneToday.length,
      tasks: onToday.slice(0, TODAY_LIST_LIMIT).map(taskLine),
      truncated: onToday.length > TODAY_LIST_LIMIT,
    },
    taskDeadlines: {
      overdue: dated.filter(d => d.daysLeft < 0).slice(0, DEADLINE_LIST_LIMIT),
      dueToday: dated.filter(d => d.daysLeft === 0).slice(0, DEADLINE_LIST_LIMIT),
      upcoming: dated.filter(d => d.daysLeft > 0 && d.daysLeft <= UPCOMING_DAYS).slice(0, DEADLINE_LIST_LIMIT),
    },
    last7Days,
  };
}
