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
// For overnight windows (dayEndHour >= 24), hours before wrapHour (e.g., 1am with dayEndHour=26)
// belong to the PREVIOUS Loci day, not the calendar day.
export function getLociDayStr(now = new Date(), dayStartHour = 7, dayEndHour = 26) {
  let date = new Date(now);
  if (dayEndHour >= 24) {
    const wrapHour = dayEndHour - 24;
    if (now.getHours() < wrapHour) {
      date = new Date(now);
      date.setDate(date.getDate() - 1);
    }
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Maps wall-clock hour to the Loci "logical hour" so after-midnight hours
// in an overnight window compare correctly against dayStartHour/dayEndHour.
function getLociHour(now, dayEndHour = 26) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (dayEndHour >= 24) {
    const wrapHour = dayEndHour - 24;
    if (h < wrapHour) return h + 24; // e.g. 1:30am → 25.5
  }
  return h;
}

// Returns "morning" | "afternoon" | "evening" | null based on Loci work window.
// Window is divided into thirds. Outside the window returns null.
export function getCurrentAnchorSlot(now = new Date(), dayStartHour = 7, dayEndHour = 26) {
  const lh = getLociHour(now, dayEndHour);
  if (lh < dayStartHour || lh >= dayEndHour) return null;
  const third = (dayEndHour - dayStartHour) / 3;
  if (lh < dayStartHour + third) return "morning";
  if (lh < dayStartHour + 2 * third) return "afternoon";
  return "evening";
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
