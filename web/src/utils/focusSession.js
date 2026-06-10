// Decide whether the floating Focus timer should render on the current screen.
// Hidden on Day Map, when no session is active, and on the dark Focus overlay itself
// (where the full timer is already shown).
export function shouldShowFloatingTimer({ activeTab, focusSessionActive, hasActiveTask, isFocusMode }) {
  if (activeTab === "daymap") return false;
  if (!focusSessionActive || !hasActiveTask) return false;
  if (activeTab === "today" && isFocusMode) return false;
  return true;
}

// Build the timer state for restarting the timer on the same task ("Keep going").
export function buildExtendedTimerState(minutes) {
  const secs = Math.max(0, Math.round(minutes)) * 60;
  return { timerMaxSeconds: secs, timerSecondsLeft: secs, isTimerRunning: true };
}

// Whether completing/uncompleting a task should also stop an active Focus session.
export function shouldStopFocusOnComplete(task, isCompleting) {
  return !!(isCompleting && task?.isNowFocus);
}
