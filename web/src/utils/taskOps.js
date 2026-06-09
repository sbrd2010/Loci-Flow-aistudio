// Merges an AI rewrite suggestion into an existing task, preserving ALL original
// metadata. Only title, concreteStep, subSteps, and lastUpdated may change.
// This is the canonical merge path for the AI rewrite/reword flow.
export function applyAiRewriteToTask(originalTask, aiSuggestion) {
  if (!originalTask || typeof originalTask !== "object") return originalTask;
  const title =
    (typeof aiSuggestion?.title === "string" && aiSuggestion.title.trim()) ||
    originalTask.title;
  const concreteStep =
    (typeof aiSuggestion?.microStep === "string" && aiSuggestion.microStep.trim()) ||
    originalTask.concreteStep ||
    "";
  const rawSubSteps = aiSuggestion?.subSteps;
  const now = Date.now();
  const subSteps =
    Array.isArray(rawSubSteps) && rawSubSteps.length > 0
      ? rawSubSteps
          .filter((s) => s && typeof s.text === "string" && s.text.trim())
          .map((s, i) => ({ id: s.id || `ai-ss-${i}-${now}`, text: s.text.trim(), done: false }))
      : (originalTask.subSteps ?? []);
  return {
    ...originalTask,   // preserves uuid, id, userId, horizonLevel, priority, category,
                       // orderIndex, isCompleted, isDeleted, isParked, isNowFocus, isMVD,
                       // timeEstimateMinutes, dayMap*, reminderAt, dateCompletedString,
                       // and any unknown future fields
    title,
    concreteStep,
    subSteps,
    lastUpdated: now,
  };
}

// Pure helper for the task-completion toggle — extracted for unit-testability.
// TodayTab.handleToggleComplete uses this to build the updated task array.
export function buildToggleCompletedTasks(tasks, taskUuid, isCompleting, dateStr) {
  return tasks.map((t) =>
    t.uuid === taskUuid
      ? {
          ...t,
          isCompleted: isCompleting,
          isNowFocus: false,
          dateCompletedString: isCompleting ? dateStr : null,
          lastUpdated: Date.now(),
        }
      : t
  );
}
