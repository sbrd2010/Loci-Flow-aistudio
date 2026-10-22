// Loci's date helpers (getLociDayStr, getFocusWindows, ...) read the machine's
// local clock: getHours(), getDate(), setHours(). A Worker's clock is always
// UTC, so handing them a real Date would make "today" and every deadline wrong
// for the part of the day where the user's date differs from UTC.
//
// wallClock() returns a Date whose UTC fields equal the wall clock in `timeZone`.
// Because a Worker's local time IS UTC, the helpers then read the user's day.
// assertUtcRuntime() makes the assumption loud instead of silently wrong.

export function assertUtcRuntime() {
  if (new Date(0).getTimezoneOffset() !== 0) {
    throw new Error("The Loci connector must run with a UTC clock (a Cloudflare Worker does).");
  }
}

export function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
  } catch {
    throw new Error(`LOCI_TIMEZONE "${timeZone}" is not a valid IANA time zone (for example Asia/Kolkata).`);
  }
}

export function wallClock(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(ms);
  const n = (type) => Number(parts.find(p => p.type === type).value);
  const millis = ((ms % 1000) + 1000) % 1000;
  return new Date(Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"), millis));
}

// "YYYY-MM-DD" of a wall-clock Date.
export function dateString(wall) {
  return wall.toISOString().slice(0, 10);
}

// Whole days from a to b, both "YYYY-MM-DD" (b later => positive). Pure calendar
// arithmetic on strings, so no clock or zone can shift the answer.
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
