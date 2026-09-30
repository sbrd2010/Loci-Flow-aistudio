// Plan 57, 7a: horizons as data. Nothing on screen reads this yet (7b does).
//
// A task's horizonLevel is its horizon's id. The built-ins keep the ids the
// app has always stored — week, month, quarter, halfyear — so no task is
// rewritten; "today" stays Today (not a horizon), and "office" is the old
// Work horizon, shown only as "Work · older" until each task is sorted.
//
// config.horizons holds what the user changed: { [id]: {...} }. For a
// built-in only { name, hidden }. One the user adds (Q45) is one of:
//   { kind: "weeks", count, startDate }   — N weeks, from a Monday
//   { kind: "months", count, startDate }  — N months, from the 1st
//   { kind: "year", startDate }           — 1 Jan to 31 Dec
//   { kind: "custom", lengthDays, startDate } — N days from the day added
// each with { id, name, hidden } and an optional endDate: the current
// period's end moved by hand (Q44.4). After it, the kind and length are
// unchanged and the next period lines back up with the calendar.
// Dates are Loci-day strings (YYYY-MM-DD); callers pass today's.

export const TODAY_ID = "today";
export const WORK_OLDER_ID = "office";

export const BUILT_IN_HORIZONS = [
  { id: "week", name: "This week", kind: "week" },
  { id: "month", name: "This month", kind: "month" },
  { id: "quarter", name: "This quarter", kind: "quarter" },
  { id: "halfyear", name: "6 months", kind: "sliding6" },
];

// — Day strings, as UTC dates so no daylight-saving shift moves a day. —
const toDate = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toStr = (dt) => dt.toISOString().slice(0, 10);
const addDays = (s, n) => { const dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return toStr(dt); };
const lastOfMonth = (y, m) => toStr(new Date(Date.UTC(y, m + 1, 0))); // m: 0-based
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

// The period a horizon is in on `day`: { start, end } (both inclusive).
export function currentPeriod(horizon, day) {
  const dt = toDate(day);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth();
  switch (horizon?.kind) {
    case "week": {
      // Monday to Sunday.
      const back = (dt.getUTCDay() + 6) % 7;
      const start = addDays(day, -back);
      return { start, end: addDays(start, 6) };
    }
    case "month":
      return { start: toStr(new Date(Date.UTC(y, m, 1))), end: lastOfMonth(y, m) };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return { start: toStr(new Date(Date.UTC(y, q, 1))), end: lastOfMonth(y, q + 2) };
    }
    case "sliding6":
      // "TO 31 MAR 2027" on 28 Sep 2026: the last day of the month six months
      // out. It moves on the 1st, with its tasks, and never ends.
      return { start: toStr(new Date(Date.UTC(y, m, 1))), end: lastOfMonth(y, m + 6) };
    case "custom": {
      // Until its end date, the period set; after it, it repeats with the
      // same length (Q44.4: a new end date changes this period only).
      const len = Math.max(1, Number(horizon.lengthDays) || 1);
      let end = horizon.endDate || addDays(horizon.startDate, len - 1);
      const setEnd = end;
      if (daysBetween(end, day) > 0) end = addDays(end, Math.ceil(daysBetween(end, day) / len) * len);
      const start = end === setEnd && horizon.startDate ? horizon.startDate : addDays(end, 1 - len);
      return { start, end };
    }
    case "weeks":
    case "months":
    case "year":
      return calendarPeriod(horizon, day);
    default:
      return null;
  }
}

// The calendar kinds (Q45): the period of the grid that holds `day` — N weeks
// from the Monday it started, N months from the 1st, or the year.
function gridPeriod(horizon, day) {
  const dt = toDate(day);
  const n = Math.max(1, Math.round(Number(horizon.count) || 1));
  if (horizon.kind === "year") {
    const y = dt.getUTCFullYear();
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (horizon.kind === "weeks") {
    const anchor = currentPeriod({ kind: "week" }, horizon.startDate || day).start;
    const k = Math.floor(daysBetween(anchor, day) / (7 * n));
    const start = addDays(anchor, k * 7 * n);
    return { start, end: addDays(start, 7 * n - 1) };
  }
  // months
  const a = toDate(horizon.startDate || day);
  const months = (dt.getUTCFullYear() - a.getUTCFullYear()) * 12 + dt.getUTCMonth() - a.getUTCMonth();
  const k = Math.floor(months / n);
  const sy = a.getUTCFullYear();
  const sm = a.getUTCMonth() + k * n;
  return { start: toStr(new Date(Date.UTC(sy, sm, 1))), end: lastOfMonth(sy, sm + n - 1) };
}

// A moved end date (Q44.4) holds until it passes; the day after starts a
// period that runs to the end of its grid period, back in line.
function calendarPeriod(horizon, day) {
  const moved = horizon.endDate;
  if (!moved) return gridPeriod(horizon, day);
  if (daysBetween(moved, day) <= 0) {
    return { start: gridPeriod(horizon, moved).start, end: moved };
  }
  const after = addDays(moved, 1);
  const firstAfter = gridPeriod(horizon, after);
  if (daysBetween(firstAfter.end, day) <= 0) return { start: after, end: firstAfter.end };
  return gridPeriod(horizon, day);
}

const USER_KINDS = new Set(["weeks", "months", "year", "custom"]);
const isValidAdded = (h) => h && h.id && USER_KINDS.has(h.kind) && h.startDate
  && (h.kind !== "custom" || Number(h.lengthDays) > 0);

// "6 DAYS" on Mon 28 Sep for a week ending Sun 4 Oct.
export function daysLeft(horizon, day) {
  const p = currentPeriod(horizon, day);
  return p ? Math.max(0, daysBetween(day, p.end)) : null;
}

// Every horizon, in Plan's order: the built-ins in theirs (week, month,
// quarter, 6 months), custom ones slotted in by their current end date.
// Hidden ones are kept, flagged; callers decide whether to show them.
export function horizonsFromConfig(config = {}, day) {
  const saved = config.horizons && typeof config.horizons === "object" ? config.horizons : {};
  const builtIns = BUILT_IN_HORIZONS.map(h => ({
    ...h,
    name: String(saved[h.id]?.name || "").trim() || h.name,
    hidden: !!saved[h.id]?.hidden,
  }));
  const customs = Object.values(saved)
    .filter(isValidAdded)
    .map(h => ({ ...h, hidden: !!h.hidden }))
    .sort((a, b) => currentPeriod(a, day).end.localeCompare(currentPeriod(b, day).end));
  const out = [];
  for (const b of builtIns) {
    const bEnd = currentPeriod(b, day).end;
    while (customs.length && currentPeriod(customs[0], day).end < bEnd) out.push(customs.shift());
    out.push(b);
  }
  return [...out, ...customs];
}

// Which horizon a task sits in: its id, "today" for Today, null for
// "Work · older" (the old Work horizon) or an id no horizon has.
export function taskHorizonId(task, horizons) {
  const id = task?.horizonLevel;
  if (!id || id === WORK_OLDER_ID) return null;
  if (id === TODAY_ID) return TODAY_ID;
  return horizons.some(h => h.id === id) ? id : null;
}
