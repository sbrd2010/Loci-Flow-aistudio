// Plan 57, 7a: horizons as data. Nothing on screen reads this yet (7b does).
//
// A task's horizonLevel is its horizon's id. The built-ins keep the ids the
// app has always stored — week, month, quarter, halfyear — so no task is
// rewritten; "today" stays Today (not a horizon), and "office" is the old
// Work horizon, shown only as "Work · older" until each task is sorted.
//
// config.horizons holds what the user changed: { [id]: {...} }. For a
// built-in only { name, hidden }; a custom one is
// { id, name, kind: "custom", startDate, endDate, lengthDays, hidden }.
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
      let end = horizon.endDate;
      if (daysBetween(end, day) > 0) end = addDays(end, Math.ceil(daysBetween(end, day) / len) * len);
      const start = end === horizon.endDate && horizon.startDate ? horizon.startDate : addDays(end, 1 - len);
      return { start, end };
    }
    default:
      return null;
  }
}

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
    .filter(h => h && h.kind === "custom" && h.id && h.endDate && Number(h.lengthDays) > 0)
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
