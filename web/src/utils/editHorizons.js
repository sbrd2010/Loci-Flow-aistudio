// Plan 57g (7d): Edit horizons — each horizon's rule, adding one (Q45),
// moving a period's end (Q44.4) and deleting one the user added (Q44.3).
// Pure, so the sheet only draws it.
import { BUILT_IN_HORIZONS, currentPeriod, daysBetween, horizonsFromConfig, TODAY_ID } from "./horizons";
import { dayLabel } from "./planLadder";

export const HORIZON_NAME_MAX = 40;
const isBuiltIn = (id) => BUILT_IN_HORIZONS.some(b => b.id === id);
const short = (s, day) => dayLabel(s, day).replace(/^[A-Z]{3} /, "");
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

// The mono rule under each name (57g).
export function horizonRule(h, day) {
  const end = currentPeriod(h, day)?.end;
  switch (h.kind) {
    case "week": return "MON – SUN · REVIEW EACH MONDAY";
    case "month": return "CALENDAR MONTH · REVIEW ON THE 1ST";
    case "quarter": return "CALENDAR QUARTER · REVIEW ON THE 1ST";
    case "sliding6": return "SLIDES MONTHLY · NO REVIEW";
    case "weeks": return `ENDS ${short(end, day)} · REPEATS EVERY ${h.count} WEEKS`;
    case "months": return `ENDS ${short(end, day)} · REPEATS EVERY ${h.count} MONTHS`;
    case "year": return `ENDS ${short(end, day)} · REPEATS EVERY YEAR`;
    case "custom": return `ENDS ${short(end, day)} · REPEATS EVERY ${h.lengthDays} DAYS`;
    default: return "";
  }
}

// Q45: presets at the top; the built-in lengths are not offered.
export const HORIZON_PRESETS = [
  { key: "2w", name: "2 weeks", kind: "weeks", count: 2 },
  { key: "6w", name: "6 weeks", kind: "weeks", count: 6 },
  { key: "2m", name: "2 months", kind: "months", count: 2 },
  { key: "year", name: "This year", kind: "year" },
];

// A new horizon: a preset from today, or "Something else…" — a name and an
// end date, repeating with that length. null when it can't be made.
export function makeHorizon({ preset = null, name, endDate = null }, day, id) {
  const clean = String(name || "").trim().slice(0, HORIZON_NAME_MAX);
  if (!clean || !id) return null;
  if (preset) {
    const p = HORIZON_PRESETS.find(x => x.key === preset);
    if (!p) return null;
    return { id, name: clean, kind: p.kind, ...(p.count ? { count: p.count } : {}), startDate: day, hidden: false };
  }
  if (!endDate || daysBetween(day, endDate) < 0) return null;
  return { id, name: clean, kind: "custom", lengthDays: daysBetween(day, endDate) + 1, startDate: day, hidden: false };
}

// The live sentence under the fields (57g, Q44.4).
export function horizonSentence(h, day) {
  if (!h) return "";
  const p = currentPeriod(h, day);
  const days = daysBetween(day, p.end) + 1;
  const every = h.kind === "custom" ? `another ${h.lengthDays} ${h.lengthDays === 1 ? "day" : "days"}`
    : h.kind === "year" ? "another year"
    : `another ${h.count} ${h.kind === "weeks" ? "weeks" : "months"}`;
  return `${days} ${days === 1 ? "day" : "days"} from today, to ${dayLabel(p.end, day)}. When it ends, you review it and it repeats for ${every}.`;
}

// Q44.4: a new end date for this period only; the kind and length stay, and
// the next period lines back up with the calendar.
export function moveHorizonEnd(h, endDate, day) {
  const p = currentPeriod(h, day);
  if (!p || !endDate || daysBetween(day, endDate) < 0) return null;
  return { ...h, endDate, periodStart: p.start };
}
export function moveSentence(h, endDate, day) {
  const every = h.kind === "custom" ? `${h.lengthDays} days` : h.kind === "year" ? "year" : `${h.count} ${h.kind === "weeks" ? "weeks" : "months"}`;
  return `Ends ${short(endDate, day).replace(/ \d{4}$/, "")}, then every ${every}.`;
}

// Q44.3: deleting a horizon the user added. Its open tasks each need a
// place: the next larger visible horizon (default), Today, or Drop.
export function deleteTargets(config, id, day) {
  const all = horizonsFromConfig(config, day).filter(h => !h.hidden);
  const gone = all.find(h => h.id === id);
  const end = gone ? currentPeriod(gone, day).end : null;
  const larger = all
    .filter(h => h.id !== id && end && currentPeriod(h, day).end > end)
    .sort((a, b) => currentPeriod(a, day).end.localeCompare(currentPeriod(b, day).end))[0];
  return { defaultTo: larger ? larger.id : TODAY_ID, largerName: larger ? larger.name : null };
}

// The payload after the delete: the horizon gone from config.horizons, each
// open task moved (to the bottom of its new list) or dropped.
export function applyHorizonDelete(payload, id, choices, now = Date.now()) {
  const { tasks = [], config = {} } = payload;
  if (isBuiltIn(id)) return payload;
  const horizons = { ...(config.horizons || {}) };
  delete horizons[id];
  const counts = {};
  const nextOrder = (to) => {
    if (counts[to] == null) counts[to] = tasks.filter(t => t.horizonLevel === to && !t.isDeleted && !t.isCompleted).length;
    return counts[to]++;
  };
  return {
    ...payload,
    config: { ...config, horizons },
    tasks: tasks.map(t => {
      const to = choices[t.uuid];
      if (t.horizonLevel !== id || !to) return t;
      if (to === "drop") return { ...t, isDeleted: true, deletedAt: now, isNowFocus: false, lastUpdated: now };
      return { ...t, horizonLevel: to, orderIndex: nextOrder(to), lastUpdated: now };
    }),
  };
}

// Undo within 5 s: the horizon and every task it held, as they were.
export function undoHorizonDelete(payload, before, id) {
  const saved = before.config?.horizons?.[id];
  if (!saved) return payload;
  const was = new Map((before.tasks || []).filter(t => t.horizonLevel === id).map(t => [t.uuid, t]));
  return {
    ...payload,
    config: { ...payload.config, horizons: { ...(payload.config?.horizons || {}), [id]: saved } },
    tasks: (payload.tasks || []).map(t => (was.has(t.uuid) ? { ...was.get(t.uuid), lastUpdated: Date.now() } : t)),
  };
}
