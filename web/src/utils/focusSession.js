import { buildToggleCompletedTasks } from "./taskOps";
import { getFocusWindows, getLociDayStr } from "./focusWindows";

// Decide whether the floating Focus timer should render on the current screen.
// Hidden on Day Map, when completion is pending, when no session is active,
// and on the dark Focus overlay itself (where the full timer is already shown).
export function shouldShowFloatingTimer({ activeTab, focusSessionActive, hasActiveTask, isFocusMode, sessionCompletePending }) {
  if (activeTab === "daymap") return false;
  if (sessionCompletePending) return false;
  if (!focusSessionActive || !hasActiveTask) return false;
  if (activeTab === "today" && isFocusMode) return false;
  return true;
}

// Calculate the active timer state based on remaining percentage:
// - complete: 0 seconds left
// - almost-done: 1% to 25% remaining
// - near-end: 25% to 50% remaining
// - normal: > 50% remaining
export function getTimerState(secondsLeft, maxSeconds) {
  if (secondsLeft <= 0) return "complete";
  const pct = maxSeconds > 0 ? (secondsLeft / maxSeconds) * 100 : 0;
  if (pct <= 25) return "almost-done";
  if (pct <= 50) return "near-end";
  return "normal";
}

// Build the timer state for restarting the timer on the same task ("Keep going").
export function buildExtendedTimerState(minutes) {
  const secs = Math.max(0, Math.round(minutes)) * 60;
  return { timerMaxSeconds: secs, timerSecondsLeft: secs, isTimerRunning: true };
}

// Build a clean-slate Focus state for when the authenticated account changes
// (login, logout, or switching accounts on the same browser) — guarantees one
// account's timer/session/completion-prompt state can never leak into another's.
export function buildResetFocusState(config = {}) {
  const rawMins = Number(config.pomodoroDurationMinutes);
  const secs = (rawMins > 0 ? rawMins : 25) * 60;
  return {
    isTimerRunning: false,
    timerSecondsLeft: secs,
    timerMaxSeconds: secs,
    isFocusMode: false,
    focusSessionActive: false,
    sessionCompletePending: false,
    showExtendPicker: false,
  };
}

// Whether completing/uncompleting a task should also stop an active Focus session.
export function shouldStopFocusOnComplete(task, isCompleting) {
  return !!(isCompleting && task?.isNowFocus);
}

// Whether the running Focus timer reaching 0:00 should trigger the global
// "session complete" prompt. This lives at the App level (not TodayTab) so it
// fires even while the user is on Roadmap/MindBox/Coach/Settings.
export function shouldTriggerSessionComplete({ isTimerRunning, timerSecondsLeft }) {
  return !!(isTimerRunning && timerSecondsLeft === 0);
}

// K4: the extension the app offers at the 00:00 hold is "the same length as
// the session just run, capped at 20m" — 5m → 5, 10m → 10, 25m → 20, 50m →
// 20. A fixed +20m is the app arguing with a choice the user just made
// deliberately: someone who picked five minutes is not asking for twenty.
// This governs only what the app proposes on the user's behalf; a duration
// they pick themselves is their call and is not clamped here.
export const MAX_EXTEND_MINUTES = 20;
export function extendMinutesForSession(plannedSeconds) {
  const mins = Math.round(Number(plannedSeconds) / 60);
  if (!Number.isFinite(mins)) return MAX_EXTEND_MINUTES;
  // Floor of 1, not of MAX: a sub-minute block offering +20m is the same
  // argument this rule exists to stop, just in the other direction.
  return Math.min(MAX_EXTEND_MINUTES, Math.max(1, mins));
}

// Whether the global Focus completion prompt ("Finish task" / "Keep
// going") should be shown. Independent of activeTab so it appears on any page
// — EXCEPT the Focus session itself, which now carries K4's hold inline.
//
// Addendum D delta 3: "Running out of time is never a failure event — no
// sound, no modal, no auto-close." A modal over the screen whose whole job is
// to hold still at 00:00 is the failure event it rules out, and it would sit
// on top of the two buttons that screen already offers. Everywhere else the
// prompt stays: a bell that rings while the user is on Coach or Plan still
// has to tell them something.
export function shouldShowFocusCompletionPrompt({ sessionCompletePending, hasActiveTask, isFocusMode = false }) {
  return !!(sessionCompletePending && hasActiveTask && !isFocusMode);
}

// Build the updated payload for completing the focused task from the global
// Focus completion prompt's "Finish task" choice — mirrors the
// contribution rules of the existing in-Today completion flow.
export function buildFocusCompletionPayload(payload, task, todayDateStr, date = new Date()) {
  const { tasks = [], config = {}, contributions = [] } = payload;
  const lociTodayStr = getLociDayStr(date, getFocusWindows(config));
  const nextContributions = [...contributions];
  const idx = nextContributions.findIndex((c) => c.dateString === todayDateStr);
  const uid = payload.userId || config.userId || "";
  if (idx === -1) {
    nextContributions.push({ compositeKey: `${uid}_${todayDateStr}`, userId: uid, dateString: todayDateStr, count: 1, lastUpdated: Date.now() });
  } else {
    nextContributions[idx] = { ...nextContributions[idx], count: nextContributions[idx].count + 1, lastUpdated: Date.now() };
  }
  return {
    ...payload,
    tasks: buildToggleCompletedTasks(tasks, task.uuid, true, lociTodayStr),
    contributions: nextContributions,
  };
}
