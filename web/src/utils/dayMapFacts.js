import { flattenFocusEvents, eventMinutes, MIN_COUNTABLE_MINUTES } from "./focusLedger";
import { getLociNowMinutes } from "./focusWindows";
import { formatClock24, formatSpan } from "./dayMapPlan";

// The Day map page's facts (56a–c, README Q33–Q34): what was done today, the
// one sentence that says where the day stands, and the day bar. Pure, so the
// page only draws them.

// Today's done rows (59j, 57b answer 5), oldest first: one per focus session,
// timed from its start, plus a task ticked done without a session ("marked
// done", no duration, placed by when it was last touched). `raw` is the
// ledger as useFocusLedger reads it.
export function doneToday(raw, tasks, todayStr, windows) {
  const byId = new Map(tasks.map(t => [String(t.uuid || t.id), t]));
  const sessions = flattenFocusEvents(raw)
    .filter(e => e.lociDateString === todayStr && eventMinutes(e) >= MIN_COUNTABLE_MINUTES && Number.isFinite(e.focusStartedAt))
    .map(e => ({
      kind: "session",
      id: e.focusSessionId || e.eventId,
      taskId: e.taskId,
      title: byId.get(String(e.taskId))?.title || "A task since deleted",
      at: e.focusStartedAt,
      start: getLociNowMinutes(new Date(e.focusStartedAt), windows),
      minutes: eventMinutes(e),
    }));
  const withSession = new Set(sessions.map(s => String(s.taskId)));
  const marked = tasks
    .filter(t => t.isCompleted && !t.isDeleted && t.dateCompletedString === todayStr && !withSession.has(String(t.uuid || t.id)))
    .map(t => ({ kind: "marked", id: String(t.uuid || t.id), taskId: String(t.uuid || t.id), title: t.title, at: t.lastUpdated || 0, start: null, minutes: 0 }));
  return [...sessions, ...marked].sort((a, b) => a.at - b.at);
}

// "40 minutes", "1h10m": how far past the day end, in the sentence's words.
function pastBy(minutes) {
  const m = Math.round(minutes);
  return m < 60 ? `${m} ${m === 1 ? "minute" : "minutes"}` : formatSpan(m);
}

// The factual line (Q34.2): the done part, then the finish part; or one of
// three states that replace the whole line (Q33.3 b–d). `doneMinutes` is null
// while the ledger can't be read (loading, demo, a refused read): then the
// done part is left out rather than claiming nothing was done.
// Returns { text, alert, state }: `alert` is the part set in red.
export function factualLine({ doneMinutes, routeEmpty, openTasks, finish, dayEnd, now, left }) {
  if (openTasks === 0 && (doneMinutes || 0) > 0) {
    return { state: "all-done", text: `All done: ${formatSpan(doneMinutes)} today.`, alert: "" };
  }
  if (routeEmpty) return { state: "empty", text: "Nothing on the route.", alert: "" };
  if (now >= dayEnd) {
    const n = left.count;
    return {
      state: "ended",
      text: `Your day ended at ${formatClock24(dayEnd)}. ${n} ${n === 1 ? "task" : "tasks"} left, ${formatSpan(left.minutes)}.`,
      alert: "",
    };
  }
  // A fixed stop whose time has passed but is still open ends "earlier"
  // than now; the finish is never before now (Codex review of #429).
  finish = Math.max(finish, now);
  const done = doneMinutes == null ? "" : doneMinutes > 0 ? `${formatSpan(doneMinutes)} done so far today. ` : "Nothing done yet. ";
  if (finish > dayEnd) {
    return {
      state: "over",
      text: `${done}Keep this order and you finish at ${formatClock24(finish)}, `,
      alert: `${pastBy(finish - dayEnd)} past your day end.`,
    };
  }
  return { state: "on-track", text: `${done}On track: done by ${formatClock24(finish)}.`, alert: "" };
}

// The day bar (56a–c, Q33.2): from the first focus window, or the first
// session if that began earlier, to the later of DAY ENDS and the projected
// finish. Positions are shares of the bar (0–1).
export function dayBar({ windowStart, firstSessionStart = null, now, dayEnd, finish }) {
  const start = Math.min(windowStart, firstSessionStart ?? windowStart, now);
  const end = Math.max(dayEnd, finish ?? dayEnd);
  const span = Math.max(1, end - start);
  const at = (m) => Math.min(1, Math.max(0, (m - start) / span));
  return {
    start, end,
    now: at(now),
    dayEnd: at(dayEnd),
    finish: finish == null ? at(now) : at(Math.max(now, Math.min(finish, dayEnd))),
    over: finish != null && finish > dayEnd,
  };
}
