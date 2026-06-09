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

// Valid horizons for the AI Organize flow (includes "office" for Work tasks).
export const AI_ORGANIZE_VALID_HORIZONS = new Set(["today","week","month","quarter","halfyear","office"]);
const AI_ORGANIZE_VALID_PRIORITIES = new Set(["P1","P2","P3","P4"]);

// Validates and normalizes raw AI Organize suggestions against the current brain
// dump items. Each returned suggestion gets a `sourceId` that is either a valid
// brain-dump item ID (AI correctly referenced it) or null (AI omitted/garbled it).
// Suggestions with invalid horizon or priority are discarded rather than silently
// creating bad tasks.
export function normalizeAiOrganizeSuggestions(rawSuggestions, brainDumpItems) {
  if (!Array.isArray(rawSuggestions)) return [];
  const validIds = new Set((brainDumpItems || []).map((d) => d.id).filter(Boolean));
  return rawSuggestions
    .filter(
      (t) =>
        t &&
        typeof t.title === "string" &&
        t.title.trim() &&
        AI_ORGANIZE_VALID_HORIZONS.has(t.horizonLevel) &&
        AI_ORGANIZE_VALID_PRIORITIES.has(t.priority)
    )
    .map((t) => ({
      ...t,
      title: t.title.trim(),
      // sourceId is only trusted when it maps to a real brain-dump item
      sourceId: validIds.has(t.sourceId) ? t.sourceId : null,
    }))
    .slice(0, 10);
}

// Removes brain-dump items whose ID was explicitly claimed by an accepted AI
// suggestion via sourceId. Items without a matching sourceId are never touched,
// preventing title-mismatch false-positives from the old text-compare approach.
export function buildClearedBrainDump(brainDump, acceptedSuggestions) {
  const processedIds = new Set(
    (acceptedSuggestions || [])
      .map((t) => t.sourceId)
      .filter(Boolean)
  );
  return (brainDump || []).filter((d) => !processedIds.has(d.id));
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
