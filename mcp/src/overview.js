import { normalizePayload } from "../../web/src/utils/normalizePayload.js";
import { getFocusWindows, getLociDayStr } from "../../web/src/utils/focusWindows.js";
import { isActiveLociTask } from "../../web/src/utils/lociAIContext.js";
import { isDeferred } from "../../web/src/utils/deferral.js";
import { frontsFromConfig } from "../../web/src/utils/fronts.js";
import { addDays, assertUtcRuntime, dateString, daysBetween, wallClock } from "./time.js";

const TODAY_LIST_LIMIT = 40;
const DEADLINE_LIST_LIMIT = 25;
const UPCOMING_DAYS = 14;
// A task's own deadline must be a real moment before 2100; 0, negatives and absurd
// values are treated as "no date" instead of becoming 1970 or a crash.
const MAX_DEADLINE_MS = Date.UTC(2100, 0, 1);

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
  // Two different "todays", as in the app. The Loci day runs until the user's
  // window ends (past midnight for some), and rules the Today list, deferral and
  // dateCompletedString. The calendar date rules deadlines (frontDaysLeft) and
  // contributions[].dateString.
  const calendarToday = dateString(wall);
  const lociDay = getLociDayStr(wall, getFocusWindows(config));
  const live = tasks.filter(t => !t.isDeleted);
  const active = live.filter(isActiveLociTask);

  const horizons = {};
  for (const t of active) {
    const key = t.horizonLevel === "today" && isDeferred(t, lociDay) ? "tomorrow" : t.horizonLevel;
    horizons[key] = (horizons[key] || 0) + 1;
  }

  // Pinned task first, then the user's own list order, so the cap below keeps what
  // the app puts at the top. (The Day map's route order is not mirrored.)
  const onToday = active
    .filter(t => t.horizonLevel === "today" && !isDeferred(t, lociDay))
    .sort((a, b) => Number(!!b.isNowFocus) - Number(!!a.isNowFocus) || (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const doneToday = live.filter(t => t.isCompleted && t.dateCompletedString === lociDay);
  const plannedMinutes = onToday.reduce((sum, t) => sum + (Number(t.timeEstimateMinutes) || 0), 0);

  const liveFronts = frontsFromConfig(config).filter(f => !f.parked);
  const frontById = new Map(liveFronts.map(f => [f.id, f]));
  // A task's own date wins; otherwise it takes its front's, as the app's
  // narrowDown does. The app only ever sets a task's own date to null, so in
  // practice nearly every task deadline is its front's.
  const dated = active
    .map(t => {
      const own = Number(t.deadlineTimestamp);
      if (Number.isFinite(own) && own > 0 && own < MAX_DEADLINE_MS) {
        return { t, due: dateString(wallClock(own, timeZone)), viaFront: null };
      }
      const front = frontById.get(t.frontId);
      return front?.dueAt ? { t, due: front.dueAt, viaFront: front.name } : null;
    })
    .filter(Boolean)
    .map(({ t, due, viaFront }) => ({
      title: t.title, horizon: t.horizonLevel, due, daysLeft: daysBetween(calendarToday, due), ...(viaFront ? { viaFront } : {}),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

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
  const completedByDay = new Map(contributions.filter(c => c && typeof c === "object").map(c => [c.dateString, Number(c.count) || 0]));
  const last7Days = [];
  for (let back = 6; back >= 0; back -= 1) {
    const day = addDays(calendarToday, -back);
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
