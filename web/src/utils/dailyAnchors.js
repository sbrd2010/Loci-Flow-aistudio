import { getLociNowMinutes, getCurrentFocusSlot } from "./focusWindows";

const ANCHOR_COPIES = [
  { title: "One small check-in", intro: "Before the day runs away." },
  { title: "Quick reset", intro: "A moment for what matters." },
  { title: "Tiny anchor", intro: "Keep this close." },
  { title: "How are your anchors?", intro: "Check in for a moment." },
  { title: "Stay grounded", intro: "One anchor at a time." },
  { title: "Daily foundations", intro: "What you keep coming back to." },
];

// Three accent variants: teal, amber, soft purple
const ANCHOR_ACCENTS = ["var(--accent)", "#d97706", "var(--accent-secondary)"];

// Returns the Loci-day date string.
// For overnight focus windows, hours in the early-morning tail of a window
// (e.g., 1am when a window runs 16:00-03:00) belong to the PREVIOUS Loci day,
// not the calendar day.
export function getLociDayStr(now = new Date(), windows) {
  const lociNow = getLociNowMinutes(now, windows);
  const date = new Date(now);
  if (lociNow >= 1440) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Returns "morning" | "afternoon" | "evening" | null based on the active focus
// windows, dividing total focus time (across all windows) into thirds.
// Outside all windows returns null.
export function getCurrentAnchorSlot(now = new Date(), windows) {
  return getCurrentFocusSlot(now, windows);
}

// Deterministic per calendar day: same day = same copy + accent, rotates tomorrow.
export function getAnchorVariant(now = new Date()) {
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return {
    ...ANCHOR_COPIES[dayOfYear % ANCHOR_COPIES.length],
    accentColor: ANCHOR_ACCENTS[dayOfYear % ANCHOR_ACCENTS.length],
  };
}

// Returns today's checked anchor IDs, resetting to [] if the stored date doesn't match.
export function getTodayCheckedIds(config = {}, todayStr) {
  if (!config.anchorsCheckedDate || config.anchorsCheckedDate !== todayStr) return [];
  return Array.isArray(config.anchorsCheckedIds) ? config.anchorsCheckedIds : [];
}

// Returns today's shown slot names, resetting to [] if the stored date doesn't match.
export function getTodayShownSlots(config = {}, todayStr) {
  if (!config.anchorsSlotsDate || config.anchorsSlotsDate !== todayStr) return [];
  return Array.isArray(config.anchorsShownSlots) ? config.anchorsShownSlots : [];
}
