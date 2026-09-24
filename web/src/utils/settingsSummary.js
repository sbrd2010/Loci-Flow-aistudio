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

export function focusWindowsSummary(config = {}) {
  const set = focusWindowRows(config).filter(w => w.start && w.end && w.start !== w.end);
  const windows = getFocusWindows({ ...config, focusWindows: set });
  const spans = mergeWindowSpans(windows);
  const totalMinutes = spans.reduce((sum, [s, e]) => sum + (e - s), 0);
  const lastEnd = Math.max(...spans.map(([, e]) => e)) % 1440;
  const dayEnds = `${String(Math.floor(lastEnd / 60)).padStart(2, "0")}:${String(lastEnd % 60).padStart(2, "0")}`;
  return { count: set.length, totalMinutes, dayEnds, isFallback: set.length === 0 };
}

export function focusWindowsLine(config = {}) {
  const s = focusWindowsSummary(config);
  if (s.isFallback) return `Not set · 07:00–${s.dayEnds === "00:00" ? "24:00" : s.dayEnds}`;
  return `${s.count} ${s.count === 1 ? "window" : "windows"} · ${formatSpan(s.totalMinutes)} · day ends ${s.dayEnds}`;
}
