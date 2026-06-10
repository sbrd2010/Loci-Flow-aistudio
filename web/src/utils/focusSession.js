import { buildToggleCompletedTasks } from "./taskOps";

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
// - almost-done: 1% to 15% remaining
// - near-end: 15% to 30% remaining
// - normal: > 30% remaining
export function getTimerState(secondsLeft, maxSeconds) {
  if (secondsLeft <= 0) return "complete";
  const pct = maxSeconds > 0 ? (secondsLeft / maxSeconds) * 100 : 0;
  if (pct <= 15) return "almost-done";
  if (pct <= 30) return "near-end";
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

// Whether the global Focus completion prompt ("Done! +120 XP" / "+50 XP, keep
// going") should be shown. Independent of activeTab so it appears on any page.
export function shouldShowFocusCompletionPrompt({ sessionCompletePending, hasActiveTask }) {
  return !!(sessionCompletePending && hasActiveTask);
}

// Build the updated payload for completing the focused task from the global
// Focus completion prompt's "Done! +120 XP" choice — mirrors the XP and
// contribution rules of the existing in-Today completion flow.
export function buildFocusCompletionPayload(payload, task, todayDateStr) {
  const { tasks = [], config = {}, contributions = [] } = payload;
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
    tasks: buildToggleCompletedTasks(tasks, task.uuid, true, todayDateStr),
    config: { ...config, totalXp: (Number(config.totalXp) || 0) + 120, lastUpdated: Date.now() },
    contributions: nextContributions,
  };
}
