import { isDeferred } from "../../web/src/utils/deferral.js";
import { frontsFromConfig } from "../../web/src/utils/fronts.js";
import { addDays, daysBetween } from "./time.js";
import { datedTasks, deadlineStatus, prepare, todayOrder } from "./context.js";

const TODAY_LIST_LIMIT = 40;
const DEADLINE_LIST_LIMIT = 25;
const UPCOMING_DAYS = 14;

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
  const c = prepare(raw, nowMs, timeZone);
  const { live, active, calendarToday, lociDay } = c;

  const horizons = {};
  for (const t of active) {
    const key = t.horizonLevel === "today" && isDeferred(t, lociDay) ? "tomorrow" : t.horizonLevel;
    horizons[key] = (horizons[key] || 0) + 1;
  }

  // Pinned task first, then the user's own list order, so the cap below keeps what
  // the app puts at the top. (The Day map's route order is not mirrored.)
  const onToday = active
    .filter(t => t.horizonLevel === "today" && !isDeferred(t, lociDay))
    .sort(todayOrder);
  const doneToday = live.filter(t => t.isCompleted && t.dateCompletedString === lociDay);
  const plannedMinutes = onToday.reduce((sum, t) => sum + (Number(t.timeEstimateMinutes) || 0), 0);

  const dated = datedTasks(c).map(({ task, due, daysLeft, viaFront }) => ({
    title: task.title, horizon: task.horizonLevel, due, daysLeft, ...(viaFront ? { viaFront } : {}),
  }));

  const liveFronts = frontsFromConfig(c.config).filter(f => !f.parked);
  const fronts = liveFronts
    .map(f => {
      const daysLeft = f.dueAt ? daysBetween(calendarToday, f.dueAt) : null;
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

  // Firebase hands back a hole in a sparse array as null.
  const completedByDay = new Map(c.contributions.filter(x => x && typeof x === "object").map(x => [x.dateString, Number(x.count) || 0]));
  const last7Days = [];
  for (let back = 6; back >= 0; back -= 1) {
    const day = addDays(lociDay, -back);
    last7Days.push({ date: day, completed: completedByDay.get(day) || 0 });
  }

  return {
    today: calendarToday,
    lociDay,
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
