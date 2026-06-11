// Morning Ritual popup: a once-per-Loci-day, gentle nudge shown around the
// start of the user's first focus window, surfacing Daily Anchors as a quick
// check-in. Built on the flexible focus windows / Daily Anchors primitives
// from focusWindows.js and dailyAnchors.js.

import { getCurrentFocusSlot } from "./focusWindows";

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

// True only during the "morning" focus slot: at/after the first focus window
// opens today, until a third of today's total scheduled focus time has elapsed.
export function isMorningRitualSlot(now, windows) {
  return getCurrentFocusSlot(now, windows) === "morning";
}

// Whether the Morning Ritual popup should be shown right now: it's the
// morning slot, it hasn't been dismissed (Done) yet today, and it isn't
// snoozed (Later). Independent of whether any anchors are configured.
export function shouldShowMorningRitual(now, windows, config, todayShownSlots) {
  if (!isMorningRitualSlot(now, windows)) return false;
  if (todayShownSlots.includes("morning")) return false;
  const snoozeUntil = config?.anchorsSnoozeUntil;
  if (snoozeUntil && now.getTime() < snoozeUntil) return false;
  return true;
}
