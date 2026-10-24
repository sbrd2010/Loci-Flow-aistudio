// One builder per page of the app. Each takes the raw record the Realtime Database
// holds and returns what that page shows, as data. Tasks come back whole (taskView),
// so nothing a page shows is dropped by a list of fields kept here.
import { isDeferred } from "../../web/src/utils/deferral.js";
import { parkedSince, parkedTasks } from "../../web/src/utils/parked.js";
import { confirmedMinimumDay } from "../../web/src/utils/minimumDay.js";
import { getLociNowMinutes, getRemainingFocusMinutes, mergeWindowSpans } from "../../web/src/utils/focusWindows.js";
import { routeBreaks } from "../../web/src/utils/dayMapBreaks.js";
import { dayLeftFrom, formatClock24, planDay } from "../../web/src/utils/dayMapPlan.js";
import { isEventTask, isFixedStop, layoutRoute } from "../../web/src/utils/dayMapRoute.js";
import { BUILT_IN_HORIZONS, WORK_OLDER_ID, currentPeriod, daysLeft as horizonDaysLeft, horizonsFromConfig, taskHorizonId } from "../../web/src/utils/horizons.js";
import { frontNextMove, frontProgress, frontsFromConfig, tasksForFront } from "../../web/src/utils/fronts.js";
import { byPriorityThenOrder } from "../../web/src/utils/taskOps.js";
import { THOUGHTS_MAX, thoughtText } from "../../web/src/utils/thoughts.js";
import { parseThought } from "../../web/src/utils/thoughtFormat.js";
import { briefToText } from "../../web/src/utils/coachBrief.js";
import { REVIEW_PERIODS, reviewFacts } from "../../web/src/utils/coachReview.js";
import { dailyTotals, eventMinutes, flattenFocusEvents, lociDayWindow, minutesByFront } from "../../web/src/utils/focusLedger.js";
import { taskSteps } from "../../web/src/utils/taskSteps.js";
import { addDays, dateString, daysBetween, wallClock } from "./time.js";
import { cap, datedTasks, deadlineStatus, minutesOf, prepare, taskView, todayOrder } from "./context.js";

const DAY_MS = 86400000;
const byOrder = (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
const withTruncated = (out, truncated) => (truncated.length ? { ...out, truncated } : out);
// A task in a list where the whole record would be noise (days of completions).
const brief = (t) => ({
  uuid: t.uuid, title: t.title, horizonLevel: t.horizonLevel, frontId: t.frontId ?? null,
  priority: t.priority, timeEstimateMinutes: t.timeEstimateMinutes ?? null, dateCompletedString: t.dateCompletedString ?? null,
});
// A damaged timestamp must not fail a whole page: it reads as "unknown" (null).
const validMs = (ms) => Number.isFinite(ms) && ms > 0 && ms < Date.UTC(2100, 0, 1);
const localStamp = (ms, timeZone) => (validMs(ms) ? `${dateString(wallClock(ms, timeZone))} ${wallClock(ms, timeZone).toISOString().slice(11, 16)}` : null);
const daysAgo = (ms, calendarToday, timeZone) => (validMs(ms) ? daysBetween(dateString(wallClock(ms, timeZone)), calendarToday) : null);

// The Today page: the list, what was set aside or moved on, and where the day stands.
export function buildToday(raw, nowMs, timeZone) {
  const c = prepare(raw, nowMs, timeZone);
  const { live, active, lociDay, config } = c;
  const truncated = [];
  const onToday = active.filter(t => t.horizonLevel === "today");
  const open = onToday.filter(t => !isDeferred(t, lociDay)).sort(todayOrder);
  const moved = onToday.filter(t => isDeferred(t, lociDay)).sort(byOrder);
  const completed = live.filter(t => t.isCompleted && t.dateCompletedString === lociDay);
  const parked = parkedTasks(c.tasks).map(t => {
    const since = parkedSince(t);
    return { ...taskView(t), parkedSince: since || null, parkedDays: daysAgo(since, c.calendarToday, timeZone) };
  });
  const pinned = active.find(t => t.isNowFocus) ?? null;
  const minimumIds = confirmedMinimumDay(config, lociDay);
  const minimumDay = minimumIds
    ? minimumIds.map(id => live.find(t => String(t.uuid || t.id) === id)).filter(Boolean).map(t => ({ uuid: t.uuid, title: t.title, isCompleted: !!t.isCompleted }))
    : null;
  const dayClose = config.dayClose && config.dayClose.day === lociDay ? config.dayClose : null;

  return withTruncated({
    today: c.calendarToday,
    lociDay,
    timeZone,
    pinned: pinned && taskView(pinned),
    open: cap(open.map(taskView), "open", truncated),
    movedToTomorrow: cap(moved.map(taskView), "movedToTomorrow", truncated),
    completedToday: cap(completed.map(taskView), "completedToday", truncated),
    parked: cap(parked, "parked", truncated),
    minimumDay,
    dayClose,
    totals: {
      open: open.length,
      plannedMinutes: open.reduce((sum, t) => sum + minutesOf(t), 0),
      movedToTomorrow: moved.length,
      completedToday: completed.length,
      parked: parked.length,
    },
    note: "The running focus timer lives only in the browser; `pinned` is the task the user has pinned as the one thing. Parked tasks come from any horizon.",
  }, truncated);
}

// The Day map page: the day's windows and breaks, the route, and whether it fits.
// The route is laid out the way the page lays it out (useDayRoute): from now or the
// saved start, whichever is later, with a task that reaches a break continuing after
// it, so a task's end counts the break.
export function buildDayMap(raw, nowMs, timeZone) {
  const c = prepare(raw, nowMs, timeZone);
  const { active, lociDay, config, windows } = c;
  const open = active.filter(t => t.horizonLevel === "today" && !isDeferred(t, lociDay));

  const spans = mergeWindowSpans(windows);
  const capacityMinutes = spans.reduce((sum, [start, end]) => sum + (end - start), 0);
  const dayEnd = Math.max(...spans.map(([, end]) => end));
  const clock = formatClock24;

  // On the route when it has today's day and a place in the order (isOnRoute).
  const byRouteOrder = (a, b) => (a.dayMapOrder ?? Infinity) - (b.dayMapOrder ?? Infinity) || (a.dayMapStartMinutes ?? 0) - (b.dayMapStartMinutes ?? 0);
  const scheduled = open.filter(t => t.dayMapDate === lociDay && (t.dayMapOrder != null || !!t.dayMapPeriod)).sort(byRouteOrder);
  const onRoute = new Set(scheduled);
  const unscheduled = open.filter(t => !onRoute.has(t)).sort(todayOrder);

  // Where the route starts (routeAnchor): the saved anchor or the earliest saved start,
  // but never before now.
  const nowMin = Math.floor(getLociNowMinutes(c.wall, windows));
  const savedStarts = scheduled.filter(t => !isFixedStop(t) && t.dayMapStartMinutes != null).map(t => Number(t.dayMapStartMinutes));
  const anchor = config.dayMapDate === lociDay && config.dayMapAnchorMinutes != null
    ? Math.max(nowMin, Number(config.dayMapAnchorMinutes))
    : (savedStarts.length ? Math.max(nowMin, Math.min(...savedStarts)) : nowMin);
  const breaks = routeBreaks(windows, config, lociDay);

  const stops = new Map();
  for (const row of scheduled.length ? layoutRoute(scheduled, { from: anchor, breaks, durationOf: minutesOf }) : []) {
    if (row.kind !== "stop") continue;
    const seen = stops.get(row.task);
    if (seen) { seen.routeEnd = row.end; seen.parts.push({ start: row.start, end: row.end }); }
    else stops.set(row.task, { t: row.task, start: row.start, routeEnd: row.end, parts: [{ start: row.start, end: row.end }] });
  }
  const route = [...stops.values()];
  const plan = route.length
    ? planDay(route.map(s => ({ ...s, dayMapStartMinutes: s.start, dayMapDurationMinutes: minutesOf(s.t), routeEndMinutes: s.routeEnd })), anchor, dayLeftFrom(anchor, c.wall, windows))
    : null;
  const remainingFocusMinutes = getRemainingFocusMinutes(c.wall, windows);
  const openMinutes = open.reduce((sum, t) => sum + minutesOf(t), 0);

  return {
    today: c.calendarToday,
    lociDay,
    timeZone,
    focusWindows: spans.map(([start, end]) => ({ start: clock(start), end: clock(end), minutes: end - start })),
    breaks: breaks.map(b => ({
      start: clock(b.start), end: clock(b.end), minutes: b.end - b.start, name: b.name, addedByUser: !!b.added,
    })),
    route: route.map(s => ({
      ...taskView(s.t),
      routeStart: clock(s.start), routeEnd: clock(s.routeEnd), durationMinutes: minutesOf(s.t),
      splitByBreak: s.parts.length > 1,
      ...(s.parts.length > 1 ? { parts: s.parts.map(p => ({ start: clock(p.start), end: clock(p.end) })) } : {}),
      isFixedTime: isFixedStop(s.t), isEvent: isEventTask(s.t),
    })),
    unscheduled: unscheduled.map(taskView),
    fit: {
      openTasksMinutes: openMinutes,
      capacityMinutes,
      remainingFocusMinutes,
      exceedsRemainingFocusByMinutes: Math.max(0, openMinutes - remainingFocusMinutes),
      routeEndsAt: route.length ? clock(Math.max(...route.map(s => s.routeEnd))) : null,
      dayEndsAt: clock(dayEnd),
      routeOverrunMinutes: plan ? plan.overBy : 0,
      wontFit: plan ? plan.wontFit.map(s => ({ uuid: s.t.uuid, title: s.t.title, routeStart: clock(s.start), routeEnd: clock(s.routeEnd) })) : [],
    },
    note: "The route is laid out as the Day map would show it right now: it starts from now or the saved start, whichever is later; a task that reaches a break continues after it (see parts). Open tasks with no place in the route are in `unscheduled`. Minutes are 'loci minutes': a window running past midnight reads as 24:00 onward.",
  };
}

// The Plan page: every horizon with its tasks, and the fronts.
export function buildPlan(raw, nowMs, timeZone, { horizon = null } = {}) {
  const c = prepare(raw, nowMs, timeZone);
  const { live, active, tasks, config, lociDay, calendarToday } = c;
  const truncated = [];
  const horizons = horizonsFromConfig(config, lociDay);

  const buckets = new Map(horizons.map(h => [h.id, []]));
  const older = [];
  const other = [];
  for (const t of active) {
    if (t.horizonLevel === "today") continue;
    if (t.horizonLevel === WORK_OLDER_ID) { older.push(t); continue; }
    const id = taskHorizonId(t, horizons);
    (id ? buckets.get(id) : other).push(t);
  }
  const section = (id, name, extra, list) => ({
    id, name, ...extra,
    tasks: cap(list.sort(byPriorityThenOrder).map(taskView), `horizon:${id}`, truncated),
    taskCount: list.length,
  });
  let sections = horizons.map(h => {
    let period = null;
    let daysLeft = null;
    try { period = currentPeriod(h, lociDay); daysLeft = horizonDaysLeft(h, lociDay); } catch { /* a horizon that cannot be dated is still listed */ }
    return section(h.id, h.name, {
      kind: h.kind, hidden: !!h.hidden, builtIn: BUILT_IN_HORIZONS.some(b => b.id === h.id),
      period, daysLeft, review: config.horizonReviews?.[h.id] ?? null,
    }, buckets.get(h.id));
  });
  if (older.length) sections.push(section(WORK_OLDER_ID, "Work · older", { builtIn: true }, older));
  if (other.length) sections.push(section("other", "Other", {}, other));
  if (horizon) sections = sections.filter(s => s.id === horizon);

  const fronts = frontsFromConfig(config).map(f => {
    const daysLeft = f.dueAt ? daysBetween(calendarToday, f.dueAt) : null;
    return {
      id: f.id, name: f.name, parked: f.parked, due: f.dueAt, daysLeft, status: deadlineStatus(daysLeft),
      nextMove: f.nextMove, nextMoveShown: frontNextMove(f, tasks), progress: frontProgress(tasks, f.id),
      // Open tasks are whole under their horizon; here, which tasks belong to the front.
      tasks: cap(tasksForFront(tasks, f.id).map(t => ({ ...brief(t), isCompleted: !!t.isCompleted, isParked: !!t.isParked })), `front:${f.id}`, truncated),
    };
  }).sort((a, b) => Number(a.parked) - Number(b.parked) || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));

  const since = addDays(calendarToday, -14);
  const recentlyCompleted = live.filter(t => t.isCompleted && t.dateCompletedString && t.dateCompletedString >= since)
    .sort((a, b) => String(b.dateCompletedString).localeCompare(String(a.dateCompletedString)));
  const todayOpen = active.filter(t => t.horizonLevel === "today");

  return withTruncated({
    today: calendarToday,
    lociDay,
    timeZone,
    horizons: sections,
    ...(horizon ? {} : { fronts }),
    todaySummary: { open: todayOpen.filter(t => !isDeferred(t, lociDay)).length, movedToTomorrow: todayOpen.filter(t => isDeferred(t, lociDay)).length, see: "get_today" },
    recentlyCompleted: cap(recentlyCompleted.map(brief), "recentlyCompleted", truncated),
    note: "Open tasks only in horizons, as whole records; fronts list their tasks in brief (a front's open task is whole under its horizon). Parked tasks are in get_today. recentlyCompleted covers the last 14 days."
      + (horizon && sections.length === 0 ? ` No horizon "${horizon}". Ids: ${[...horizons.map(h => h.id), WORK_OLDER_ID].join(", ")}.` : ""),
  }, truncated);
}

// The Mind Box page: the thoughts as written, newest first.
export function buildMindBox(raw, nowMs, timeZone) {
  const c = prepare(raw, nowMs, timeZone);
  const thoughts = c.brainDump
    .filter(item => item && typeof item === "object")
    .map(item => {
      const createdAt = Number(item.createdAt) || null;
      return {
        id: item.id,
        // What the user sees: bold / underline markers resolved, line breaks kept.
        text: parseThought(thoughtText(item)).map(run => run.text).join(""),
        createdAt,
        created: localStamp(createdAt, timeZone),
        ageDays: daysAgo(createdAt, c.calendarToday, timeZone),
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return { today: c.calendarToday, timeZone, count: thoughts.length, limit: THOUGHTS_MAX, thoughts };
}

// The last days: ticks, what was completed, and the day-close records.
export function buildWeek(raw, nowMs, timeZone, args = {}, focusRaw = null) {
  const { days = 14 } = args;
  const c = prepare(raw, nowMs, timeZone);
  const count = Math.min(60, Math.max(1, Math.round(Number(days)) || 14));
  const ticks = new Map(c.contributions.filter(x => x && typeof x === "object").map(x => [x.dateString, Number(x.count) || 0]));
  const log = Array.isArray(c.config.dayCloseLog) ? c.config.dayCloseLog.filter(e => e && typeof e === "object") : [];
  const dates = [];
  for (let back = count - 1; back >= 0; back -= 1) dates.push(addDays(c.lociDay, -back));
  const truncated = [];
  const focus = focusRaw ? dailyTotals(flattenFocusEvents(focusRaw)) : null;
  const perDay = dates.map(date => ({
    date,
    ticks: ticks.get(date) || 0,
    ...(focus ? { focusMinutes: focus[date]?.minutes || 0, focusSessions: focus[date]?.moves || 0 } : {}),
    completedTasks: cap(c.live.filter(t => t.isCompleted && t.dateCompletedString === date).map(brief), `completed:${date}`, truncated),
    dayClose: log.find(e => e.day === date) ?? null,
  }));
  return withTruncated({
    today: c.calendarToday,
    lociDay: c.lociDay,
    timeZone,
    days: perDay,
    ...(args.focusUnavailable ? { focusUnavailable: true } : {}),
    totals: {
      ticks: perDay.reduce((s, d) => s + d.ticks, 0),
      completedTasks: perDay.reduce((s, d) => s + d.completedTasks.length, 0),
      ...(focus ? { focusMinutes: perDay.reduce((s, d) => s + d.focusMinutes, 0) } : {}),
    },
    note: "ticks are the app's daily completion counts. Like completedTasks and focusMinutes they are grouped by the Loci day (a day that runs past midnight counts as the day it started), and the last day is the Loci day, which is still yesterday in the small hours. Ticks recorded before this was changed may sit on the calendar day instead. dayClose is the user's Close-the-day record, when there is one."
  }, truncated);
}

// Facts that often mean a plan is stuck. Ages, not verdicts.
export function buildStuck(raw, nowMs, timeZone, { staleDays = 7, parkedDays = 7 } = {}) {
  const c = prepare(raw, nowMs, timeZone);
  const { active, lociDay } = c;
  const truncated = [];
  const open = active.filter(t => t.horizonLevel === "today" && !isDeferred(t, lociDay)).sort(todayOrder);
  const ageDays = (ms) => Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
  const withAge = (t, extra = {}) => ({ ...brief(t), ...extra });

  const overdue = datedTasks(c).filter(d => d.daysLeft < 0).map(d => withAge(d.task, { due: d.due, daysOverdue: -d.daysLeft, ...(d.viaFront ? { viaFront: d.viaFront } : {}) }));
  const parked = parkedTasks(c.tasks).map(t => withAge(t, { parkedDays: validMs(parkedSince(t)) ? ageDays(parkedSince(t)) : null })).filter(t => t.parkedDays === null || t.parkedDays >= parkedDays);
  const untouched = active
    .filter(t => (t.horizonLevel === "today" && !isDeferred(t, lociDay)) || t.horizonLevel === "week")
    .filter(t => Number(t.lastUpdated) > 0 && ageDays(Number(t.lastUpdated)) >= staleDays)
    .map(t => withAge(t, { daysSinceEdited: ageDays(Number(t.lastUpdated)) }))
    .sort((a, b) => b.daysSinceEdited - a.daysSinceEdited);
  // The app's own rule (taskSteps): the placeholder "Do first tiny step" is not a step.
  const noNextStep = open.filter(t => !taskSteps(t).some(step => !step.done)).map(t => withAge(t));
  const noEstimate = open.filter(t => !(Number(t.timeEstimateMinutes) > 0)).map(t => withAge(t));

  return withTruncated({
    today: c.calendarToday,
    lociDay,
    timeZone,
    thresholds: { staleDays, parkedDays },
    overdue: cap(overdue, "overdue", truncated),
    parked: cap(parked, "parked", truncated),
    untouched: cap(untouched, "untouched", truncated),
    noNextStep: cap(noNextStep, "noNextStep", truncated),
    noEstimate: cap(noEstimate, "noEstimate", truncated),
    note: "overdue: open tasks past their own or their front's date. parked: set aside for at least parkedDays. untouched: Today or This-week tasks not edited for staleDays. noNextStep / noEstimate: open Today tasks with no step still to do, or no time estimate. The app does not record how often a task was moved to tomorrow.",
  }, truncated);
}

// Settings that shape a plan. Names, notes, anchors and display options are not here.
const SETTINGS_KEYS = [
  "dayStartHour", "dayEndHour", "focusWindows", "challengeType", "pomodoroDurationMinutes", "reminderNagIntervalMinutes",
  "eveningGuardWindowActive", "goalDaysMode", "breakName", "deadlineLabel", "deadlineDate", "deadlineAction", "deadlineStartDate",
];
export function buildSettings(raw, nowMs, timeZone) {
  const c = prepare(raw, nowMs, timeZone);
  const settings = {};
  for (const key of SETTINGS_KEYS) if (c.config[key] !== undefined) settings[key] = c.config[key];
  return {
    timeZone,
    settings,
    effectiveFocusWindows: mergeWindowSpans(c.windows).map(([start, end]) => ({ start: formatClock24(start), end: formatClock24(end), minutes: end - start })),
    note: "Only settings that shape a plan are shown; names, notes, anchors and display options are never returned.",
  };
}

// The focus log: every session in the last days, joined back to its task.
export function buildFocusHistory(raw, nowMs, timeZone, { days = 14 } = {}, focusRaw = null) {
  const c = prepare(raw, nowMs, timeZone);
  const count = Math.min(60, Math.max(1, Math.round(Number(days)) || 14));
  const window = lociDayWindow(count, c.wall, c.windows);
  const inWindow = new Set(window);
  const events = flattenFocusEvents(focusRaw).filter(e => inWindow.has(e.lociDateString));
  const totals = dailyTotals(events);
  const taskOf = new Map(c.live.map(t => [t.uuid, t])); // deleted tasks are not named
  const fronts = new Map(frontsFromConfig(c.config).map(f => [f.id, f.name]));
  const frontName = (id) => (!id ? "no front" : fronts.get(id) || "a front the user closed");
  const truncated = [];

  const session = (e) => {
    const task = taskOf.get(e.taskId);
    const snapFront = e.taskSnapshot?.frontId;
    const frontId = typeof snapFront === "string" ? (snapFront || null) : (task?.frontId ?? null);
    const planned = Number(e.focusFinalPlannedSeconds || e.focusInitialPlannedSeconds);
    return {
      // The app's own labels: done, ended (stopped by the user) or expired (timed out). Older events have no stored label.
      outcome: e.focusOutcome || (e.type === "focus_completed" ? "done" : "ended"),
      minutes: eventMinutes(e),
      startedAt: localStamp(Number(e.focusStartedAt), timeZone),
      plannedMinutes: Number.isFinite(planned) && planned > 0 ? Math.round(planned / 60) : null,
      endReason: e.focusEndReason ?? null,
      taskId: e.taskId ?? null,
      taskTitle: task?.title ?? null,
      category: e.taskSnapshot?.category ?? task?.category ?? null,
      priority: e.taskSnapshot?.priority ?? task?.priority ?? null,
      front: frontName(frontId),
    };
  };
  const perDay = window.map(date => ({
    date,
    minutes: totals[date]?.minutes || 0,
    sessions: cap(events.filter(e => e.lociDateString === date).sort((a, b) => (Number(a.focusStartedAt) || 0) - (Number(b.focusStartedAt) || 0)).map(session), `sessions:${date}`, truncated),
  }));
  return withTruncated({
    today: c.calendarToday,
    lociDay: c.lociDay,
    timeZone,
    days: perDay,
    totals: {
      minutes: perDay.reduce((s, d) => s + d.minutes, 0),
      sessions: events.filter(e => eventMinutes(e) > 0).length,
      daysWithFocus: perDay.filter(d => d.minutes > 0).length,
      byFront: [...minutesByFront(events, c.tasks).entries()].map(([id, minutes]) => ({ front: frontName(id), minutes })).sort((a, b) => b.minutes - a.minutes),
    },
    note: "Days are Loci days. outcome: done = finished, ended = stopped by the user, expired = timed out (paused too long or the day ended). A session under a minute counts as zero; ended and expired sessions still count their minutes. taskTitle is null if the task has since been deleted.",
  }, truncated);
}

// Coach -> Review: the app's own facts for today, 7 days or 30 days.
export function buildCoachReview(raw, nowMs, timeZone, { period = "7d" } = {}, focusRaw = null) {
  const c = prepare(raw, nowMs, timeZone);
  const key = REVIEW_PERIODS.some(p => p.key === period) ? period : "7d";
  const fronts = frontsFromConfig(c.config);
  const frontNameOf = (id) => (!id ? "work on no front" : fronts.find(f => f.id === id)?.name || "a front you've closed");
  const facts = reviewFacts({
    tasks: c.tasks, contributions: c.contributions, config: c.config, focusRaw: focusRaw || {},
    period: key, now: c.wall, windows: c.windows, frontNameOf,
  });
  return {
    today: c.calendarToday,
    lociDay: c.lociDay,
    timeZone,
    ...facts,
    note: "Computed with the same code as the Coach > Review page. `days` pairs focus minutes with ticks; openNow.over says whether today's planned minutes exceed the focus time left.",
  };
}

const BRIEF_KEYS = ["at", "howItWent", "patterns", "tooMuch", "estimates", "next"];

// Coach -> the latest saved Brief (the AI-written summary the user asked for).
export function buildCoachBrief(raw, nowMs, timeZone) {
  const c = prepare(raw, nowMs, timeZone);
  const brief = c.config.coachBrief && typeof c.config.coachBrief === "object" ? c.config.coachBrief : null;
  if (!brief) return { today: c.calendarToday, brief: null, note: "No Brief is saved. The user makes one with 'Brief me' in the Coach tab; only the latest is kept." };
  // Only the keys the Coach saves are passed on, so a field added later is not sent by accident.
  const known = Object.fromEntries(BRIEF_KEYS.filter(k => brief[k] !== undefined).map(k => [k, brief[k]]));
  let text = null;
  try { text = briefToText(known); } catch { /* a damaged brief still returns what was saved */ }
  return {
    today: c.calendarToday,
    savedAt: localStamp(Number(brief.at), timeZone),
    ageDays: daysAgo(Number(brief.at), c.calendarToday, timeZone),
    text,
    brief: known,
    note: "Written by the Coach from the user's data when they asked for it, so it can be out of date; tasks named in it may have changed since.",
  };
}
