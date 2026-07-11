// Pure, platform-neutral data builders for the Insights panel (Mind Box).
// Every function here operates on raw `tasks`/`contributions` arrays passed
// in by the caller — never on `userProfile`, which is null in Demo Mode
// (App.jsx sets it to null whenever demoMode is true) and must not be a
// dependency for Insights to render correctly there.
import { isActiveLociTask, getLocalDateString } from "./lociAIContext";

export { isActiveLociTask };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A completed-task's weekday "best day" is only worth naming once there's
// enough data to not be noise — below this total, every day is a tie of
// near-nothing and the UI should show "Building your rhythm" instead.
const MIN_CONFIDENT_TOTAL = 3;

// Safely parses a "YYYY-MM-DD" date-only string into a LOCAL Date at
// midnight. Never use `new Date(dateString)` for this — per the spec, a
// bare date-only ISO string parses as UTC midnight, which in any
// negative-offset timezone (e.g. US Pacific) displays as the PREVIOUS
// calendar day once read back with local getters (getDate/getDay/etc.),
// silently shifting both the date and its weekday. Constructing from split
// y/m/d components instead is timezone-invariant by construction — the
// same three numbers produce the same local calendar date everywhere.
export function parseLocalDateOnly(dateString) {
  const [y, m, d] = String(dateString).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// "YYYY-MM-DD" strings, oldest-first, for the given range key ending at
// `today` (inclusive). "today" is a single-day range — not a degenerate
// edge case, callers gate what they render off the range's day count, not
// off a separate "is this the today range" flag.
export function getDateRangeDays(rangeKey, today = new Date()) {
  const spans = { today: 1, "7d": 7, "30d": 30 };
  const span = spans[rangeKey] || 1;
  const days = [];
  for (let i = span - 1; i >= 0; i--) {
    // Date's constructor normalizes a negative day-of-month across month/
    // year boundaries correctly (e.g. day 0 of March = last day of Feb) —
    // no separate boundary-crossing logic needed here.
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push(getLocalDateString(d));
  }
  return days;
}

// 0-fills every date in rangeDays against `contributions`, defensively
// SUMMING same-date entries rather than trusting only the first match (a
// duplicate contributions record for one date is a data anomaly this
// should absorb, not silently under-report).
export function sliceContributions(contributions, rangeDays) {
  const sums = new Map();
  (contributions || []).forEach((c) => {
    if (!c || !c.dateString) return;
    const prev = sums.get(c.dateString) || 0;
    sums.set(c.dateString, prev + (Number(c.count) || 0));
  });
  return (rangeDays || []).map((dateString) => ({ dateString, count: sums.get(dateString) || 0 }));
}

// {totalCompleted, dailyPace, completionDaysCount, bestDay} — the range's
// headline stat-tile numbers, sourced entirely from contributions[] (the
// sole authoritative source for completion counts; see the plan for why
// retained task records must never be trusted for counts).
export function computeRangeStats(contributions, rangeDays) {
  const daily = sliceContributions(contributions, rangeDays);
  const totalCompleted = daily.reduce((sum, d) => sum + d.count, 0);
  // "Per every calendar day in the range," not active-days-only — a
  // deliberate choice so this stays comparable across ranges and doesn't
  // flatter a sparse period by dividing only by the days something happened.
  const dailyPace = daily.length > 0 ? Math.round((totalCompleted / daily.length) * 10) / 10 : 0;
  const completionDaysCount = daily.filter((d) => d.count > 0).length;
  let bestDay = null;
  if (daily.length > 1) {
    const maxCount = Math.max(...daily.map((d) => d.count));
    if (maxCount > 0) {
      const topDays = daily.filter((d) => d.count === maxCount);
      if (topDays.length === 1) bestDay = topDays[0].dateString;
    }
  }
  return { totalCompleted, dailyPace, completionDaysCount, bestDay };
}

// Sun-Sat completion counts derived from contributions[] (never from
// retained task records — a completed task can be deleted later, silently
// under-counting an individual-task-based tally while contributions[] stays
// correct). `bestDay` is confidence-gated: null when there's too little
// data or the top day is tied, so the UI can fall back to an honest
// "Building your rhythm" message instead of presenting noise as a pattern.
export function computeCompletionsByDayOfWeek(contributions, rangeDays) {
  const daily = sliceContributions(contributions, rangeDays);
  const counts = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  daily.forEach((d) => {
    if (d.count === 0) return;
    const dow = parseLocalDateOnly(d.dateString).getDay();
    counts[DAY_NAMES[dow]] += d.count;
  });
  const totalCount = Object.values(counts).reduce((s, n) => s + n, 0);
  let bestDay = null;
  if (totalCount >= MIN_CONFIDENT_TOTAL) {
    const maxCount = Math.max(...Object.values(counts));
    if (maxCount > 0) {
      const topDays = Object.entries(counts).filter(([, n]) => n === maxCount);
      if (topDays.length === 1) bestDay = topDays[0][0];
    }
  }
  return { counts, totalCount, bestDay };
}

// Category counts from retained completed tasks whose dateCompletedString
// falls in-range. Deliberately does NOT compute an exact "coverage" ratio
// against contributions[] — dateCompletedString and contributions[].dateString
// are stamped by two different clocks at every current completion call site
// (TodayTab/RoadmapTab/coachActions.js/focusSession.js all pass the "Loci
// day" value for dateCompletedString but a plain calendar date for the
// contributions[] increment), so the two counts aren't guaranteed to
// describe the same population even before accounting for a task being
// deleted after completion — retainedCount/contributions-total is not a
// reliable coverage percentage, and presenting one implies more precision
// than the underlying data can support. See issue #361. The UI shows these
// category counts as available examples from retained records, with a
// flat, unconditional disclosure rather than a computed ratio.
export function computeCompletedByCategory(tasks, rangeDays) {
  const rangeSet = new Set(rangeDays);
  const inRange = (tasks || []).filter(
    (t) => t && !t.isDeleted && t.isCompleted && t.dateCompletedString && rangeSet.has(t.dateCompletedString)
  );
  const categoryCounts = {};
  inRange.forEach((t) => {
    // "Uncategorized," not a fabricated default — matches the ledger's own
    // "sparse, never invent" rule (taskSnapshotFrom in activityLog.js omits
    // missing fields rather than defaulting category to "Personal").
    const cat = t.category || "Uncategorized";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  return { categoryCounts, retainedCount: inRange.length };
}

// {categoryMix, priorityMix, horizonMix, currentOpenCount} from CURRENTLY
// active tasks (isActiveLociTask: !isDeleted && !isCompleted && !isParked,
// reused from lociAIContext.js rather than redefined) — "Current Load,"
// deliberately not range-scoped, since it reflects tasks open right now.
// currentOpenCount and every mix here share the exact same filtered array,
// so "Current Open" can never disagree with what "Current Load" shows.
export function computeActiveMix(tasks) {
  const active = (tasks || []).filter(isActiveLociTask);
  const categoryMix = {};
  const priorityMix = {};
  const horizonMix = {};
  active.forEach((t) => {
    const cat = t.category || "Uncategorized";
    categoryMix[cat] = (categoryMix[cat] || 0) + 1;
    const pri = t.priority || "Unset";
    priorityMix[pri] = (priorityMix[pri] || 0) + 1;
    const hz = t.horizonLevel || "Unset";
    horizonMix[hz] = (horizonMix[hz] || 0) + 1;
  });
  return { categoryMix, priorityMix, horizonMix, currentOpenCount: active.length };
}
