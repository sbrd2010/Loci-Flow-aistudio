import { layoutRoute } from "./dayMapRoute";

// Setting a fixed time (58c–e): the time picker's chips, a preview of the
// route with the time fixed, and the "What moves" sentence that says so
// before you confirm.

const idOf = (t) => String(t.uuid || t.id);

// Six half-hour chips (58d): the picked time's half hour sits fourth, as
// 14:30 does in 13:00 … 15:30. `page` moves the six by three hours
// ("Earlier ←" / "→ Later").
export function timeChips(at, page = 0) {
  const first = Math.floor(at / 30) * 30 - 90 + page * 180;
  return Array.from({ length: 6 }, (_, i) => first + i * 30);
}

// The time a stop would be fixed at by default: where it sits now, or for
// something new, the next 5 minutes from now.
export function defaultFixTime(projectedStart, now) {
  if (Number.isFinite(projectedStart)) return projectedStart;
  return Math.ceil(now / 5) * 5;
}

// Each stop's start and end, by task id, as the engine lays them out.
function spans(stops, opts) {
  const out = new Map();
  for (const r of layoutRoute(stops, opts)) {
    if (r.kind !== "stop") continue;
    const id = idOf(r.task);
    const seen = out.get(id);
    out.set(id, seen ? { ...seen, end: r.end } : { task: r.task, start: r.start, end: r.end });
  }
  return out;
}

// The route before and after `task` is fixed at `at`. `stops` is the route
// in its order; a task not on it yet (unscheduled, or something new) joins
// it at the end.
export function previewFix(stops, task, at, opts) {
  const fixed = { ...task, dayMapFixedMinutes: at };
  const onRoute = stops.some(t => idOf(t) === idOf(task));
  const next = onRoute ? stops.map(t => (idOf(t) === idOf(task) ? fixed : t)) : [...stops, fixed];
  return { before: spans(stops, opts), after: spans(next, opts) };
}

// What moves (58d): the stop that still fits just before the fixed one, the
// first stop that moves and how many more follow it, and where the day now
// ends. Null parts are left out of the sentence.
export function describeFixMoves({ before, after }, task) {
  const id = idOf(task);
  const fixedSpan = after.get(id);
  const others = [...after.entries()].filter(([k]) => k !== id);
  const moved = others
    .filter(([k, s]) => before.has(k) && before.get(k).start !== s.start)
    .sort((a, b) => a[1].start - b[1].start);
  const fits = others
    .filter(([k, s]) => s.end <= fixedSpan.start && !moved.some(([m]) => m === k))
    .sort((a, b) => b[1].end - a[1].end)[0];
  const ends = Math.max(...[...after.values()].map(s => s.end));
  return {
    fits: fits ? { title: fits[1].task.title, start: fits[1].start, end: fits[1].end } : null,
    moved: moved.length
      ? { title: moved[0][1].task.title, from: before.get(moved[0][0]).start, to: moved[0][1].start, more: moved.length - 1 }
      : null,
    movedCount: moved.length,
    dayEnds: ends,
  };
}
