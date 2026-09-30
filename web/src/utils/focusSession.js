import { buildToggleCompletedTasks } from "./taskOps";
import { getFocusWindows, getLociDayStr } from "./focusWindows";

// Whether the focus bar (59e) shows: while a session runs, off the focus
// page — on Plan, Mind Box, Coach and the Day map page. Not on Today while
// its wall shows this session ("Back to focus", 59f); when the wall can't —
// the session's task isn't Today's one thing — the bar stays, or nothing
// would reach the session (Codex review of #434). Never on the focus page,
// nor while a block's end is waiting for an answer.
export function shouldShowFloatingTimer({ activeTab, focusSessionActive, hasActiveTask, isFocusMode, sessionCompletePending, todayShowsSession = true }) {
  if (isFocusMode) return false;
  if (activeTab === "today" && todayShowsSession) return false;
  if (sessionCompletePending) return false;
  if (!focusSessionActive || !hasActiveTask) return false;
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

// A focus session runs in blocks, not the whole estimate (53e, 59j): Start
// runs one block of the Focus timer setting, 25 minutes unless set.
export const DEFAULT_BLOCK_MINUTES = 25;
export function focusBlockSeconds(config = {}) {
  const mins = Number(config.pomodoroDurationMinutes);
  return (mins > 0 ? mins : DEFAULT_BLOCK_MINUTES) * 60;
}

// The start chooser (53e): Start runs one block unless another length is
// picked — 5 minutes, one block (the Focus timer setting), 50 minutes, or the
// whole task when it has an estimate. The choice is remembered (config
// focusStartChoice: 5 | "block" | 50 | "whole"); keys 1–4 follow this order.
export function startLengthOptions(blockMinutes, estimateMinutes) {
  const options = [];
  if (blockMinutes !== 5) options.push({ choice: 5, minutes: 5, label: "5 minutes", sub: "Just start." });
  options.push({ choice: "block", minutes: blockMinutes, label: `${blockMinutes} minutes`, sub: "One block. Default." });
  if (blockMinutes !== 50) options.push({ choice: 50, minutes: 50, label: "50 minutes" });
  // The whole task only when it is estimated, and a length of its own.
  const est = Number(estimateMinutes);
  if (est > 0 && !options.some(o => o.minutes === est)) options.push({ choice: "whole", minutes: est, label: "The whole task" });
  return options;
}

// The length Start runs now: the remembered choice if it is on offer for this
// task (the whole task needs an estimate), otherwise one block.
export function chosenStartOption(choice, blockMinutes, estimateMinutes) {
  const options = startLengthOptions(blockMinutes, estimateMinutes);
  return options.find(o => o.choice === choice) || options.find(o => o.choice === "block");
}

// 59j: a session is one sitting on one task. A pause of 15 minutes or less
// keeps it; a longer one closes it, as does the Loci day ending.
export const PAUSE_EXPIRY_MS = 15 * 60 * 1000;
export const EXPIRY_REASONS = new Set(["paused_too_long", "day_ended"]);

// Why the open session has to close now, or null. `pausedAt` is when it last
// stopped counting (null while running); `dayEndsAt` is when the Loci day it
// began in ends, fixed when it started.
export function focusExpiryReason({ sessionOpen, pausedAt, dayEndsAt, now = Date.now() }) {
  if (!sessionOpen) return null;
  const dayEnded = Number.isFinite(dayEndsAt) && now >= dayEndsAt;
  const pauseRanOut = Number.isFinite(pausedAt) && now - pausedAt > PAUSE_EXPIRY_MS;
  // Both can be true when nothing looked in between (a background tab): the
  // one that happened first is why it closed (Codex review of #419).
  if (pauseRanOut && (!dayEnded || pausedAt + PAUSE_EXPIRY_MS < dayEndsAt)) return "paused_too_long";
  if (dayEnded) return "day_ended";
  return null;
}

// The session's outcome as 59j names it: done, ended (by the user, or the
// block's provisional entry), or expired.
// Expiry comes first: a task marked done after its sitting had already
// expired was not done in that sitting.
export function focusOutcome(type, focusEndReason) {
  if (EXPIRY_REASONS.has(focusEndReason)) return "expired";
  return type === "focus_completed" ? "done" : "ended";
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
  const secs = focusBlockSeconds(config);
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
