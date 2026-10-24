import { lociDayWindow, weekSummary, formatMinutes } from "./focusLedger";
import { sliceContributions } from "./insightsContext";
import { getLociDayStr, getFocusWindows } from "./focusWindows";
import { isActiveLociTask } from "./lociAIContext";
import { frontsFromConfig, frontDaysLeft, frontProgress } from "./fronts";

// The numbers behind "how was my week?" for the Coach chat: what was finished,
// what the focus log shows, what is overdue, what has sat untouched. It is added
// to the prompt only when the question asks for it (see detectPeriodIntent), so
// every other turn keeps its size. Everything is counted by Loci day, the same
// day a task's "done" stamp and its tick carry, so a day that runs past
// midnight counts as the day it started.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TITLE_MAX = 60;
export const DIGEST_FINISHED_MAX = 8;
export const DIGEST_LIST_MAX = 3;
// Not the user's rule for "stuck": they have not set one. The number is printed
// in the digest so the model reports it instead of judging.
export const DIGEST_STALE_DAYS = 14;

const parseDay = (dayStr) => {
  const [y, m, d] = String(dayStr).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dayLabel = (dayStr) => {
  const d = parseDay(dayStr);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
};
const clip = (text) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const FRONT_LIST_MAX = 4;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "what's due", "am I on track", "overdue": the deadlines of the user's fronts.
// The app keeps no due date on a task itself; a task is due when its front is.
// Dates are calendar dates, as the app's own deadline counts are.
const DEADLINE_RE = /\b(?:due|deadlines?|overdue|on track|behind|falling behind)\b/i;
export const detectDeadlineIntent = (message) => DEADLINE_RE.test(String(message || ""));

export function buildLociDeadlinesContext({ tasks = [], config = {}, now = new Date() }) {
  const dated = frontsFromConfig(config)
    .map(front => ({ front, left: frontDaysLeft(front, now) }))
    .filter(x => x.left !== null)
    .sort((a, b) => a.left - b.left);
  if (dated.length === 0) return "";
  const lines = ["FRONT DEADLINES (a front is a named piece of work with its own deadline; calendar dates):"];
  for (const { front, left } of dated.slice(0, FRONT_LIST_MAX)) {
    const due = parseDay(front.dueAt);
    const when = left < 0 ? `${plural(-left, "day")} overdue` : left === 0 ? "due today" : `in ${plural(left, "day")}`;
    const { done, total } = frontProgress(tasks, front.id);
    lines.push(`- '${clip(front.name)}': due ${due.getDate()} ${MONTHS[due.getMonth()]}, ${when}; ${done} of ${plural(total, "task")} done.`);
  }
  if (dated.length > FRONT_LIST_MAX) lines.push(`- … and ${dated.length - FRONT_LIST_MAX} more with later dates.`);
  return lines.join("\n");
}

/**
 * @param {object} p
 * @param {number} [p.days]   7 (a week) or 30 (a month)
 * @param {object|null} [p.focusRaw]  the focus ledger read, or null when it could not be read
 * @returns {string} the digest block, never empty
 */
export function buildLociPeriodContext({ tasks = [], contributions = [], config = {}, now = new Date(), windows: given, days = 7, focusRaw = null, staleDays = DIGEST_STALE_DAYS }) {
  const windows = given || getFocusWindows(config);
  const span = days === 30 ? 30 : 7;
  const both = lociDayWindow(span * 2, now, windows); // oldest first: previous period, then this one
  const current = both.slice(span);
  const inCurrent = new Set(current);
  const name = span === 30 ? "30 days" : "7 days";

  const ticks = sliceContributions(contributions, both);
  const sum = (list) => list.reduce((n, d) => n + d.count, 0);
  const nowTicks = ticks.slice(span);
  const total = sum(nowTicks);
  const lines = [`PERIOD DIGEST (the last ${name}, by day; a day that runs past midnight counts as the day it started):`];
  lines.push(`- Finished: ${plural(total, "task")} on ${plural(nowTicks.filter(d => d.count > 0).length, "day")} (the ${name} before: ${sum(ticks.slice(0, span))}).`);
  if (span === 7) lines.push(`- By day, oldest first: ${nowTicks.map(d => `${dayLabel(d.dateString)} ${d.count}`).join(", ")}.`);

  // Titles by the day the task is stamped with, not by when it was last edited.
  const finished = tasks
    .filter(t => t && !t.isDeleted && t.isCompleted && inCurrent.has(t.dateCompletedString))
    .sort((a, b) => String(b.dateCompletedString).localeCompare(String(a.dateCompletedString)) || (b.lastUpdated || 0) - (a.lastUpdated || 0));
  if (finished.length > 0) {
    const shown = finished.slice(0, DIGEST_FINISHED_MAX).map(t => `'${clip(t.title)}'`).join(", ");
    const more = finished.length > DIGEST_FINISHED_MAX ? ` … +${finished.length - DIGEST_FINISHED_MAX} more` : "";
    lines.push(`- Finished tasks still on file, newest first: ${shown}${more}.`);
  }

  if (focusRaw) {
    const f = weekSummary(focusRaw, tasks, now, windows, span);
    if (f.totalMinutes > 0) {
      const perDay = span === 7 ? ` (${f.perDay.map(d => `${dayLabel(d.date)} ${formatMinutes(d.minutes)}`).join(", ")})` : "";
      lines.push(`- Focus time: ${formatMinutes(f.totalMinutes)} on ${plural(f.daysMoved, "day")}${perDay}.`);
    } else {
      lines.push(`- Focus time: none logged in the ${name}.`);
    }
  } else {
    lines.push("- Focus time: not available in this message; do not guess it.");
  }

  const deadlines = buildLociDeadlinesContext({ tasks, config, now });
  if (deadlines) lines.push(deadlines);

  const active = tasks.filter(isActiveLociTask);
  const todayStart = parseDay(getLociDayStr(now, windows)).getTime();
  const cutoff = todayStart - staleDays * 86400000;
  const untouched = active
    .filter(t => Number(t.lastUpdated) > 0 && Number(t.lastUpdated) < cutoff)
    .sort((a, b) => a.lastUpdated - b.lastUpdated);
  if (untouched.length > 0) {
    const shown = untouched.slice(0, DIGEST_LIST_MAX).map(t => `'${clip(t.title)}' (${Math.round((todayStart - t.lastUpdated) / 86400000)} days)`).join(", ");
    lines.push(`- Open but not touched for ${staleDays}+ days (${untouched.length}), oldest first: ${shown}${untouched.length > DIGEST_LIST_MAX ? ", …" : ""}. ${staleDays} days is a default, not the user's own rule.`);
  }

  return lines.join("\n");
}
