// Plan 57f (7d-2): the horizon review. When a horizon's period ends, the
// open tasks it held then are its leftovers; the review gives each a place —
// the same horizon's new period (default), Today, or Drop (Q44.3, 57b.11).
// 6 months slides and never ends, so it has no review.
//
// config.horizonReviews[id] = {
//   through: "YYYY-MM-DD",  // the end of the last period dealt with
//   pending: { end, periods, uuids },  // leftovers waiting for review
//   last: { end, kept, today, dropped, at },  // what the last review did (for Coach)
// }
// The first time a horizon is seen it is only noted (no review of tasks it
// held before this existed).
import { BUILT_IN_HORIZONS, currentPeriod, daysBetween, horizonsFromConfig } from "./horizons";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const isOpen = (t) => !t.isDeleted && !t.isCompleted && !t.isParked;
const reviewable = (h) => h.kind !== "sliding6" && !h.hidden;

// week → month → quarter, then the ones you added (57b.22).
function reviewOrder(config, day) {
  const all = horizonsFromConfig(config, day).filter(reviewable);
  const builtIn = BUILT_IN_HORIZONS.map(b => all.find(h => h.id === b.id)).filter(Boolean);
  return [...builtIn, ...all.filter(h => !BUILT_IN_HORIZONS.some(b => b.id === h.id))];
}

// The config.horizonReviews to save, or null when nothing changed.
export function detectReviews(config = {}, tasks = [], day) {
  const saved = config.horizonReviews && typeof config.horizonReviews === "object" ? config.horizonReviews : {};
  const next = { ...saved };
  let changed = false;
  for (const h of reviewOrder(config, day)) {
    const prevEnd = addDays(currentPeriod(h, day).start, -1);
    const rec = saved[h.id];
    if (!rec || !rec.through) { next[h.id] = { ...(rec || {}), through: prevEnd }; changed = true; continue; }
    if (daysBetween(rec.through, prevEnd) <= 0) continue;
    // How many periods ended since (a long absence merges them, 57b.22).
    let periods = 0;
    for (let d = addDays(rec.through, 1); daysBetween(d, prevEnd) >= 0 && periods < 1000; periods++) {
      d = addDays(currentPeriod(h, d).end, 1);
    }
    // A review still waiting takes in what was left this time too (Codex review of #447).
    const openNow = tasks.filter(t => t.horizonLevel === h.id && isOpen(t)).map(t => t.uuid);
    const uuids = [...new Set([...(rec.pending?.uuids || []), ...openNow])];
    next[h.id] = uuids.length
      ? { ...rec, through: prevEnd, pending: { end: prevEnd, periods: (rec.pending?.periods || 0) + periods, uuids } }
      : { ...rec, through: prevEnd, pending: null };
    changed = true;
  }
  return changed ? next : null;
}

// "September", "Q3", "The week to 27 Sep", "2 weeks to 11 Oct".
function periodWords(h, end) {
  const [, m, d] = end.split("-").map(Number);
  if (h.kind === "month") return MONTHS[m - 1];
  if (h.kind === "quarter") return `Q${Math.ceil(m / 3)}`;
  if (h.kind === "week") return `The week to ${d} ${MONTHS[m - 1].slice(0, 3)}`;
  return `${h.name} to ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}
// The tag on a leftover's row: "SEP", "Q3", or its period's end "27 SEP".
function periodTag(h, end) {
  const [, m, d] = end.split("-").map(Number);
  if (h.kind === "month") return SHORT[m - 1];
  if (h.kind === "quarter") return `Q${Math.ceil(m / 3)}`;
  return `${d} ${SHORT[m - 1]}`;
}
function endedLine(h, end, periods) {
  if (periods > 1) {
    const unit = { week: "weeks", month: "months", quarter: "quarters" }[h.kind];
    return unit ? `${periods} ${unit} ended` : `${h.name} ended ${periods} times`;
  }
  return `${periodWords(h, end)} ended`;
}

// The reviews waiting, in order, each with its leftovers still open there.
export function pendingReviews(config = {}, tasks = [], day) {
  const saved = config.horizonReviews || {};
  return reviewOrder(config, day).map(h => {
    const p = saved[h.id]?.pending;
    if (!p?.uuids?.length) return null;
    const ids = new Set(p.uuids);
    const left = tasks.filter(t => ids.has(t.uuid) && t.horizonLevel === h.id && isOpen(t));
    if (!left.length) return null;
    return {
      id: h.id, name: h.name, end: p.end, periods: p.periods || 1, tasks: left,
      title: endedLine(h, p.end, p.periods || 1),
      from: periodWords(h, p.end).replace(/^The /, "").toUpperCase(),
      tag: periodTag(h, p.end),
    };
  }).filter(Boolean);
}

// The leftovers of each horizon, by uuid → tag, for the rows' tags (57b.21).
export function leftoverTags(reviews) {
  const out = new Map();
  for (const r of reviews) for (const t of r.tasks) out.set(t.uuid, r.tag);
  return out;
}

// The review done: each leftover stays (the new period), goes to the top of
// Today tagged "FROM SEPTEMBER" for the day (Q44.5), or is dropped.
export function applyReview(payload, review, choices, day, now = Date.now()) {
  const { tasks = [], config = {} } = payload;
  const counts = { kept: 0, today: 0, dropped: 0 };
  const toToday = review.tasks.filter(t => choices[t.uuid] === "today");
  const top = Math.min(0, ...tasks.filter(t => t.horizonLevel === "today" && isOpen(t)).map(t => t.orderIndex ?? 0));
  const place = new Map(toToday.map((t, i) => [t.uuid, top - toToday.length + i]));
  const next = tasks.map(t => {
    if (!review.tasks.some(x => x.uuid === t.uuid)) return t;
    const c = choices[t.uuid] || "keep";
    if (c === "drop") { counts.dropped++; return { ...t, isDeleted: true, deletedAt: now, isNowFocus: false, lastUpdated: now }; }
    if (c === "today") {
      counts.today++;
      // Today means today: a later day it was put off to no longer holds it back.
      return { ...t, horizonLevel: "today", orderIndex: place.get(t.uuid), deferredUntil: null, reviewFrom: { label: `FROM ${review.from}`, day, horizon: review.id }, lastUpdated: now };
    }
    counts.kept++;
    return t;
  });
  const rec = (config.horizonReviews || {})[review.id] || {};
  return {
    ...payload,
    tasks: next,
    config: { ...config, horizonReviews: { ...(config.horizonReviews || {}), [review.id]: { ...rec, pending: null, last: { end: review.end, ...counts, at: now } } } },
  };
}

// Work · older Sort (57b.27): each to a horizon (default This week) or Drop.
export function applySort(payload, choices, now = Date.now()) {
  const { tasks = [] } = payload;
  const counts = {};
  const nextOrder = (to) => {
    if (counts[to] == null) counts[to] = tasks.filter(t => t.horizonLevel === to && isOpen(t)).length;
    return counts[to]++;
  };
  return {
    ...payload,
    tasks: tasks.map(t => {
      const to = choices[t.uuid];
      if (!to || t.horizonLevel !== "office") return t;
      if (to === "drop") return { ...t, isDeleted: true, deletedAt: now, isNowFocus: false, lastUpdated: now };
      return { ...t, horizonLevel: to, orderIndex: nextOrder(to), lastUpdated: now };
    }),
  };
}

// Undo within 10 s (57b.11): the tasks as they were, and the review record.
export function undoReviewOrSort(payload, before, uuids, reviewId = null) {
  const was = new Map((before.tasks || []).filter(t => uuids.includes(t.uuid)).map(t => [t.uuid, t]));
  const config = reviewId
    ? { ...payload.config, horizonReviews: { ...(payload.config?.horizonReviews || {}), [reviewId]: before.config?.horizonReviews?.[reviewId] } }
    : payload.config;
  return {
    ...payload,
    config,
    tasks: (payload.tasks || []).map(t => (was.has(t.uuid) ? { ...was.get(t.uuid), lastUpdated: Date.now() } : t)),
  };
}
