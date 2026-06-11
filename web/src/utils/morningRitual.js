// Morning Ritual popup: a once-per-Loci-day, gentle nudge shown any time after
// the start of the user's first focus window, surfacing Daily Anchors as a
// quick check-in. Built on the flexible focus windows / Daily Anchors
// primitives from focusWindows.js and dailyAnchors.js.

import { getLociNowMinutes } from "./focusWindows";

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
// that day" (e.g. at noon for a 09:00 start).
export function isMorningRitualSlot(now, windows) {
  return getLociNowMinutes(now, windows) >= windows[0].startMin;
}

// Whether the Morning Ritual popup should be shown right now: the first focus
// window has opened today, it hasn't been dismissed (Done) yet today, and it
// isn't snoozed (Later). Independent of whether any anchors are configured.
export function shouldShowMorningRitual(now, windows, config, todayShownSlots) {
  if (!isMorningRitualSlot(now, windows)) return false;
  if (todayShownSlots.includes("morning")) return false;
  const snoozeUntil = config?.anchorsSnoozeUntil;
  if (snoozeUntil && now.getTime() < snoozeUntil) return false;
  return true;
}
