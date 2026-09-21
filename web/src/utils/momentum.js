// Momentum — "days moved, not tasks completed".
//
// Five small bars in Today's footer beside a plain sentence. The design is
// explicit about what this must NOT become: no streak counter, no "you broke
// your streak", no number that can shame. Breaking the chain does nothing, and
// that is the point — so the sentence only ever counts up, and disappears
// entirely rather than reporting a zero.
//
// A "day moved" is a day with a countable focus session. Not a day with a
// completed task: you can work hard and finish nothing, and that day counts.

import { flattenFocusEvents, dailyTotals, lociDayWindow } from "./focusLedger";

export const MOMENTUM_BARS = 5;

const ONES = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth"];
const TEENS = ["Tenth", "Eleventh", "Twelfth", "Thirteenth", "Fourteenth", "Fifteenth",
  "Sixteenth", "Seventeenth", "Eighteenth", "Nineteenth"];
const TENS = ["", "", "Twent", "Thirt", "Fort", "Fift", "Sixt", "Sevent", "Eight", "Ninet"];
const TENS_PLAIN = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

// Words, not numerals: rule 2 keeps figures in mono and prose out of it, and
// this is prose. Beyond ninety-nine it gives up gracefully rather than
// inventing a form nobody will ever read.
export function ordinalWord(n) {
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (ones === 0) return `${TENS[tens]}ieth`;
  return `${TENS_PLAIN[tens]}-${ONES[ones].toLowerCase()}`;
}

// `raw` is the ledger subscription's payload. Returns null when the strip must
// not render at all — no history, or nothing readable.
//
// K5 settles the two rules that look like they collide. The window starts at
// the FIRST DAY OF HISTORY, not five days before today: "fewer bars" governs
// only a history shorter than five days, while a quiet day INSIDE the window
// is a --border bar. Because the window can never begin before the first
// session, an empty leading slot cannot occur.
export function buildMomentum(raw, now = new Date(), windows, historyDays = 30) {
  const days = lociDayWindow(historyDays, now, windows);
  if (days.length === 0) return null;
  const inWindow = new Set(days);
  const totals = dailyTotals(flattenFocusEvents(raw).filter(e => inWindow.has(e.lociDateString)));
  const moved = new Set(days.filter(d => (totals[d]?.moves || 0) > 0));
  if (moved.size === 0) return null;

  const today = days[days.length - 1];
  const firstMovedIdx = days.findIndex(d => moved.has(d));
  const bars = days.slice(firstMovedIdx).slice(-MOMENTUM_BARS).map(date => ({
    date,
    state: !moved.has(date) ? "quiet" : (date === today ? "today" : "moved"),
  }));

  // Consecutive days with a session, ending today — or yesterday, when today
  // has none yet, so an untouched morning doesn't read as a broken chain.
  let i = days.length - 1;
  if (!moved.has(today)) i -= 1;
  let streak = 0;
  while (i >= 0 && moved.has(days[i])) { streak++; i--; }

  // A streak reaching the oldest day fetched may really be longer; this
  // undercounts rather than guesses, which is the safe direction for a figure
  // that only ever counts up.
  const word = ordinalWord(streak);
  const sentence = streak === 0 ? null
    : streak === 1 ? "First day."
    : word ? `${word} day running.`
    : null;

  return { bars, streak, sentence };
}
