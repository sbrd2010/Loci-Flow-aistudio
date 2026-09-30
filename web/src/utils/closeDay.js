// Close the day (55d–e, Q47). One screen, under a minute: what got done, and
// each task left on Today → Tomorrow (default) · Plan (This week) · Drop.
// A task a horizon review sent to Today, left over again, defaults to Plan:
// back to its horizon (47.1). "First thing tomorrow?" becomes tomorrow's one
// thing. An optional line about the day (47.2) goes where the evening
// reflection's note went, so Coach keeps reading it.
//
// config.dayClose = { day, at, firstThing, reopened }   — today's close
// config.dayCloseLog = [{ day, done, focusMin, tomorrow, planned, dropped,
//                         minimum, note, firstThing, at }]  — for Coach (30)
import { isOnToday } from "./deferral";
import { moveToTomorrow, nextDateStr } from "./dayMapPlan";
import { makeOneThing } from "./oneThing";
import { horizonsFromConfig } from "./horizons";
import { buildReflectionSave } from "./dailyCoachCheckins";
import { isEventTask } from "./dayMapRoute";
import { endLeftReviewMarks } from "./normalizePayload";

export const CLOSE_LOG_DAYS = 30;
const key = (t) => String(t?.uuid || t?.id || "");
const open = (t) => !t.isDeleted && !t.isCompleted && !t.isParked;

// What's left on Today: open, on Today now (not already moved to a later day).
export function leftovers(tasks = [], day) {
  return tasks
    .filter(t => open(t) && isOnToday(t, day))
    .sort((a, b) => (Number(b.isNowFocus) - Number(a.isNowFocus)) || ((a.orderIndex ?? 0) - (b.orderIndex ?? 0)));
}

// 47.1: Tomorrow — unless a review sent it here and it's left over again.
export const defaultChoice = (task) => (task.reviewFrom ? "plan" : "tomorrow");

// Where Plan sends it: back to the horizon its review came from if that's
// still shown, else This week (55 answer 11).
export function planTarget(task, config, day) {
  const shown = horizonsFromConfig(config, day).filter(h => !h.hidden).map(h => h.id);
  const from = task.reviewFrom?.horizon;
  if (from && shown.includes(from)) return from;
  return shown.includes("week") ? "week" : shown[0] || "week";
}

// "Done today · N": finished today.
export const doneTodayCount = (tasks = [], day) =>
  tasks.filter(t => t.isCompleted && !t.isDeleted && t.dateCompletedString === day).length;

export const isDayClosed = (config = {}, day) => config.dayClose?.day === day && !config.dayClose?.reopened;

// "Day ends 17:30 · Close the day": from 30 minutes before the last focus
// window ends (55 answer 10). `nowMin` and the end are minutes of the day
// (an overnight end past 1440).
// Q48.2: before the day's start time there is nothing to close yet, so the
// Day map's button is hidden. Minutes are the Loci day's: an overnight
// window's early hours still count as the day before, so it stays.
export const closeDayOffered = (nowMin, dayStartMin) =>
  !Number.isFinite(nowMin) || !Number.isFinite(dayStartMin) || nowMin >= dayStartMin;

export function closeLineDue(nowMin, dayEndMin, alreadyClosed) {
  if (alreadyClosed || !Number.isFinite(nowMin) || !Number.isFinite(dayEndMin)) return false;
  return nowMin >= dayEndMin - 30;
}

// Close: every leftover to its place, the first thing noted for tomorrow,
// the day logged for Coach. `summary` carries what the screen knows that the
// tasks don't (focus minutes, the minimum day).
export function applyClose(payload, { day, choices = {}, firstThing = null, note = "", summary = {} }, now = Date.now()) {
  const { config = {} } = payload;
  let tasks = payload.tasks || [];
  const left = leftovers(tasks, day);
  const pick = (t) => choices[key(t)] || defaultChoice(t);
  const toTomorrow = left.filter(t => pick(t) === "tomorrow").map(key);
  const counts = { tomorrow: toTomorrow.length, planned: 0, dropped: 0 };
  // Tomorrow's first thing heads tomorrow's list.
  const ordered = firstThing && toTomorrow.includes(firstThing) ? [firstThing, ...toTomorrow.filter(id => id !== firstThing)] : toTomorrow;
  if (ordered.length) tasks = moveToTomorrow(tasks, ordered, nextDateStr(day), now).tasks;
  const bottom = {};
  const nextOrder = (h) => {
    if (bottom[h] == null) bottom[h] = tasks.filter(t => t.horizonLevel === h && open(t)).length;
    return bottom[h]++;
  };
  const plans = new Map(left.filter(t => pick(t) === "plan").map(t => [key(t), planTarget(t, config, day)]));
  const drops = new Set(left.filter(t => pick(t) === "drop").map(key));
  tasks = tasks.map(t => {
    const id = key(t);
    if (plans.has(id)) {
      counts.planned++;
      const { dayMapDate, dayMapPeriod, dayMapStartMinutes, dayMapDurationMinutes, dayMapOrder, dayMapFixedMinutes, ...rest } = t; // eslint-disable-line no-unused-vars
      return { ...rest, horizonLevel: plans.get(id), orderIndex: nextOrder(plans.get(id)), isNowFocus: false, deferredUntil: null, lastUpdated: now };
    }
    if (drops.has(id)) { counts.dropped++; return { ...t, isDeleted: true, deletedAt: now, isNowFocus: false, lastUpdated: now }; }
    return t;
  });
  const clean = String(note || "").trim().slice(0, 280);
  const firstTitle = firstThing ? (payload.tasks || []).find(t => key(t) === firstThing)?.title || null : null;
  const entry = { day, done: doneTodayCount(payload.tasks, day), ...counts, focusMin: summary.focusMin ?? null, minimum: summary.minimum ?? null, note: clean, firstThing: firstTitle, at: now };
  const log = [...(Array.isArray(config.dayCloseLog) ? config.dayCloseLog : []).filter(e => e?.day !== day), entry].slice(-CLOSE_LOG_DAYS);
  let nextConfig = { ...config, dayClose: { day, at: now, firstThing: firstThing || null, reopened: false }, dayCloseLog: log, lastUpdated: now };
  // 47.2: the line takes the evening reflection's place, with no mood.
  // Closing counts as reflecting even with no line, so the evening nudge stops;
  // an earlier same-day reflection is kept when no line is written.
  const same = config.dailyReflectionDate === day;
  nextConfig = buildReflectionSave(nextConfig, clean ? { mood: null, note: clean } : { mood: same ? config.dailyReflectionMood : null, note: same ? config.dailyReflectionNote || "" : "" }, day, now);
  // The marks of reviews end here, not only when saved, so Undo (which puts
  // back what the close changed) brings them back too (Q48.1).
  return { ...payload, tasks: endLeftReviewMarks(tasks), config: nextConfig };
}

const REFLECTION_KEYS = ["dailyReflectionDate", "dailyReflectionMood", "dailyReflectionNote", "dailyReflectionCompletedAt", "dailyReflectionSnoozeUntil"];

// Undo within 10 s: the tasks, the reflection and the day as they were.
// `day` is the day that was closed. Given `after` (the payload the close
// saved), only what the close changed goes back, and only where nothing has
// changed it since (say, on another device): a rename made meanwhile stays.
export function undoClose(payload, before, day, after = null) {
  const was = new Map(leftovers(before.tasks || [], day).map(t => [key(t), t]));
  const closed = after ? new Map((after.tasks || []).map(t => [key(t), t])) : null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // A task made the one thing since the close keeps it; the old pin isn't restored.
  const pinnedSince = (payload.tasks || []).some(t => t.isNowFocus && open(t)
    && (!was.has(key(t)) || (closed && !same(t.isNowFocus, closed.get(key(t))?.isNowFocus))));
  const restore = (t) => {
    const old = was.get(key(t));
    const mid = closed?.get(key(t));
    if (!mid) return { ...old, ...(old.isNowFocus && pinnedSince ? { isNowFocus: false } : {}), lastUpdated: Date.now() };
    const out = { ...t };
    for (const k of new Set([...Object.keys(old), ...Object.keys(mid)])) {
      if (k === "lastUpdated" || same(old[k], mid[k]) || !same(t[k], mid[k])) continue;
      if (k === "isNowFocus" && old[k] && pinnedSince) continue;
      if (old[k] === undefined) delete out[k]; else out[k] = old[k];
    }
    return { ...out, lastUpdated: Date.now() };
  };
  return {
    ...payload,
    config: { ...payload.config, ...Object.fromEntries(REFLECTION_KEYS.map(k => [k, before.config?.[k] ?? null])), dayClose: before.config?.dayClose ?? null, dayCloseLog: before.config?.dayCloseLog ?? [] },
    tasks: (payload.tasks || []).map(t => (was.has(key(t)) ? restore(t) : t)),
  };
}

// 47.3 Reopen: the day is open again; what was moved stays moved.
export const reopenDay = (config = {}, now = Date.now()) =>
  ({ ...config, dayClose: { ...(config.dayClose || {}), reopened: true }, lastUpdated: now });

// The next day: the first thing noted at close becomes the one thing, once,
// if it's still open and nothing else was made the one thing first.
export function pinFirstThing(payload, day, now = Date.now()) {
  const c = payload.config?.dayClose;
  if (!c?.firstThing || !c.day || c.day >= day || c.pinnedOn) return null;
  const tasks = payload.tasks || [];
  const t = tasks.find(x => key(x) === c.firstThing);
  const mark = { ...payload.config, dayClose: { ...c, pinnedOn: day }, lastUpdated: now };
  const taken = tasks.some(x => x.isNowFocus && open(x) && key(x) !== c.firstThing);
  if (!t || !open(t) || !isOnToday(t, day) || taken || isEventTask(t)) return { ...payload, config: mark };
  return { ...payload, tasks: makeOneThing(tasks, c.firstThing, now).tasks, config: mark };
}
