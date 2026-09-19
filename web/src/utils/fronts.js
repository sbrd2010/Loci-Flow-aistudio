// Fronts — the redesign's organising unit: a named piece of work with its own
// deadline and its own single next move.
//
// The app stores work by time horizon (today/week/month/quarter/halfyear) and
// has exactly one deadline, held in config as deadlineLabel/deadlineDate. The
// redesign assumes many fronts, each with a deadline. Rather than migrate, this
// module adds fronts alongside what exists:
//
//   - Fronts live at `config.fronts`. The Firebase rules reject unknown keys at
//     the payload root ("$other": { ".validate": false }) but allow anything
//     under config, so this needs no rules change and no deploy coordination.
//   - A task joins a front through an optional `frontId`. Tasks under `tasks`
//     also allow unknown keys, so that needs no rules change either.
//   - A task with no `frontId` stays exactly as it is today. Nothing is
//     migrated, nothing is deleted, and Roadmap's horizons keep working.
//
// The existing single deadline is PROJECTED into a front at read time rather
// than written into one. A projection can't corrupt anything and needs no
// migration step: a user who never touches the new screens keeps a config that
// older clients still understand.

import { getLocalDateString } from "./deadlineCountdown";

// Fronts are stored inside config, whose strings the rules cap. Long values are
// clamped here so one overlong name can't make an entire payload save fail.
export const FRONT_NAME_MAX = 100;
export const FRONT_NEXT_MOVE_MAX = 300;
export const FRONT_LIMIT = 24;

// Stable id for the front projected from the legacy single deadline, so a task
// can reference it and keep that reference once the user edits the front.
export const LEGACY_DEADLINE_FRONT_ID = "front-key-deadline";

function cleanString(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

// "YYYY-MM-DD" parsed at LOCAL midnight. `new Date("2026-11-04")` parses as UTC,
// which lands on the previous day for anyone west of Greenwich and would show a
// front as one day less urgent than it is.
export function parseDueDate(dueAt) {
  if (typeof dueAt !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueAt.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeFront(raw, index = 0) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const name = cleanString(raw.name, FRONT_NAME_MAX);
  if (!name) return null; // a front with no name is not a front
  const id = cleanString(raw.id, 120) || `front-${index}`;
  const dueAt = parseDueDate(raw.dueAt) ? raw.dueAt.trim() : null;
  return {
    id,
    name,
    nextMove: cleanString(raw.nextMove, FRONT_NEXT_MOVE_MAX) || null,
    dueAt,
    parked: raw.parked === true,
  };
}

export function normalizeFronts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < value.length && out.length < FRONT_LIMIT; i += 1) {
    const front = normalizeFront(value[i], i);
    if (!front || seen.has(front.id)) continue;
    seen.add(front.id);
    out.push(front);
  }
  return out;
}

// The legacy single deadline, seen as a front. Returns null when the user never
// set one. This is read-only: it never writes back to config.
export function legacyDeadlineAsFront(config = {}) {
  const name = cleanString(config.deadlineLabel, FRONT_NAME_MAX);
  if (!name) return null;
  const dueAt = parseDueDate(config.deadlineDate) ? config.deadlineDate.trim() : null;
  return {
    id: LEGACY_DEADLINE_FRONT_ID,
    name,
    nextMove: cleanString(config.deadlineAction, FRONT_NEXT_MOVE_MAX) || null,
    dueAt,
    parked: false,
  };
}

// Every front the UI should show: the stored ones, plus the legacy deadline
// projected in when the user has one and hasn't already made a front for it.
export function frontsFromConfig(config = {}) {
  const stored = normalizeFronts(config?.fronts);
  if (stored.some(f => f.id === LEGACY_DEADLINE_FRONT_ID)) return stored;
  const legacy = legacyDeadlineAsFront(config);
  return legacy ? [legacy, ...stored] : stored;
}

export function makeFront({ name, dueAt = null, nextMove = null } = {}, now = Date.now()) {
  return normalizeFront({
    id: `front-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    dueAt,
    nextMove,
    parked: false,
  });
}

// Whole days from today to the front's due date, in local time. 0 means today,
// negative means overdue, null means the front has no deadline.
export function frontDaysLeft(front, now = new Date()) {
  const due = parseDueDate(front?.dueAt);
  if (!due) return null;
  const today = parseDueDate(getLocalDateString(now));
  if (!today) return null;
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function isLiveTask(task) {
  return task && !task.isDeleted;
}

export function tasksForFront(tasks, frontId) {
  if (!Array.isArray(tasks) || !frontId) return [];
  return tasks.filter(t => isLiveTask(t) && t.frontId === frontId);
}

// Tasks that belong to no front — the state every existing task is in.
export function unassignedTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter(t => isLiveTask(t) && !t.frontId);
}

// The "5/8" on a front's progress track.
export function frontProgress(tasks, frontId) {
  const mine = tasksForFront(tasks, frontId);
  return { done: mine.filter(t => t.isCompleted).length, total: mine.length };
}

// A front's single next move: its explicit nextMove, else the first incomplete,
// unparked task on it. The design shows exactly one per front.
export function frontNextMove(front, tasks) {
  if (front?.nextMove) return front.nextMove;
  const next = tasksForFront(tasks, front?.id)
    .filter(t => !t.isCompleted && !t.isParked)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))[0];
  return next?.title || null;
}

// Nearest deadline first; undated fronts after dated ones; parked fronts last.
// The design gives the top front larger type, so this ordering decides which
// one reads as dominant.
export function sortFronts(fronts, now = new Date()) {
  return [...(fronts || [])].sort((a, b) => {
    if (a.parked !== b.parked) return a.parked ? 1 : -1;
    const da = frontDaysLeft(a, now);
    const db = frontDaysLeft(b, now);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

// A front is "waiting on someone" when every open task on it is. The schema has
// no such field today, so this reads an optional `waitingOn` string on a task
// and reports nothing rather than guessing when none is set.
export function frontIsWaiting(tasks, frontId) {
  const open = tasksForFront(tasks, frontId).filter(t => !t.isCompleted && !t.isParked);
  return open.length > 0 && open.every(t => typeof t.waitingOn === "string" && t.waitingOn.trim());
}

// The right-aligned figure on a front's row. The design shows "11d" when a
// deadline is close enough to feel, a month/date when it isn't, and "PARKED"
// in place of a date for a parked front.
export function frontDueLabel(front, now = new Date()) {
  if (front?.parked) return "PARKED";
  const days = frontDaysLeft(front, now);
  if (days === null) return null;
  if (days < 0) return "OVERDUE";
  if (days <= 30) return `${days}d`;
  const due = parseDueDate(front.dueAt);
  const sameYear = due.getFullYear() === now.getFullYear();
  const month = due.toLocaleString("en-GB", { month: "short" });
  return days <= 120 && sameYear ? `${due.getDate()} ${month}` : month;
}

// The one plain-language sentence under the list. It states what is actually
// true of the fronts — never an encouragement, and never a number that shames.
export function planFooterSentence(fronts, tasks, now = new Date()) {
  const live = (fronts || []).filter(f => !f.parked);
  if (!live.length) return null;
  const moving = live.filter(f => frontNextMove(f, tasks)).length;
  const parked = (fronts || []).length - live.length;
  const pressing = live.filter(f => {
    const d = frontDaysLeft(f, now);
    return d !== null && d <= 14;
  }).length;

  const parts = [];
  if (moving === 0) parts.push(`No front has a next move yet.`);
  else if (moving === live.length) parts.push(`Every front has a next move.`);
  else parts.push(`${moving} of ${live.length} fronts have a next move.`);

  if (pressing === 1) parts.push(`One has a deadline inside a fortnight.`);
  else if (pressing > 1) parts.push(`${pressing} have deadlines inside a fortnight.`);
  if (parked) parts.push(`${parked} ${parked === 1 ? "is" : "are"} parked, and stays that way until you say otherwise.`);

  return parts.join(" ");
}
