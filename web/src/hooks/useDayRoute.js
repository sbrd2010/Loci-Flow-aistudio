import { useEffect, useMemo, useRef } from "react";
import { isFixedStop, layoutRoute, layoutStarts, shouldReflowPastRoute } from "../utils/dayMapRoute";
import { routeBreaks, withAddedBreaks } from "../utils/dayMapBreaks";
import { dayLeftFrom, nextDateStr, planDay, restoreSchedule } from "../utils/dayMapPlan";
import { getFocusWindows, getLociNowMinutes } from "../utils/focusWindows";
import { isDeferred } from "../utils/deferral";
import { commitmentKickerFront, frontForCommitment, frontsFromConfig } from "../utils/fronts";
import { useLociDayStr } from "./useTodayStr";

// Today's route, as the Day map page (50e–f) and Today's Day map column
// (50k–l) both read it: which tasks are on it, from when, and where the day
// ends along it. Only one of the two is ever mounted, so the route's times
// are kept current (the reflow below) by whichever is on screen.

export const DURATION_OPTIONS = [15, 25, 45, 60, 90, 120, 180, 240, 360];
export const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
export const PERIOD_LABELS = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

export function getTaskId(task) { return String(task.uuid || task.id); }
export function normalizePriority(p) { return String(p || "P3").toUpperCase(); }
export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// "Now" on the Loci day's clock: past midnight in a window that runs on (to
// 02:00, say), 00:30 is 1470, not 30 — the same scale as the route's times.
export function currentDayMinutes(windows) {
  return Math.floor(getLociNowMinutes(new Date(), windows));
}

export function getPeriodForMinutes(m) {
  const n = ((m % 1440) + 1440) % 1440;
  if (n < 360) return "night";
  if (n < 720) return "morning";
  if (n < 1020) return "afternoon";
  if (n < 1260) return "evening";
  return "night";
}

export function getEstimate(task) {
  const raw = Number(task.dayMapDurationMinutes || task.timeEstimateMinutes || task.estimateMinutes || 25);
  return clamp(Number.isFinite(raw) ? raw : 25, 10, 360);
}

export function sortByPriorityAndOrder(a, b) {
  const pa = PRIORITY_RANK[normalizePriority(a.priority)] || 3;
  const pb = PRIORITY_RANK[normalizePriority(b.priority)] || 3;
  return pa !== pb ? pa - pb : (a.orderIndex ?? 9999) - (b.orderIndex ?? 9999);
}

export function removeScheduleFields(task) {
  const { dayMapDate, dayMapPeriod, dayMapStartMinutes, dayMapDurationMinutes, dayMapOrder, dayMapFixedMinutes, ...rest } = task; // eslint-disable-line no-unused-vars
  return { ...rest, lastUpdated: Date.now() };
}

// Times the route from its start (utils/dayMapRoute: fixed stops, breaks,
// buffers) and stores each stop's start; the order stays the user's. Period
// is derived from the start time, never stored alone.
export function reflowRoute(orderedTasks, anchorMinutes, todayStr, breaks = []) {
  const starts = layoutStarts(layoutRoute(orderedTasks, { from: anchorMinutes, breaks, durationOf: getEstimate }));
  return orderedTasks.map((task, index) => {
    const duration = getEstimate(task);
    const start = starts.get(task);
    return {
      ...task,
      dayMapStartMinutes: start,
      dayMapDurationMinutes: duration,
      dayMapPeriod: getPeriodForMinutes(start),
      dayMapOrder: index,
      dayMapDate: todayStr,
      lastUpdated: Date.now(),
    };
  });
}

// Each stop starts where the engine puts it, counting from where the route's
// first flowing stop starts. A write from anywhere — Done on Today, the full
// editor, another device — can leave a gap or an overlap; this is how the
// Day map sees it. Untimed stops are the timing effect's to place, so they
// don't count here.
export function routeIsContiguous(route, breaks = []) {
  if (route.some(t => t.dayMapStartMinutes == null)) return true;
  const flowing = route.filter(t => !isFixedStop(t));
  if (!flowing.length) return route.every(t => Number(t.dayMapStartMinutes) === Number(t.dayMapFixedMinutes));
  const from = Math.min(...flowing.map(t => Number(t.dayMapStartMinutes)));
  const starts = layoutStarts(layoutRoute(route, { from, breaks, durationOf: getEstimate }));
  return route.every(t => starts.get(t) === Number(t.dayMapStartMinutes));
}

export function applyReflow(allTasks, reflowed) {
  const map = new Map(reflowed.map(t => [getTaskId(t), t]));
  return allTasks.map(t => map.has(getTaskId(t)) ? map.get(getTaskId(t)) : t);
}

// On today's route: a Today task laid out for this Loci day (old-format tasks
// with a period but no order included).
export function isOnRoute(task, todayStr) {
  return task.horizonLevel === "today" && !task.isDeleted && !task.isCompleted && !task.isParked
    && task.dayMapDate === todayStr && !isDeferred(task, todayStr) && (task.dayMapOrder != null || !!task.dayMapPeriod);
}

function byRouteOrder(a, b) {
  const oa = a.dayMapOrder ?? Infinity;
  const ob = b.dayMapOrder ?? Infinity;
  if (oa !== ob) return oa - ob;
  return (a.dayMapStartMinutes ?? 0) - (b.dayMapStartMinutes ?? 0);
}

// Undo of a route change (Clear route, a one thing moved to NOW): the stops
// come back first, in their old order, then anything added since; and the
// whole route is timed again, so no two stops share an order or a start and
// none is left with a stale time (as the Day map page's Undo; Codex reviews
// of #427).
export function restoreRoute(allTasks, before, { todayStr, anchorMinutes, breaks = [] }) {
  const restored = restoreSchedule(allTasks, before);
  const put = new Set(before.map(getTaskId));
  const onRoute = restored.filter(t => isOnRoute(t, todayStr));
  const route = [
    ...onRoute.filter(t => put.has(getTaskId(t))).sort(byRouteOrder),
    ...onRoute.filter(t => !put.has(getTaskId(t))).sort(byRouteOrder),
  ];
  return applyReflow(restored, reflowRoute(route, anchorMinutes, todayStr, breaks));
}

// The one thing sits at NOW (53–56): made the one thing, a task heads the
// route from now and everything after it flows on from its end. Fixed stops
// keep their times, and a fixed one thing stays where it is. The route never
// builds itself, so with no route nothing moves. Returns null when nothing
// moves, else the new list and the ids of the stops it retimed.
export function oneThingToNow(allTasks, uuid, { todayStr, nowMinutes, breaks = [] }) {
  const target = allTasks.find(t => getTaskId(t) === uuid);
  if (!target || target.horizonLevel !== "today" || isFixedStop(target)) return null;
  const route = allTasks.filter(t => isOnRoute(t, todayStr)).sort(byRouteOrder);
  if (!route.length) return null;
  const ordered = [target, ...route.filter(t => getTaskId(t) !== uuid)];
  const tasks = applyReflow(allTasks, reflowRoute(ordered, nowMinutes, todayStr, breaks));
  return { tasks, ids: ordered.map(getTaskId) };
}

export function useDayRoute({ payload, savePayload }) {
  const tasks = payload?.tasks || [];
  const config = payload?.config || {};
  // The Loci day, not the calendar date: with a window past midnight, the
  // route and "tomorrow" both hold until that window ends.
  const windows = getFocusWindows(config);
  const todayStr = useLociDayStr(windows);
  // The gaps between focus windows, and the breaks you added today (Q31).
  const breaks = useMemo(() => routeBreaks(windows, config, todayStr), [windows, config.breakName, config.dayMapBreaks, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps
  const tomorrowStr = nextDateStr(todayStr);

  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const staleRouteReflowKeyRef = useRef(null);

  const activeTodayTasks = useMemo(() => (
    tasks
      .filter(t => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted && !t.isParked)
      .sort(sortByPriorityAndOrder)
  ), [tasks]);

  // Include old-format tasks (dayMapPeriod set but no dayMapOrder) for backward compat
  const scheduledTasks = useMemo(() => (
    activeTodayTasks.filter(t => isOnRoute(t, todayStr)).sort(byRouteOrder)
  ), [activeTodayTasks, todayStr]);

  // Moved to tomorrow (deferral.js): not today's, but counted on the end line.
  const tomorrowTasks = useMemo(() => activeTodayTasks.filter(t => isDeferred(t, todayStr)), [activeTodayTasks, todayStr]);

  const unscheduledTasks = useMemo(() => (
    activeTodayTasks.filter(t => !isDeferred(t, todayStr) && (t.dayMapDate !== todayStr || (t.dayMapOrder == null && !t.dayMapPeriod)))
  ), [activeTodayTasks, todayStr]);

  // Start: config-persisted → inferred from the first stop → now. Clamped to
  // now so a stored past value never produces a past start time.
  const anchorMinutes = useMemo(() => {
    const now = currentDayMinutes(windows);
    if (config.dayMapDate === todayStr && config.dayMapAnchorMinutes != null) {
      return Math.max(now, Number(config.dayMapAnchorMinutes));
    }
    // The earliest stop that flows: a fixed one keeps its own time, and a
    // pulled-forward one can start before the first in the route's order.
    const starts = scheduledTasks.filter(t => !isFixedStop(t) && t.dayMapStartMinutes != null).map(t => Number(t.dayMapStartMinutes));
    if (starts.length > 0) return Math.max(now, Math.min(...starts));
    return now;
  }, [config.dayMapDate, config.dayMapAnchorMinutes, scheduledTasks, todayStr, windows]);

  // The route as laid out: its rows (stops, breaks, free time) in time order,
  // and its stops in that order, each with where it starts and ends (a task
  // split by a break ends after it).
  const { rows, routeTasks } = useMemo(() => {
    const laid = layoutRoute(scheduledTasks, {
      from: anchorMinutes, breaks, now: currentDayMinutes(windows), durationOf: getEstimate,
    });
    const byTask = new Map();
    for (const r of laid) {
      if (r.kind !== "stop") continue;
      const seen = byTask.get(r.task);
      byTask.set(r.task, seen ? { ...seen, routeEndMinutes: r.end } : { ...r.task, dayMapStartMinutes: r.start, dayMapDurationMinutes: getEstimate(r.task), routeEndMinutes: r.end });
    }
    return { rows: laid, routeTasks: [...byTask.values()] };
  }, [scheduledTasks, anchorMinutes, breaks, windows]);

  const plan = useMemo(() => (
    planDay(routeTasks, anchorMinutes, dayLeftFrom(anchorMinutes, new Date(), windows))
  ), [routeTasks, anchorMinutes, windows]);

  // The same GOAL rule as Today's rows: the front the wall's kicker names.
  const goalFront = commitmentKickerFront(frontForCommitment(tasks.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted), frontsFromConfig(config)), config);
  const isGoal = (task) => !!goalFront && task.frontId === goalFront.id;

  const sortableIds = routeTasks.map(getTaskId);
  const latestTasks = () => payloadRef.current?.tasks || [];

  // Reflow ordered tasks from the start and save everything in one write.
  const applyAndSave = (orderedScheduled, anchor, configPatch = null) => {
    const reflowed = reflowRoute(orderedScheduled, anchor, todayStr, breaks);
    const p = payloadRef.current;
    const update = { ...p, tasks: applyReflow(latestTasks(), reflowed), timestamp: Date.now() };
    if (configPatch) {
      update.config = { ...(p?.config || {}), ...configPatch, lastUpdated: Date.now() };
    }
    savePayload(update);
  };

  // The route controls (52d–e), shared by the Day map page and Today's
  // column: From, adding a task to the end, Auto-fill and Clear route.
  const setAnchor = (minutes) => {
    applyAndSave(scheduledTasks, minutes, { dayMapDate: todayStr, dayMapAnchorMinutes: minutes });
  };

  const addToRoute = (taskId) => {
    const task = latestTasks().find(t => getTaskId(t) === taskId);
    if (!task) return;
    applyAndSave([...scheduledTasks, task], anchorMinutes);
  };

  // 52d: Auto-fill fills from Today's list order — what moved from
  // yesterday first, then the list as it stands.
  const autoFill = () => {
    if (!unscheduledTasks.length) return;
    const fromYesterday = (t) => t.deferredUntil === todayStr;
    const inListOrder = [...unscheduledTasks].sort((a, b) => (fromYesterday(b) - fromYesterday(a)) || ((a.orderIndex ?? 0) - (b.orderIndex ?? 0)));
    applyAndSave([...scheduledTasks, ...inListOrder], anchorMinutes);
  };

  // 52: Clear route has Undo, no confirm. Returns the stops as they were, for
  // that Undo, or null when there was no route.
  const clearRoute = () => {
    const before = latestTasks().filter(t => t.dayMapDate === todayStr);
    if (!before.length) return null;
    savePayload({
      ...payloadRef.current,
      tasks: latestTasks().map(t => t.dayMapDate === todayStr ? removeScheduleFields(t) : t),
      timestamp: Date.now(),
    });
    return before;
  };

  // Q31: today's added breaks set to `items` ({ start, lengthMin }), and the
  // route timed again around them, in one write.
  const setAddedBreaks = (items) => {
    const p = payloadRef.current;
    const nextConfig = withAddedBreaks(p?.config || {}, todayStr, items);
    const reflowed = reflowRoute(scheduledTasks, anchorMinutes, todayStr, routeBreaks(windows, nextConfig, todayStr));
    savePayload({ ...p, tasks: applyReflow(latestTasks(), reflowed), config: nextConfig, timestamp: Date.now() });
  };

  useEffect(() => {
    // Tasks moved here from yesterday ("Move N to tomorrow") arrive at the top
    // with no start time; they are timed from this route's start like the rest.
    const needsTimes = scheduledTasks.some(t => t.dayMapStartMinutes == null);
    if (!needsTimes && !shouldReflowPastRoute(scheduledTasks, anchorMinutes)) return;
    const key = `${todayStr}:${anchorMinutes}:${scheduledTasks.map(t => `${getTaskId(t)}:${t.dayMapStartMinutes}`).join("|")}`;
    if (staleRouteReflowKeyRef.current === key) return;
    staleRouteReflowKeyRef.current = key;
    applyAndSave(scheduledTasks, anchorMinutes, { dayMapDate: todayStr, dayMapAnchorMinutes: anchorMinutes });
  }, [scheduledTasks, anchorMinutes, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    tasks, config, windows, breaks, todayStr, tomorrowStr, payloadRef,
    activeTodayTasks, scheduledTasks, tomorrowTasks, unscheduledTasks,
    anchorMinutes, rows, routeTasks, plan, isGoal, sortableIds, latestTasks, applyAndSave,
    setAnchor, addToRoute, autoFill, clearRoute, setAddedBreaks,
  };
}
