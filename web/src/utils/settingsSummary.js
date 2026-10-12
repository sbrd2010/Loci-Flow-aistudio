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

// Try-out issue 1: the windows read in the order of the day, so a window
// added later at 10:00 sits above 11:30. A window starting before 05:00 is
// after midnight when the day has a later one, so 23:00 then 00:30 stays in
// that order. Unfinished rows go last, in their own order.
const AFTER_MIDNIGHT_BEFORE = 5 * 60;
// "Add a window": an hour from where the day's last window ends, so it never
// lands on the windows you have (a fixed 09:00–17:00 overlapped them, and
// suits nobody who works evenings). With none set yet there is nothing to go
// by, so the first is left empty: it counts once both times are filled.
export function nextFocusWindowRow(rows) {
  const valid = /^\d{1,2}:\d{2}$/;
  const done = sortFocusWindowRows((rows || []).filter(w => valid.test(w?.start || "") && valid.test(w?.end || "")));
  const last = done[done.length - 1];
  if (!last) return { start: "", end: "" };
  const [h, m] = last.end.split(":").map(Number);
  const end = (h * 60 + m + 60) % 1440;
  const pad = (n) => String(n).padStart(2, "0");
  return { start: `${pad(h)}:${pad(m)}`, end: `${pad(Math.floor(end / 60))}:${pad(end % 60)}` };
}

export function sortFocusWindowRows(rows) {
  const minutesOf = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const starts = rows.map(w => minutesOf(w.start));
  const hasDaytime = starts.some(m => m != null && m >= AFTER_MIDNIGHT_BEFORE);
  const key = (m) => (m == null ? Infinity : hasDaytime && m < AFTER_MIDNIGHT_BEFORE ? m + 1440 : m);
  return rows
    .map((w, i) => ({ w, i, k: key(starts[i]) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(x => x.w);
}

// A time input can briefly be incomplete while a person edits it. Keep that
// draft when a synchronized config arrives, but replace all complete rows
// with the latest saved set so the next edit cannot write an old snapshot.
export function reconcileFocusWindowRows(currentRows, savedRows) {
  let savedIndex = 0;
  const rows = currentRows.flatMap(row => {
    // Keep an unfinished time input at its current index: the page renders
    // rows with index keys, so moving it also moves keyboard focus to another
    // window's input.
    if (!row.start || !row.end || row.start === row.end) return [{ ...row }];
    if (savedIndex >= savedRows.length) return [];
    return [{ ...savedRows[savedIndex++] }];
  });
  return [...rows, ...savedRows.slice(savedIndex).map(w => ({ ...w }))];
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
