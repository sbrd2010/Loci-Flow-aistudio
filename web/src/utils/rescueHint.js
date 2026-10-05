// Today's Rescue hint (Q55.2): Loci noticing you may be stuck, at most once a
// day, as one quiet line under the task, with "Open Rescue →" (on the
// matching Rescue state) and "Not today".
//
// Its memory lives in config, so it follows you across devices:
//   rescueHintOff      — Settings › The day, or set after 3 ignored days
//   rescueHintShown    — { date, kind, minutes, acted } for the day it showed
//   rescueHintIgnored  — days in a row it showed and wasn't tapped

export const IDLE_MINUTES = 45;
export const EARLY_WINDOW_MS = 60 * 60 * 1000;
export const FIRST_MINUTES_QUIET = 30;
export const IGNORED_DAYS_OFF = 3;

// What it noticed → the Rescue state it opens on.
export const RESCUE_STATE = { idle: "anxious", stuck: "overwhelmed", early: "distracted" };

export function hintLine(kind, minutes) {
  if (kind === "stuck") return "You’ve hit a wall on this one twice.";
  if (kind === "early") return "Two blocks ended early this hour.";
  return `This one hasn’t started in ${minutes} minutes.`;
}

// A day it showed and nobody tapped counts as ignored once the day is over;
// a tap resets the count. Returns the config patch, or null.
export function settleShown(config = {}, todayStr) {
  const shown = config.rescueHintShown;
  if (!shown || !shown.date || shown.date === todayStr) return null;
  if (shown.acted) return { rescueHintShown: null, rescueHintIgnored: 0 };
  const ignored = (Number(config.rescueHintIgnored) || 0) + 1;
  return {
    rescueHintShown: null,
    rescueHintIgnored: ignored,
    ...(ignored >= IGNORED_DAYS_OFF ? { rescueHintOff: true } : {}),
  };
}

// Focus blocks that ended early (well short of what was planned) in the last
// hour. `events` are the ledger's terminal focus events.
export function earlyEndsInLastHour(events = [], todayStr, nowMs) {
  return events.filter(e =>
    e.lociDateString === todayStr
    && Number.isFinite(e.focusEndedAt) && nowMs - e.focusEndedAt <= EARLY_WINDOW_MS && e.focusEndedAt <= nowMs
    && Number(e.focusFinalPlannedSeconds) > 0
    && Number(e.focusElapsedSeconds) < Number(e.focusFinalPlannedSeconds) - 60,
  ).length;
}

// The hint to show now, or null. Once it has shown today it stays (same
// words) until it's tapped; after a tap, nothing more today.
export function rescueHint({
  config = {}, todayStr, nowMs, lociNow, dayStart, inWindow,
  focusActive, visible, oneThingId, sinceMs, stuckCount = 0, earlyEnds = 0,
}) {
  if (config.rescueHintOff || !oneThingId || focusActive) return null;
  const shown = config.rescueHintShown;
  if (shown?.date === todayStr) {
    return shown.acted ? null : { kind: shown.kind, minutes: shown.minutes ?? null, isNew: false };
  }
  if (!visible || !inWindow || lociNow - dayStart < FIRST_MINUTES_QUIET) return null;
  if (stuckCount >= 2) return { kind: "stuck", minutes: null, isNew: true };
  if (earlyEnds >= 2) return { kind: "early", minutes: null, isNew: true };
  const idle = Number.isFinite(sinceMs) ? Math.floor((nowMs - sinceMs) / 60000) : 0;
  if (idle >= IDLE_MINUTES) return { kind: "idle", minutes: idle, isNew: true };
  return null;
}
