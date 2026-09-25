import { formatMinutesToTime, getFocusWindows, mergeWindowSpans } from "./focusWindows";
import { formatSpan } from "./dayMapPlan";

// Settings' summary of the day (44a, 44d): how many windows, how much focus
// time they cover, and when the day ends — the end of the last window, which
// is what the Day map draws its red line at. With none set, the fallback
// window (07:00 to midnight) is what applies, and the summary says so.

// The windows a person has set, as editable rows. An older account may hold
// its day as dayStartHour/dayEndHour instead: that is one window they set,
// not the fallback, so it is shown as one.
export function focusWindowRows(config = {}) {
  const rows = Array.isArray(config.focusWindows) ? config.focusWindows.filter(Boolean) : [];
  if (rows.length) return rows.map(w => ({ start: w.start || "", end: w.end || "" }));
  if (Number.isFinite(config.dayStartHour) || Number.isFinite(config.dayEndHour)) {
    const [w] = getFocusWindows({ dayStartHour: config.dayStartHour, dayEndHour: config.dayEndHour });
    return [{ start: formatMinutesToTime(w.startMin), end: formatMinutesToTime(w.endMin) }];
  }
  return [];
}

// A time input can briefly be incomplete while a person edits it. Keep that
// draft when a synchronized config arrives, but replace all complete rows
// with the latest saved set so the next edit cannot write an old snapshot.
export function reconcileFocusWindowRows(currentRows, savedRows) {
  const drafts = currentRows.filter(w => !w.start || !w.end || w.start === w.end);
  return [
    ...savedRows.map(w => ({ ...w })),
    ...drafts.filter(d => !savedRows.some(w => w.start === d.start && w.end === d.end)),
  ];
}

export function focusWindowsSummary(config = {}) {
  const set = focusWindowRows(config).filter(w => w.start && w.end && w.start !== w.end);
  const windows = getFocusWindows({ ...config, focusWindows: set });
  // Count coverage on a single 00:00–24:00 clock. Split overnight windows
  // before merging, or 22:00–02:00 and 01:00–03:00 count 01:00–02:00 twice.
  const clockWindows = windows.flatMap(w => w.overnight
    ? [{ startMin: w.startMin, endMin: 1440, overnight: false }, { startMin: 0, endMin: w.endMin, overnight: false }]
    : [w]);
  const clockSpans = mergeWindowSpans(clockWindows);
  const totalMinutes = clockSpans.reduce((sum, [s, e]) => sum + (e - s), 0);
  // Day end remains the end of the latest configured span, including its
  // after-midnight tail.
  const lastEnd = Math.max(...mergeWindowSpans(windows).map(([, e]) => e)) % 1440;
  const dayEnds = `${String(Math.floor(lastEnd / 60)).padStart(2, "0")}:${String(lastEnd % 60).padStart(2, "0")}`;
  return { count: set.length, totalMinutes, dayEnds, isFallback: set.length === 0 };
}

export function focusWindowsLine(config = {}) {
  const s = focusWindowsSummary(config);
  if (s.isFallback) return `Not set · 07:00–${s.dayEnds === "00:00" ? "24:00" : s.dayEnds}`;
  return `${s.count} ${s.count === 1 ? "window" : "windows"} · ${formatSpan(s.totalMinutes)} · day ends ${s.dayEnds}`;
}
