// Plan 57, 7b: what the ladder, the runway and the open list show. Pure, so
// the page only draws it.
import { currentPeriod, daysBetween, horizonsFromConfig, TODAY_ID, WORK_OLDER_ID } from "./horizons";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const parts = (s) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };

// "SUN 4 OCT", "31 MAR 2027" (another year gets its year).
export function dayLabel(s, today) {
  const p = parts(s);
  const year = today && parts(today).y !== p.y ? ` ${p.y}` : "";
  return `${DAYS[p.dow]} ${p.d} ${MONTHS[p.m - 1]}${year}`;
}

export const isOpenPlanTask = (t) => !t.isDeleted && !t.isCompleted && !t.isParked;

// 42.4: pinned first, then the manual order.
export function byPinThenOrder(a, b) {
  const ap = !!a.isHorizonPinned;
  const bp = !!b.isHorizonPinned;
  if (ap !== bp) return ap ? -1 : 1;
  return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
}

// One rung per visible horizon: its period, days left, open count (42.2),
// how much of the period has gone, red at ≤3 days left; 6 months never ends,
// so its bar is dotted.
export function ladderRungs(tasks, horizons, day) {
  return horizons.filter(h => !h.hidden).map(h => {
    const period = currentPeriod(h, day);
    const total = Math.max(1, daysBetween(period.start, period.end) + 1);
    const gone = Math.min(total, Math.max(0, daysBetween(period.start, day) + 1));
    const daysLeft = Math.max(0, daysBetween(day, period.end));
    return {
      id: h.id,
      name: h.name,
      kind: h.kind,
      period,
      daysLeft,
      count: tasks.filter(t => t.horizonLevel === h.id && isOpenPlanTask(t)).length,
      elapsed: gone / total,
      red: h.kind !== "sliding6" && daysLeft <= 3,
      dotted: h.kind === "sliding6",
    };
  });
}

// Work · older: the old Work horizon's open tasks, until each is sorted.
export const workOlderCount = (tasks) => tasks.filter(t => t.horizonLevel === WORK_OLDER_ID && isOpenPlanTask(t)).length;

// The open list of one horizon (42.4), and its "Done · N" fold (42.2):
// finished in this period, oldest first.
export function listTasks(tasks, id) {
  return tasks.filter(t => t.horizonLevel === id && isOpenPlanTask(t)).sort(byPinThenOrder);
}
export function doneTasks(tasks, id, period) {
  return tasks
    .filter(t => t.horizonLevel === id && t.isCompleted && !t.isDeleted
      && (!period || !t.dateCompletedString || t.dateCompletedString >= period.start))
    .sort((a, b) => String(a.dateCompletedString || "").localeCompare(String(b.dateCompletedString || "")) || (a.lastUpdated || 0) - (b.lastUpdated || 0));
}

// The runway (57, 76): today to the furthest end, one tick per end date —
// horizons ending the same day share it, smallest first ("This month ·
// Work", 42.3). 76: a square-root scale, x = √(days ÷ days to the furthest
// end), so near dates get room and the order stays true. Each tick carries
// its horizons' ids and names and its date ("31 OCT"; "30 APR 2027" in
// another year).
export function runwayTicks(rungs, day) {
  const far = rungs.reduce((m, r) => (r.period.end > m ? r.period.end : m), day);
  const span = Math.max(1, daysBetween(day, far));
  const byEnd = new Map();
  for (const r of rungs) {
    const list = byEnd.get(r.period.end) || [];
    list.push(r);
    byEnd.set(r.period.end, list);
  }
  return [...byEnd.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([end, rs]) => ({
      end,
      at: Math.sqrt(Math.min(1, Math.max(0, daysBetween(day, end) / span))),
      ids: rs.map(r => r.id),
      names: rs.map(r => r.name),
      date: dayLabel(end, day).replace(/^[A-Z]{3} /, ""),
      furthest: end === far,
    }));
}

// "10–11 OCT"; "30 SEP – 2 OCT"; the later end keeps a year it has.
function mergedDate(a, b) {
  const [da, ma, ya] = a.split(" ");
  const [, mb] = b.split(" ");
  if (ma === mb && !ya) return `${da}–${b}`;
  return `${a} – ${b}`;
}

// 76 (turn 77, 1): which labels the runway shows, from their measured boxes.
// `nameWidth(text)` and `dateWidth(text)` measure a label's two lines; a
// label is as wide as the wider. Two neighbours that would come within `gap`
// px merge into one label centred between their ticks. "Today" (at the left)
// and the furthest end (at the right) take part but never merge or drop. The
// open horizon's label always shows; any other label that still collides is
// dropped (its tick stays, and tells its name on hover or focus). A phone
// labels only the two ends (57b.30).
export function runwayLayout(ticks, { width, nameWidth, dateWidth, todayDate, openId = null, phone = false, gap = 12 }) {
  const boxOf = (l) => {
    const w = Math.max(nameWidth(l.names.join(" · ")), dateWidth(l.date));
    if (l.align === "left") return [l.x, l.x + w];
    if (l.align === "right") return [l.x - w, l.x];
    const left = Math.min(Math.max(0, l.x - w / 2), Math.max(0, width - w));
    return [left, left + w];
  };
  const clash = (a, b) => a[0] < b[1] + gap && b[0] < a[1] + gap;
  const today = { key: "today", ends: [], ids: [], names: ["Today"], date: todayDate, x: 0, align: "left", fixed: true, open: false };
  const farTick = ticks.find(t => t.furthest);
  const far = farTick && { key: farTick.end, ends: [farTick.end], ids: farTick.ids, names: farTick.names, date: farTick.date, x: width, align: "right", fixed: true, open: farTick.ids.includes(openId) };
  const middle = phone ? [] : ticks.filter(t => !t.furthest).map(t => ({
    key: t.end, ends: [t.end], ids: t.ids, names: t.names, date: t.date, x: t.at * width, align: "center", open: t.ids.includes(openId),
  }));

  // Neighbours that would collide merge, in pairs, left to right.
  const groups = [];
  for (let i = 0; i < middle.length; i += 1) {
    const a = middle[i];
    const b = middle[i + 1];
    if (b && clash(boxOf(a), boxOf(b))) {
      groups.push({
        key: `${a.key}+${b.key}`, ends: [...a.ends, ...b.ends], ids: [...a.ids, ...b.ids], names: [...a.names, ...b.names],
        date: mergedDate(a.date, b.date), x: (a.x + b.x) / 2, align: "center", open: a.open || b.open,
      });
      i += 1;
    } else groups.push(a);
  }

  // Placed in order of right: the two ends, the open one, then left to right.
  const placed = [today, ...(far ? [far] : [])].map(l => ({ ...l, box: boxOf(l) }));
  // The open one never gives way to a neighbour, but it can't sit on Today or
  // the far end, which stay: it drops a merge-partner first, then slides
  // clear of them as far as the room allows.
  const fitOpen = (g) => {
    const ends = placed.map(p => p.box);
    const free = (box) => !ends.some(e => clash(box, e));
    if (free(boxOf(g))) return g;
    const own = g.ends.length > 1 ? middle.find(m => m.open && g.ends.includes(m.key)) : null;
    if (own && free(boxOf(own))) return { ...own, dropped: g.ends.filter(e => e !== own.key) };
    const l = own || g;
    const [b0, b1] = boxOf(l);
    const lo = placed[0].box[1] + gap;
    const hi = (far ? placed[1].box[0] : width) - gap;
    const shift = b0 < lo ? lo - b0 : b1 > hi ? hi - b1 : 0;
    return { ...l, x: l.x + shift, dropped: own ? g.ends.filter(e => e !== own.key) : [] };
  };
  const order = [...groups.filter(g => g.open), ...groups.filter(g => !g.open)];
  for (const g0 of order) {
    const g = g0.open ? fitOpen(g0) : g0;
    const box = boxOf(g);
    if (g.open || !placed.some(p => clash(box, p.box))) placed.push({ ...g, box });
  }
  const labelled = new Set(placed.flatMap(l => l.ends));
  return {
    labels: placed.sort((a, b) => a.box[0] - b.box[0]).map(({ box, fixed, dropped, ...l }) => ({ ...l, left: box[0], right: box[1] })),
    unlabelled: new Set(ticks.filter(t => !labelled.has(t.end)).map(t => t.end)),
  };
}

// 42.1: the rung Plan opens on — the last one opened on this device, unless
// it's gone or hidden; then This week.
export function openingRung(rungs, remembered) {
  if (remembered && (remembered === WORK_OLDER_ID || rungs.some(r => r.id === remembered))) return remembered;
  return rungs.some(r => r.id === "week") ? "week" : rungs[0]?.id || null;
}

// 57h: the horizon picker — Today, then every visible horizon with its end
// date (red at ≤3 days left; 6 months has no end, so "TO 31 MAR"). Work ·
// older is never offered.
export function horizonChoices(config, day) {
  const visible = horizonsFromConfig(config, day).filter(h => !h.hidden);
  return [
    { id: TODAY_ID, name: "Today", date: null, red: false },
    ...ladderRungs([], visible, day).map(r => ({
      id: r.id,
      name: r.name,
      date: r.dotted ? `TO ${dayLabel(r.period.end, day).replace(/^[A-Z]{3} /, "")}` : dayLabel(r.period.end, day),
      red: r.red,
    })),
  ];
}
