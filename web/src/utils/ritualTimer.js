// Computes remaining seconds for the current ritual step using wall-clock time.
// nowMs can be overridden in unit tests; defaults to Date.now().
export function computeRitualSecondsLeft(stepEndAt, nowMs = Date.now()) {
  return Math.max(0, Math.ceil((stepEndAt - nowMs) / 1000));
}

// Returns the next ritual state given the current step index and total step count.
export function nextRitualStep(currentIndex, stepCount) {
  if (currentIndex < stepCount - 1) {
    return { done: false, nextIndex: currentIndex + 1 };
  }
  return { done: true, nextIndex: -1 };
}
