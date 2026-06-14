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

// Coerces an AI-generated value into a string safe for Firebase RTDB validation:
// tasks/$idx/title (1-1000 chars) and tasks/$idx/concreteStep (<=300 chars when
// present) must be strings. A non-string value (e.g. AI returns an array) would
// otherwise fail RTDB's atomic payload validation and block the whole sync write.
export function sanitizeTaskField(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Caps for normalizeAiOrganizeSuggestions — a long/mixed brain-dump entry can
// legitimately split into several tasks, each with several preserved details.
const MAX_SUGGESTIONS = 25;
const MAX_SUGGESTIONS_PER_SOURCE = 8;
const MAX_SUBSTEPS = 7;
const MAX_SUBSTEP_LENGTH = 240;

// Validates and normalizes raw AI Organize suggestions against the current brain
// dump items. Each returned suggestion gets a `sourceId` that is either a valid
// brain-dump item ID (AI correctly referenced it) or null (AI omitted/garbled it).
// Suggestions with invalid horizon or priority are discarded rather than silently
// creating bad tasks. Multiple suggestions may share the same sourceId — a single
// entry can split into several tasks (capped per-source and overall). `subSteps`
// (key details from long entries that would be lost in the short
// title/concreteStep) are normalized the same way as applyAiRewriteToTask's
// subSteps, defaulting to [] when absent or malformed.
export function normalizeAiOrganizeSuggestions(rawSuggestions, brainDumpItems) {
  if (!Array.isArray(rawSuggestions)) return [];
  const validIds = new Set((brainDumpItems || []).map((d) => d.id).filter(Boolean));
  const now = Date.now();
  const sourceCounts = new Map();
  const result = [];

  for (const t of rawSuggestions) {
    if (
      !t ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      !AI_ORGANIZE_VALID_HORIZONS.has(t.horizonLevel) ||
      !AI_ORGANIZE_VALID_PRIORITIES.has(t.priority)
    ) continue;

    // sourceId is only trusted when it maps to a real brain-dump item
    const sourceId = validIds.has(t.sourceId) ? t.sourceId : null;
    if (sourceId) {
      const count = sourceCounts.get(sourceId) || 0;
      if (count >= MAX_SUGGESTIONS_PER_SOURCE) continue;
      sourceCounts.set(sourceId, count + 1);
    }

    const rawSubSteps = t.subSteps;
    const subSteps = Array.isArray(rawSubSteps)
      ? rawSubSteps
          .filter((s) => s && typeof s.text === "string" && s.text.trim())
          .slice(0, MAX_SUBSTEPS)
          .map((s, j) => ({ id: s.id || `ai-ss-${result.length}-${j}-${now}`, text: s.text.trim().slice(0, MAX_SUBSTEP_LENGTH), done: false }))
      : [];

    result.push({
      ...t,
      title: t.title.trim().slice(0, 1000),
      concreteStep: sanitizeTaskField(t.concreteStep, 300),
      sourceId,
      subSteps,
      splitReason: sanitizeTaskField(t.splitReason, 80),
    });

    if (result.length >= MAX_SUGGESTIONS) break;
  }

  return result;
}

// Removes brain-dump items whose ID was explicitly claimed by accepted AI
// suggestions via sourceId — but only once EVERY suggestion generated for that
// source has been accepted. A long entry can split into several suggestions
// sharing one sourceId; accepting only some of them keeps the original entry so
// the unaccepted parts aren't silently lost. `allSuggestions` defaults to
// `acceptedSuggestions` for callers that only ever produce one suggestion per source.
export function buildClearedBrainDump(brainDump, acceptedSuggestions, allSuggestions) {
  const accepted = acceptedSuggestions || [];
  const all = allSuggestions || accepted;

  const totalBySource = new Map();
  for (const t of all) {
    if (!t.sourceId) continue;
    totalBySource.set(t.sourceId, (totalBySource.get(t.sourceId) || 0) + 1);
  }
  const acceptedBySource = new Map();
  for (const t of accepted) {
    if (!t.sourceId) continue;
    acceptedBySource.set(t.sourceId, (acceptedBySource.get(t.sourceId) || 0) + 1);
  }

  const clearedIds = new Set();
  for (const [sourceId, total] of totalBySource) {
    if ((acceptedBySource.get(sourceId) || 0) === total) clearedIds.add(sourceId);
  }
  return (brainDump || []).filter((d) => !clearedIds.has(d.id));
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
