// Coach → Review, the facts (Q51, 62a–g). Everything here is computed from
// what the app already records: focus minutes from the activity ledger,
// ticks from contributions[], and the tasks themselves. Every figure is shown
// with its number; nothing is estimated.
import { weekSummary, lociDayWindow } from "./focusLedger";
import { sliceContributions, computeRangeStats, computeCompletionsByDayOfWeek, computeCompletedByCategory, computeActiveMix, getDateRangeDays } from "./insightsContext";
import { isActiveLociTask } from "./lociAIContext";
import { isOnToday } from "./deferral";
import { getRemainingFocusMinutes, getLociDayStr } from "./focusWindows";

export const REVIEW_PERIODS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
];

const NOUN = { today: "today", "7d": "these 7 days", "30d": "these 30 days" };

// The one sentence under the figure (moved from Mind Box's "The week").
// Every branch states something true of the period's own numbers; none of it
// is encouragement, and none of it shames.
export function patternSentence(summary, frontNameOf, period = "7d") {
  const { perDay, totalMinutes, totalMoves, daysMoved, byFront } = summary;
  const noun = NOUN[period] || NOUN["7d"];
  if (totalMoves === 0) {
    return { before: `No focus time logged ${noun}. `, bold: "That is a record too", after: ", not a gap." };
  }
  // byFront is only ever populated from events with countable minutes, so a
  // non-empty map guarantees totalMinutes > 0.
  if (byFront.size > 0) {
    const [topId, topMins] = [...byFront.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topMins / totalMinutes > 0.5) {
      return { before: "More than half of it went to ", bold: frontNameOf(topId), after: "." };
    }
  }
  if (perDay.length === 1) return null;
  // Ranked by the same measure the share is then computed in (minutes).
  const best = [...perDay].sort((a, b) => b.minutes - a.minutes)[0];
  if (best && best.minutes > 0 && daysMoved > 1 && best.minutes / totalMinutes > 0.4) {
    return { before: "Most of it happened on ", bold: "one day", after: "." };
  }
  return { before: "You moved on ", bold: `${daysMoved} of the last ${perDay.length} days`, after: "." };
}

const HORIZON_GROUPS = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "later", label: "Later" },
];

const estimateOf = (t) => (Number(t?.timeEstimateMinutes) > 0 ? Number(t.timeEstimateMinutes) : 25);

/**
 * The facts for one period. `focusRaw` is the ledger read (null when it
 * couldn't be read); then the focus figures are null and say so, rather than
 * claiming nothing was logged.
 */
export function reviewFacts({ tasks = [], contributions = [], config = {}, focusRaw = null, period = "7d", now = new Date(), windows, frontNameOf = (id) => id || "work on no front" }) {
  const span = REVIEW_PERIODS.find(p => p.key === period)?.days || 7;
  const days = lociDayWindow(span, now, windows);
  const ledger = focusRaw ? weekSummary(focusRaw, tasks, now, windows, span) : null;

  // Ticks: contributions[] is the one authoritative count (see insightsContext),
  // stamped by calendar date. Focus is by Loci day; the two lists line up day
  // for day and differ only between midnight and the end of a late window.
  const ticks = sliceContributions(contributions, getDateRangeDays(period, now));
  const stats = computeRangeStats(ticks);
  // Under each bar, the ticks of that same date, matched by date, not by
  // position: after midnight in a late window the calendar has moved on
  // while the Loci day hasn't, and a position match would shift every day.
  const ticksOn = new Map(sliceContributions(contributions, days).map(d => [d.dateString, d.count]));
  const perDay = days.map((date, i) => ({
    date,
    minutes: ledger ? ledger.perDay[i]?.minutes || 0 : null,
    ticks: ticksOn.get(date) || 0,
  }));

  const byFront = ledger
    ? [...ledger.byFront.entries()].sort((a, b) => b[1] - a[1]).map(([id, minutes]) => ({ id, name: frontNameOf(id), minutes }))
    : null;

  // By category: done in the period (retained tasks) · open now.
  const done = computeCompletedByCategory(tasks, days).categoryCounts;
  const open = computeActiveMix(tasks).categoryMix;
  const byCategory = [...new Set([...Object.keys(done), ...Object.keys(open)])]
    .map(name => ({ name, done: done[name] || 0, open: open[name] || 0 }))
    .sort((a, b) => (b.done + b.open) - (a.done + a.open) || a.name.localeCompare(b.name));

  // Best weekday always reads the last 30 days of ticks, whatever the period.
  const weekday = computeCompletionsByDayOfWeek(sliceContributions(contributions, getDateRangeDays("30d", now)));

  // Open now, by horizon.
  const active = tasks.filter(isActiveLociTask);
  const counts = Object.fromEntries(HORIZON_GROUPS.map(g => [g.id, 0]));
  for (const t of active) {
    const h = ["today", "week", "month", "quarter"].includes(t.horizonLevel) ? t.horizonLevel : "later";
    counts[h] += 1;
  }
  const todayStr = getLociDayStr(now, windows);
  const plannedTodayMin = active.filter(t => isOnToday(t, todayStr)).reduce((n, t) => n + estimateOf(t), 0);
  const leftMin = Math.max(0, Math.round(getRemainingFocusMinutes(now, windows)));

  return {
    period,
    days: perDay,
    focusedMinutes: ledger ? ledger.totalMinutes : null,
    completed: stats.totalCompleted,
    pace: stats.dailyPace,
    daysWithTick: stats.completionDaysCount,
    dayCount: span,
    sentence: ledger ? patternSentence(ledger, frontNameOf, period) : null,
    byFront,
    byCategory,
    weekday,
    openNow: {
      total: active.length,
      byHorizon: HORIZON_GROUPS.map(g => ({ ...g, count: counts[g.id] })),
      plannedTodayMin,
      leftMin,
      over: plannedTodayMin > leftMin,
    },
  };
}
