// Plan 57, 7b: what the ladder, the runway and the open list show. Pure, so
// the page only draws it.
import { currentPeriod, daysBetween, WORK_OLDER_ID } from "./horizons";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const parts = (s) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };

// "SUN 4 OCT", "31 MAR 2027" (another year gets its year).
export function dayLabel(s, today) {
  const p = parts(s);
  const year = today && parts(today).y !== p.y ? ` ${p.y}` : "";
  return `${DAYS[p.dow]} ${p.d} ${MONTHS[p.m - 1]}${year}`;
}
// "SEP", "Q3", "OCT 4" — the runway's short labels.
function shortLabel(h, end) {
  const p = parts(end);
  if (h.kind === "month") return MONTHS[p.m - 1];
  if (h.kind === "quarter") return `Q${Math.ceil(p.m / 3)}`;
  return `${p.d} ${MONTHS[p.m - 1]}`;
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

// The runway (57): today to the furthest end, one tick per end date —
// horizons ending the same day share it, smallest first ("SEP · Q3", 42.3).
// Each tick's place is 0–1 along the line.
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
      at: Math.min(1, Math.max(0, daysBetween(day, end) / span)),
      label: rs.map(r => shortLabel(r, end)).filter((l, i, all) => all.indexOf(l) === i).join(" · "),
      furthest: end === far,
    }));
}

// Which labels fit: TODAY and the furthest always; the others only 45px or
// more from the last label shown (57). A phone shows only the two ends (30).
export function runwayLabelsShown(ticks, widthPx, phone = false) {
  const shown = new Set();
  let last = 0; // TODAY sits at 0
  const far = ticks.find(t => t.furthest);
  const farX = far ? far.at * widthPx : widthPx;
  for (const t of ticks) {
    if (t.furthest) { shown.add(t.end); continue; }
    if (phone) continue;
    const x = t.at * widthPx;
    if (x - last >= 45 && farX - x >= 45) { shown.add(t.end); last = x; }
  }
  return shown;
}

// 42.1: the rung Plan opens on — the last one opened on this device, unless
// it's gone or hidden; then This week.
export function openingRung(rungs, remembered) {
  if (remembered && (remembered === WORK_OLDER_ID || rungs.some(r => r.id === remembered))) return remembered;
  return rungs.some(r => r.id === "week") ? "week" : rungs[0]?.id || null;
}
