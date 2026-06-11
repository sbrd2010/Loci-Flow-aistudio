// Flexible daily focus/work windows: replaces the single dayStartHour/dayEndHour
// span with an ordered list of {startMin, endMin, overnight} ranges (minutes
// since midnight, 0-1439). Falls back to dayStartHour/dayEndHour when
// config.focusWindows is missing or invalid, so existing configs keep working.

const DEFAULT_WINDOWS = [{ startMin: 420, endMin: 120, overnight: true }]; // 7am-2am

// Parses "HH:MM" (00:00-23:59) to minutes since midnight, or null if invalid.
export function parseTimeToMinutes(timeStr) {
  if (typeof timeStr !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Formats minutes since midnight back to "HH:MM" for <input type="time">.
export function formatMinutesToTime(totalMin) {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Returns normalized, start-sorted [{startMin, endMin, overnight}], always non-empty.
// Uses config.focusWindows if it has at least one valid {start, end} entry,
// otherwise falls back to dayStartHour/dayEndHour (defaults 7/26).
export function getFocusWindows(config = {}) {
  const cfg = config || {};
  if (Array.isArray(cfg.focusWindows) && cfg.focusWindows.length > 0) {
    const valid = [];
    for (const w of cfg.focusWindows) {
      if (!w || typeof w !== "object") continue;
      const startMin = parseTimeToMinutes(w.start);
      const endMin = parseTimeToMinutes(w.end);
      if (startMin === null || endMin === null || startMin === endMin) continue;
      valid.push({ startMin, endMin, overnight: endMin <= startMin });
    }
    if (valid.length > 0) return valid.sort((a, b) => a.startMin - b.startMin);
  }

  const dayStartHour = Number.isFinite(cfg.dayStartHour) ? cfg.dayStartHour : 7;
  const dayEndHour = Number.isFinite(cfg.dayEndHour) ? cfg.dayEndHour : 26;
  const startMin = (((Math.round(dayStartHour * 60) % 1440) + 1440) % 1440);
  const endMin = (((Math.round(dayEndHour * 60) % 1440) + 1440) % 1440);
  if (startMin === endMin) return DEFAULT_WINDOWS;
  return [{ startMin, endMin, overnight: endMin <= startMin }];
}

// "Loci now": minutes since today's midnight, pushed past 1440 when `now` falls
// in the early-morning tail of an overnight window (so it compares correctly
// against that window's start, which is still "yesterday" in wall-clock terms).
export function getLociNowMinutes(now, windows) {
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  return windows.some(w => w.overnight && nowMin < w.endMin) ? nowMin + 1440 : nowMin;
}

// Single pass over the windows relative to "now": which state we're in, how much
// focus time remains today (gaps excluded), and which window opens next.
function analyzeWindows(now, windows) {
  const lociNow = getLociNowMinutes(now, windows);
  let state = "after";
  let remainingMin = 0;
  let nextWindow = null;
  for (const w of windows) {
    const lociStart = w.startMin;
    const lociEnd = w.overnight ? w.endMin + 1440 : w.endMin;
    if (lociNow >= lociStart && lociNow < lociEnd) {
      state = "during";
      remainingMin += lociEnd - lociNow;
    } else if (lociNow < lociStart) {
      remainingMin += lociEnd - lociStart;
      if (!nextWindow) nextWindow = w;
    }
  }
  if (state !== "during") state = remainingMin > 0 ? "before" : "after";
  return { state, remainingMin, nextWindow };
}

// "before" (no window has started yet today, or we're in a gap before the next
// one), "during" (inside a window now), or "after" (today's windows are done).
export function getWindowState(now, windows) {
  return analyzeWindows(now, windows).state;
}

// Total focus minutes left today: remaining time in the active window (if any)
// plus the full duration of any windows still ahead today. Gaps are excluded.
export function getRemainingFocusMinutes(now, windows) {
  return analyzeWindows(now, windows).remainingMin;
}

// Total scheduled focus minutes across all windows today (gaps excluded).
function getTotalFocusMinutes(windows) {
  return windows.reduce((sum, w) => sum + ((w.overnight ? w.endMin + 1440 : w.endMin) - w.startMin), 0);
}

// Fraction (0-1) of today's total scheduled focus time that has elapsed.
// Time spent in a gap between windows does not advance this: progress holds
// steady through the gap and resumes once the next window opens.
export function getFocusProgress(now, windows) {
  const totalMin = getTotalFocusMinutes(windows);
  if (totalMin <= 0) return 0;
  const { remainingMin } = analyzeWindows(now, windows);
  return Math.max(0, Math.min(1, (totalMin - remainingMin) / totalMin));
}

// The next window to open today (for "opens at HH:MM"), or null if none remain.
export function getNextWindowStart(now, windows) {
  return analyzeWindows(now, windows).nextWindow;
}

// Overall span across all windows, from the first start to the last end (end may
// exceed 1440 for an overnight window). Used to size the day timeline/progress bar.
// NOTE: this is a single span — gaps between windows are not visually distinguished.
export function getOverallSpan(windows) {
  const startMin = Math.min(...windows.map(w => w.startMin));
  const endMin = Math.max(...windows.map(w => (w.overnight ? w.endMin + 1440 : w.endMin)));
  return { startMin, endMin };
}

// "morning" | "afternoon" | "evening" | null: divides the day's TOTAL focus time
// (summed across all windows, gaps excluded) into thirds. Outside all windows
// returns null. For a single window this matches the original "thirds of the
// window" behavior.
export function getCurrentFocusSlot(now, windows) {
  const lociNow = getLociNowMinutes(now, windows);
  let totalActive = 0;
  let elapsed = null;
  for (const w of windows) {
    const lociStart = w.startMin;
    const lociEnd = w.overnight ? w.endMin + 1440 : w.endMin;
    if (lociNow >= lociStart && lociNow < lociEnd) {
      elapsed = totalActive + (lociNow - lociStart);
    }
    totalActive += lociEnd - lociStart;
  }
  if (elapsed === null) return null;
  const third = totalActive / 3;
  if (elapsed < third) return "morning";
  if (elapsed < 2 * third) return "afternoon";
  return "evening";
}

export function getLociDayStr(now, windows) {
  const date = new Date(now);
  if (getLociNowMinutes(now, windows) >= 1440) {
    date.setDate(date.getDate() - 1);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

