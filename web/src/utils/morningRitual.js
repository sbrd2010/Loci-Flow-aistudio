// Morning Ritual popup: a once-per-day, gentle "good morning" nudge shown on
// the first app open within a fixed wall-clock window (default 05:00-11:00,
// configurable in Settings), surfacing Daily Anchors as a quick check-in.
// Independent of Focus Windows and Daily Anchors slot/snooze state — see
// isMorningRitualSlot below for the Focus-Window-based check still used by
// the Daily Coach check-ins.

import { getLociNowMinutes, parseTimeToMinutes } from "./focusWindows";

const DEFAULT_MORNING_RITUAL_WINDOW_START = "05:00";
const DEFAULT_MORNING_RITUAL_WINDOW_END = "11:00";
const MORNING_RITUAL_SNOOZE_MS = 90 * 60 * 1000; // matches Daily Anchors "Later"

function getLocalDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Rotating short copy for the centered Morning Ritual popup. Deterministic
// per calendar day, like getAnchorVariant in dailyAnchors.js.
const MORNING_RITUAL_VARIANTS = [
  { title: "Start the day gently", line: "One small step is still a step." },
  { title: "Morning reset", line: "A clear start makes the rest easier." },
  { title: "Begin again", line: "Today is a fresh page." },
  { title: "Ease in", line: "Small and steady wins the day." },
  { title: "Set the tone", line: "A calm start shapes a calm day." },
  { title: "First things first", line: "One step now is enough." },
];

export function getMorningRitualVariant(now = new Date()) {
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return MORNING_RITUAL_VARIANTS[dayOfYear % MORNING_RITUAL_VARIANTS.length];
}

// True from the moment the first focus window opens today onward, with no
// upper bound — covers both "right at the start" and "first opened later
// that day" (e.g. at noon for a 09:00 start). Used by the Daily Coach
// check-ins (Today's Commitment / Progress Check / Day Close), which remain
// tied to Focus Windows.
export function isMorningRitualSlot(now, windows) {
  return getLociNowMinutes(now, windows) >= windows[0].startMin;
}

// True during a fixed wall-clock window (default 05:00-11:00), independent of
// Focus Windows. Falls back to the defaults if config.morningRitualWindowStart/
// End are missing, malformed, equal, or inverted (start >= end). No overnight
// (start >= end) windows are supported.
export function isMorningRitualWindow(now, config = {}) {
  let startMin = parseTimeToMinutes(config?.morningRitualWindowStart);
  let endMin = parseTimeToMinutes(config?.morningRitualWindowEnd);
  if (startMin === null || endMin === null || startMin >= endMin) {
    startMin = parseTimeToMinutes(DEFAULT_MORNING_RITUAL_WINDOW_START);
    endMin = parseTimeToMinutes(DEFAULT_MORNING_RITUAL_WINDOW_END);
  }
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  return nowMin >= startMin && nowMin < endMin;
}

// Whether the Morning Ritual popup should be shown right now: inside the
// configured wall-clock window, not already shown today (local calendar
// date), and not snoozed (Later). Independent of Focus Windows and Daily
// Anchors slot/snooze state.
export function shouldShowMorningRitual(now, config = {}) {
  if (!isMorningRitualWindow(now, config)) return false;
  if (config?.morningRitualShownDate === getLocalDateStr(now)) return false;
  const snoozeUntil = config?.morningRitualSnoozeUntil;
  if (snoozeUntil && now.getTime() < snoozeUntil) return false;
  return true;
}

// Config patch for "Done": marks today (local date) as shown and clears any snooze.
export function buildMorningRitualDoneConfig(now = new Date()) {
  return { morningRitualShownDate: getLocalDateStr(now), morningRitualSnoozeUntil: null };
}

// Config patch for "Later": snoozes the popup for 90 minutes.
export function buildMorningRitualSnoozeConfig(now = new Date()) {
  return { morningRitualSnoozeUntil: now.getTime() + MORNING_RITUAL_SNOOZE_MS };
}
