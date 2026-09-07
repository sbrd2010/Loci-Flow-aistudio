// Feedback for the Focus Windows editor in Settings, kept separate from
// focusWindows.js: that module answers "given these windows, where are we in the
// day"; this one answers "do these windows look like what the user meant".
//
// The failure this exists for: <input type="time"> in a 12-hour locale starts on
// AM, so entering an afternoon time and leaving the meridiem untouched silently
// stores the morning one. "1:00 PM to 2:30 PM" becomes "1:00 AM to 2:30 PM" — a
// 13½-hour window the app accepted without complaint, which then reported 18
// hours of focus time left in the day.

import { parseTimeToMinutes, formatMinutesToTime } from "./focusWindows";

const HALF_DAY = 12 * 60;

// Minutes covered by one window, following getFocusWindows' rule that an end at
// or before the start means the window crosses midnight. null when either side
// is unset or invalid, or the two are equal (which getFocusWindows drops).
export function getWindowDuration(start, end) {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null || startMin === endMin) return null;
  return endMin > startMin ? endMin - startMin : endMin + 1440 - startMin;
}

// "45m", "1h 30m", "13h" — for showing a window's length next to its inputs.
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// "13:00" -> "1:00 PM". The suggestion has to name the time the way the picker
// shows it, or it cannot be checked against what is on screen.
export function formatTime12(timeStr) {
  const minutes = parseTimeToMinutes(timeStr);
  if (minutes === null) return "";
  const h24 = Math.floor(minutes / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

// The clock ranges a window covers, split at midnight so overlap between an
// overnight window and an early-morning one is still detected.
function coveredRanges(start, end) {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null || startMin === endMin) return [];
  return endMin > startMin
    ? [[startMin, endMin]]
    : [[startMin, 1440], [0, endMin]];
}

function rangesOverlap(a, b) {
  return a.some(([s1, e1]) => b.some(([s2, e2]) => s1 < e2 && s2 < e1));
}

// Indexes of the other rows a given row overlaps in time.
//
// Overlap is the signal this module leans on rather than "the window is long":
// the app's own default is 7:00 AM–2:00 AM, and a 9–5 workday is a single
// 8-hour window, so length alone would flag perfectly ordinary setups. Two
// windows covering the same minutes, by contrast, is nearly always a mistake —
// the user is describing distinct stretches of the day.
export function findOverlaps(rows) {
  const ranges = rows.map(r => coveredRanges(r?.start, r?.end));
  return rows.map((_, i) =>
    rows.reduce((acc, __, j) => {
      if (i !== j && ranges[i].length && ranges[j].length && rangesOverlap(ranges[i], ranges[j])) acc.push(j);
      return acc;
    }, [])
  );
}

// Whether shifting one side of an overlapping window forward by 12 hours — the
// exact shape of a missed AM/PM — leaves it shorter and colliding with fewer
// rows. Returns { field, value, durationMin } to offer as a one-tap fix, or
// null when no such shift clearly helps.
//
// Only a time before noon is a candidate, since only those have a PM reading.
// The test is that the shift *reduces* the row's overlaps, not that it removes
// them all: when two rows are both slipped they overlap each other, so
// requiring a clean result would refuse to fix either — which is precisely the
// case reported. Requiring a strict reduction still rejects a shift that merely
// trades one collision for another.
function suggestMeridiemFix(rows, index) {
  const row = rows[index];
  const current = getWindowDuration(row?.start, row?.end);
  if (current === null) return null;
  const currentOverlaps = findOverlaps(rows)[index].length;

  const candidates = [];
  for (const field of ["start", "end"]) {
    const minutes = parseTimeToMinutes(row[field]);
    if (minutes === null || minutes >= HALF_DAY) continue;
    const shifted = { ...row, [field]: formatMinutesToTime(minutes + HALF_DAY) };
    const duration = getWindowDuration(shifted.start, shifted.end);
    if (duration === null || duration >= current) continue;
    const probe = rows.map((r, i) => (i === index ? shifted : r));
    if (findOverlaps(probe)[index].length >= currentOverlaps) continue;
    const startMin = parseTimeToMinutes(shifted.start);
    const endMin = parseTimeToMinutes(shifted.end);
    candidates.push({
      field,
      value: shifted[field],
      durationMin: duration,
      overnight: endMin <= startMin,
    });
  }
  if (candidates.length === 0) return null;
  // Shortest result first — a missed meridiem inflates a window, so the shift
  // that shrinks it most is the best read of the intent. Between two equally
  // good readings (9:00–17:00 and 21:00–05:00 are both 8h), prefer the one that
  // stays within a single day, which is the ordinary shape for focus time.
  candidates.sort((a, b) => a.durationMin - b.durationMin || a.overnight - b.overnight);
  const { field, value, durationMin } = candidates[0];
  return { field, value, durationMin };
}

// Per-row feedback for the editor: how long each window is, which rows it
// collides with, and the meridiem fix to offer when one would resolve the
// collision. Rows are analysed in place so indexes line up with the inputs.
export function analyzeFocusWindowRows(rows = []) {
  const overlaps = findOverlaps(rows);
  return rows.map((row, index) => {
    const durationMin = getWindowDuration(row?.start, row?.end);
    const overlapsWith = overlaps[index];
    return {
      index,
      durationMin,
      overlapsWith,
      meridiemFix: overlapsWith.length > 0 ? suggestMeridiemFix(rows, index) : null,
    };
  });
}

// Total wall-clock time the windows cover, counting shared minutes once so the
// figure is time the user could actually work rather than a sum that can exceed
// a day. This is the number the setting exists to answer.
export function getTotalPlannedMinutes(rows = []) {
  const spans = rows
    .flatMap(r => coveredRanges(r?.start, r?.end))
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.reduce((sum, [start, end]) => sum + (end - start), 0);
}
