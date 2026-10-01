// The goal record behind Today's gold band (Q57.2, frames 63a–l): which recent
// days had a goal task done, one sentence about it, and the next goal task.
//
// "Counts" = a task on the goal's front (what the GOAL tag shows) completed
// that Loci day. Days before the goal was set are left out (Rohan's call, so
// a new goal never opens on a row of empty days). "weekdays" mode (a Key
// deadline setting) shows Mon–Fri only; a weekend day with a goal task done
// still shows, as a bonus.

import { LEGACY_DEADLINE_FRONT_ID } from "./fronts";
import { isOnToday } from "./deferral";
import { taskHorizonId } from "./horizons";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
function dayStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(str, n) {
  const d = parseDay(str);
  d.setDate(d.getDate() + n);
  return dayStr(d);
}
const isWeekendDay = (str) => [0, 6].includes(parseDay(str).getDay());
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// When the goal was set, as a day string, or null when unknown: the Key
// deadline's own Started date, or a front's creation time (its id carries it).
export function goalStartDay(goal, config = {}) {
  if (!goal) return null;
  if (goal.id === LEGACY_DEADLINE_FRONT_ID) {
    const s = String(config.deadlineStartDate || "").trim();
    return DAY_RE.test(s) ? s : null;
  }
  const m = /^front-(\d{12,})-/.exec(String(goal.id || ""));
  return m ? dayStr(new Date(Number(m[1]))) : null;
}

const doneDaysFor = (tasks, goalId) => new Set((tasks || [])
  .filter(t => t && !t.isDeleted && t.isCompleted && t.frontId === goalId && t.dateCompletedString)
  .map(t => t.dateCompletedString));

// days: oldest first, each { day, isToday, done, bonus }. A bonus day is a
// weekend day shown in weekdays mode only because a goal task was done.
export function buildGoalRecord({ tasks, goalId, todayStr, startDay = null, mode = "all" }) {
  const done = doneDaysFor(tasks, goalId);
  const weekdays = mode === "weekdays";
  const candidates = [];
  if (weekdays) {
    let d = todayStr;
    let weekdayCount = 0;
    while (weekdayCount < 5) {
      candidates.unshift(d);
      if (!isWeekendDay(d)) weekdayCount += 1;
      d = addDays(d, -1);
    }
    // Starts on the oldest weekday: a weekend before it is outside the window.
    while (isWeekendDay(candidates[0])) candidates.shift();
  } else {
    for (let i = 6; i >= 0; i -= 1) candidates.push(addDays(todayStr, -i));
  }
  const days = candidates
    .filter(day => !startDay || day >= startDay)
    .map(day => ({ day, isToday: day === todayStr, done: done.has(day), bonus: weekdays && isWeekendDay(day) }))
    .filter(d => !d.bonus || d.done);

  const todayCounts = done.has(todayStr);
  const todayIsRest = weekdays && isWeekendDay(todayStr);
  const counted = days.filter(d => !d.bonus);
  const past = counted.filter(d => !d.isToday);
  const pastDone = past.filter(d => d.done).length;
  const bonusDone = days.filter(d => d.bonus).length;
  const unit = weekdays ? "weekday" : "day";

  const plus = bonusDone ? `, plus ${plural(bonusDone, "weekend day")}` : "";
  let sentence;
  if (todayIsRest) {
    sentence = past.length ? `${pastDone} of ${plural(past.length, unit)} had a goal task done${plus}.`
      : bonusDone ? `${plural(bonusDone, "weekend day")} with a goal task done.` : "";
  } else if (todayCounts) {
    sentence = `${pastDone + 1} of ${plural(counted.length, unit)} had a goal task done, today included${plus}.`;
  } else if (past.length === 0) {
    sentence = "Today: not yet.";
  } else {
    sentence = `${pastDone} of ${plural(past.length, `past ${unit}`)} had a goal task done${plus}. Today: not yet.`;
  }

  return { days, todayCounts, sentence };
}

// The next goal task: the first open one in Today's order, else in Plan's
// nearest horizon. The current one thing is skipped: making it the one thing
// again would do nothing.
export function nextGoalTask({ tasks, goalId, todayStr, horizons = [] }) {
  const open = (tasks || []).filter(t => t && !t.isDeleted && !t.isCompleted && !t.isParked && !t.isNowFocus && t.frontId === goalId);
  const rank = (t) => {
    if (isOnToday(t, todayStr)) return t.deferredUntil === todayStr ? 0 : 1;
    if (t.horizonLevel === "today") return 2;
    const id = taskHorizonId(t, horizons);
    const at = horizons.findIndex(h => h.id === id);
    return at >= 0 ? 3 + at : 1000;
  };
  return open
    .map(t => ({ t, r: rank(t) }))
    .sort((a, b) => (a.r - b.r) || ((a.t.orderIndex ?? 0) - (b.t.orderIndex ?? 0)))[0]?.t || null;
}

// The task done today on the goal, for "Done today · <title>".
export function goalTaskDoneToday(tasks, goalId, todayStr) {
  return (tasks || []).find(t => t && !t.isDeleted && t.isCompleted && t.frontId === goalId && t.dateCompletedString === todayStr) || null;
}
