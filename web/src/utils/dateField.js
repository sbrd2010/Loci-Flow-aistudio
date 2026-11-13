// The shared date field (#658): dates stay "YYYY-MM-DD" strings, converted to
// and from local calendar dates only — never new Date("YYYY-MM-DD") (UTC) or
// toISOString() (UTC). "Today" and minimums come from the caller (Loci day or
// calendar day, whichever that field already used); nothing here decides them.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");

export function ymdToDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d ? date : null;
}

export function dateToYmd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "13 Nov 2026", as the field shows a chosen date.
export function formatDateField(ymd) {
  const date = ymdToDate(ymd);
  return date ? `${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getFullYear()}` : "";
}

const monthIndex = (word) => (word.length >= 3 ? MONTHS.findIndex(m => m.toLowerCase().startsWith(word)) : -1);
const build = (y, mo, d) => (mo >= 0 ? ymdToDate(`${y}-${pad(mo + 1)}-${pad(d)}`) : null);

// What a person types: 2026-11-13, 13 Nov 2026, 13 November 2026, Nov 13 2026
// (commas and a dot after the month are fine). A 4-digit year is required, so
// a half-typed "13 Nov 2" is never read as the year 2. Anything else is null.
export function parseTypedDate(text) {
  const t = String(text || "").trim().toLowerCase().replace(/,/g, " ").replace(/\.(?=\s)/g, "").replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let date = m ? build(m[1], Number(m[2]) - 1, Number(m[3])) : null;
  if (!date && (m = /^(\d{1,2}) ([a-z]+) (\d{4})$/.exec(t))) date = build(m[3], monthIndex(m[2]), Number(m[1]));
  if (!date && (m = /^([a-z]+) (\d{1,2}) (\d{4})$/.exec(t))) date = build(m[3], monthIndex(m[1]), Number(m[2]));
  return date ? dateToYmd(date) : null;
}

// A full ISO date, typed or pasted, is taken at once (as the browser's own
// field did); other formats wait for Enter or leaving the field.
export const isFullIsoDate = (text) => /^\d{4}-\d{2}-\d{2}$/.test(String(text || "").trim());

// First day of the week for the person's locale (0 = Sunday, 1 = Monday),
// or undefined to keep the calendar's default when the browser can't say.
export function localeWeekStart(locale = typeof navigator !== "undefined" ? navigator.language : undefined) {
  try {
    const loc = new Intl.Locale(locale || "en-GB");
    const info = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
    return info?.firstDay ? info.firstDay % 7 : undefined;
  } catch (_) {
    return undefined;
  }
}
