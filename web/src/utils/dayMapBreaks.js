import { breaksFromWindows } from "./dayMapRoute";

// Breaks you add (Q31): "Fixed time → A break". A break lives only on
// today's route — never in Today's list, never counted as work — and goes at
// the end of the Loci day: config.dayMapBreaks = { date, items: [{ kind:
// "break", start, lengthMin }] }. The route stops for it as it does for the
// gap between focus windows, with no buffer and no rounding after it (Q35a).

export const BREAK_LENGTHS = [5, 10, 15, 20, 30, 45, 60, 90];
export const DEFAULT_BREAK_MIN = 15;

const breakName = (config) => (config?.breakName || "").trim() || "Break";

// Today's added breaks, as stored.
export function addedBreaks(config, todayStr) {
  const b = config?.dayMapBreaks;
  if (!b || b.date !== todayStr || !Array.isArray(b.items)) return [];
  return b.items.filter(x => Number.isFinite(Number(x?.start)) && Number(x?.lengthMin) > 0);
}

// Every break the route stops for today: the gaps between focus windows,
// then the ones you added (`added` is the index in today's items).
export function routeBreaks(windows, config, todayStr) {
  const name = breakName(config);
  return [
    ...breaksFromWindows(windows, name),
    ...addedBreaks(config, todayStr).map((x, i) => ({ start: Number(x.start), end: Number(x.start) + Number(x.lengthMin), name, added: i })),
  ];
}

// The config with today's added breaks set to `items`.
export function withAddedBreaks(config, todayStr, items, now = Date.now()) {
  return {
    ...config,
    dayMapBreaks: { date: todayStr, items: items.map(x => ({ kind: "break", start: Number(x.start), lengthMin: Number(x.lengthMin) })) },
    lastUpdated: now,
  };
}

// What a break can't overlap: the fixed stops (from the laid-out rows) and
// every other break — all of `breaks`, shown or not (a lunch gap after the
// last stop has no row, but a later stop would bring it back) — each
// { start, end, title }. `except` is the index of the added break being
// changed, left out.
export function busyFromRows(rows, breaks = [], except = null) {
  return [
    ...rows.filter(r => r.kind === "stop" && r.fixed).map(r => ({ start: r.start, end: r.end, title: r.task.title })),
    ...breaks.filter(b => except == null || b.added !== except).map(b => ({ start: b.start, end: b.end, title: b.name })),
  ].sort((a, b) => a.start - b.start);
}

// A break at `at` for `lengthMin`, fitted around what's busy (Q36.2, Q36a):
// starting inside a fixed stop, it starts when that ends ("Starts at 13:10 ·
// after Call"); running into one, it ends when that starts ("Ends at 12:40 ·
// Call"), down to `min` minutes — shorter than that, it goes after it.
// Returns { start, lengthMin, after, cut } (after/cut: the busy thing's
// title, or null).
export function fitBreak(at, lengthMin, busy, min = 5) {
  let start = at;
  let after = null;
  for (;;) {
    const inside = busy.find(b => b.start <= start && start < b.end);
    if (inside) { start = inside.end; after = inside.title; continue; }
    const next = busy.find(b => b.start > start && b.start < start + lengthMin);
    if (!next) return { start, lengthMin, after, cut: null };
    if (next.start - start >= min) return { start, lengthMin: next.start - start, after, cut: next.title };
    start = next.end;
    after = next.title;
  }
}

// Where a new break goes by default (Q36.1): now, shortened to fit before a
// fixed stop (5 minutes at least). When even that won't do, the "Later…"
// placement.
export function defaultBreak(rows, now, busy = busyFromRows(rows)) { // `now`: the route's start if later
  const fit = fitBreak(now, DEFAULT_BREAK_MIN, busy);
  if (fit.start === now) return fit;
  return fitBreak(nextFreeSlot(rows, now), DEFAULT_BREAK_MIN, busy);
}

// "Later…" (Q36.1, its option a): the next free slot on the route from
// now — the first free time, or the end of a stop, that `lengthMin` fits
// without running into a fixed stop or another break. With nothing on the
// route from now, now (to the next 5 minutes).
export function nextFreeSlot(rows, now, lengthMin = DEFAULT_BREAK_MIN) {
  const busy = rows.filter(r => r.kind === "break" || (r.kind === "stop" && r.fixed));
  const clear = (t) => busy.every(r => r.end <= t || r.start >= t + lengthMin);
  const covered = rows.some(r => r.kind !== "free" && r.start <= now && now < r.end);
  const candidates = [
    ...(covered ? [] : [Math.ceil(now / 5) * 5]),
    ...rows.filter(r => r.kind === "free").map(r => r.start),
    ...rows.filter(r => r.kind === "stop" && !r.continues).map(r => r.end),
  ].filter(t => t >= now).sort((a, b) => a - b);
  const slot = candidates.find(clear);
  if (slot != null) return slot;
  const lastEnd = Math.max(now, ...rows.map(r => r.end));
  return Math.ceil(lastEnd / 5) * 5;
}
