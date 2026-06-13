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
// per calendar day, like getAnchorVariant in dailyAnchors.js. The vibe:
// today is the only guaranteed day, yesterday doesn't define you, and you
// are capable of winning it — including pushing back on self-doubt and
// outside negativity.
const MORNING_RITUAL_VARIANTS = [
  { title: "Today is yours", line: "Yesterday is gone, tomorrow isn't promised. Today is real — make it count." },
  { title: "A clean page", line: "However yesterday went, today starts new. You've got this." },
  { title: "Believe in yourself", line: "You're capable of more than you know. Today, prove it to yourself." },
  { title: "Only today is guaranteed", line: "So show up for it fully, one step at a time." },
  { title: "You will win today", line: "Not someday — today. Decide it now, and go." },
  { title: "Fresh start", line: "Every sunrise is a second chance. This one is yours." },
  { title: "Today counts", line: "No matter what happened before, this day is untouched. Begin well." },
  { title: "You're capable", line: "Of focus. Of finishing. Of a good day. Start now." },
  { title: "This is your day", line: "Show up for yourself, and the day will show up for you." },
  { title: "Trust today", line: "It doesn't know about yesterday. Meet it with a clear mind." },
  { title: "A new chapter", line: "Every morning rewrites the story. Make today a good page." },
  { title: "Today is enough", line: "You don't need to fix everything — just begin one thing well." },
  { title: "You've got this", line: "Whatever's ahead, you're more ready than you feel." },
  { title: "Make it beautiful", line: "A good day starts with a good first hour. Start it now." },
  { title: "Be here, today", line: "Not yesterday's weight, not tomorrow's worry — just today." },
  { title: "Start strong", line: "One calm, focused step now sets the tone for everything after." },
  { title: "Today is real", line: "Yesterday's a memory, tomorrow's a guess. This day is in your hands." },
  { title: "Today, you win", line: "Small wins count. Pick one, and get moving." },
  { title: "A quiet confidence", line: "You don't need to feel ready. You just need to begin." },
  { title: "One good day", line: "Fully live this one day — that's more than enough." },
  { title: "Your potential isn't a debate", line: "What others think of you has nothing to do with what you're capable of." },
  { title: "You earned it", line: "That win wasn't luck. You showed up and did the work — own it." },
  { title: "Not a fraud", line: "Self-doubt after success doesn't mean it wasn't real. It was." },
  { title: "Don't borrow their doubt", line: "Other people's negativity is their story — not your truth." },
  { title: "Setbacks aren't verdicts", line: "Trying to grow means risking disappointment. That's growth, not failure." },
  { title: "Protect your belief", line: "The world doesn't get to decide your worth. Only you do." },
  { title: "Quiet the noise", line: "Criticism is loud. Your potential is quieter — and it's still there." },
  { title: "You belong here", line: "Whatever you've achieved, you earned the right to be here." },
  { title: "Rise above it", line: "Let others doubt. You already know what you're capable of." },
  { title: "Stay yours", line: "However the world treats you today, it doesn't get to write your story." },
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

// Whether the Morning Ritual popup should be shown right now: enabled in
// Settings (default on), inside the configured wall-clock window, not
// already shown today (local calendar date), and not snoozed (Later).
// Independent of Focus Windows and Daily Anchors slot/snooze state.
export function shouldShowMorningRitual(now, config = {}) {
  if (config?.morningRitualEnabled === false) return false;
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
