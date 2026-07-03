// Three lightweight, once-per-Loci-day check-ins shown on the Today tab:
// Morning Commitment ("Today's Commitment"), Midday Progress Check
// ("Progress Check"), and End-of-Day Reflection ("Day Close").
//
// Fully deterministic and useful without AI. AI wording (if ever wired up)
// is isolated behind pickCheckinLine — see that function for details.
//
// Built on the flexible focus windows (focusWindows.js) and Morning Ritual
// (morningRitual.js) primitives so there is a single source of truth for
// "Loci day" and "first/last focus window" math.

import { getLociNowMinutes, getOverallSpan, getFocusProgress, getRemainingFocusMinutes } from "./focusWindows";
import { isMorningRitualSlot } from "./morningRitual";
import { countTodayCompletedTasks } from "./deadlineProgressMirror";
import { isDailyDone } from "./deadlineCountdown";

export const MAX_COMMITMENT_TASKS = 3;
const SNOOZE_MS = 90 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Check-in 1: Morning Commitment ("Today's Commitment")
// ─────────────────────────────────────────────────────────────────────────

// Eligible from the same moment Morning Ritual becomes eligible (first focus
// window has opened today, no upper bound), once per Loci day, unless
// skipped, snoozed, or Morning Ritual is still pending (shown first).
export function shouldShowMorningCommitment(now, windows, config = {}, todayStr, morningRitualPending) {
  if (config.dailyCheckinsEnabled === false) return false;
  if (morningRitualPending) return false;
  if (!isMorningRitualSlot(now, windows)) return false;
  if (config.dailyCommitmentDate === todayStr) return false;
  if (config.dailyCommitmentSkippedDate === todayStr) return false;
  const snoozeUntil = config.dailyCommitmentSnoozeUntil;
  if (snoozeUntil && now.getTime() < snoozeUntil) return false;
  return true;
}

// Copy + selection mode for the Morning Commitment card, based on today's task count.
export function buildMorningCommitmentPrompt(todayTasks = []) {
  const count = todayTasks.length;
  if (count === 0) {
    return { title: "Today's Commitment", line: "No tasks for today yet. Add one tiny task to start.", mode: "empty", maxPicks: 0 };
  }
  if (count <= MAX_COMMITMENT_TASKS) {
    return { title: "Today's Commitment", line: "What matters most today?", mode: "choose", maxPicks: count };
  }
  return { title: "Today's Commitment", line: `You have ${count} tasks today. Pick up to 3 non-negotiables.`, mode: "choose", maxPicks: MAX_COMMITMENT_TASKS };
}

// A commitment may only be saved empty when there are zero Today tasks to pick from.
export function canSaveMorningCommitment(selectedIds = [], todayTaskCount) {
  if (todayTaskCount === 0) return true;
  return selectedIds.length >= 1 && selectedIds.length <= MAX_COMMITMENT_TASKS;
}

export function buildMorningCommitmentSave(config = {}, taskIds = [], todayStr, now = Date.now()) {
  return {
    ...config,
    dailyCommitmentDate: todayStr,
    dailyCommitmentTaskIds: taskIds.slice(0, MAX_COMMITMENT_TASKS),
    dailyCommitmentCreatedAt: now,
    dailyCommitmentSource: "morning",
    dailyCommitmentSkippedDate: null,
    dailyCommitmentSnoozeUntil: null,
    lastUpdated: now,
  };
}

export function buildMorningCommitmentSkip(config = {}, todayStr, now = Date.now()) {
  return {
    ...config,
    dailyCommitmentSkippedDate: todayStr,
    dailyCommitmentSnoozeUntil: null,
    lastUpdated: now,
  };
}

export function buildMorningCommitmentSnooze(config = {}, now = Date.now()) {
  return { ...config, dailyCommitmentSnoozeUntil: now + SNOOZE_MS, lastUpdated: now };
}

// ─────────────────────────────────────────────────────────────────────────
// Check-in 2: Midday Progress Check ("Progress Check")
// ─────────────────────────────────────────────────────────────────────────

// Filters committed task IDs down to ones that still exist, aren't deleted, and are
// still on the Today horizon — tasks moved/deleted since the morning are silently
// dropped. Completed tasks remain valid (and still count as "done") since completing
// a task doesn't change its horizon.
export function getValidCommittedTaskIds(tasks = [], taskIds) {
  if (!Array.isArray(taskIds)) return [];
  const validIds = new Set((tasks || []).filter(t => !t.isDeleted && t.horizonLevel === "today").map(t => t.uuid));
  return taskIds.filter(id => validIds.has(id));
}

// Eligible once per Loci day, only once a same-day commitment with at least one
// task exists, and only after the scheduled focus-time midpoint has passed
// (gap-aware — see getFocusProgress for split-window handling).
export function shouldShowMiddayCheck(now, windows, config = {}, todayStr) {
  if (config.dailyCheckinsEnabled === false) return false;
  if (config.dailyMiddayCheckDate === todayStr) return false;
  const snoozeUntil = config.dailyMiddayCheckSnoozeUntil;
  if (snoozeUntil && now.getTime() < snoozeUntil) return false;
  if (config.dailyCommitmentSkippedDate === todayStr) return false;
  if (config.dailyCommitmentDate !== todayStr) return false;
  if (!Array.isArray(config.dailyCommitmentTaskIds) || config.dailyCommitmentTaskIds.length === 0) return false;
  return getFocusProgress(now, windows) >= 0.5;
}

function formatHoursMinutes(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

// Summarizes progress on the morning's committed tasks plus remaining focus time
// today. Missing/deleted committed task IDs are ignored (test 13).
export function buildMiddayProgressSummary(tasks = [], config = {}, now, windows) {
  const validIds = getValidCommittedTaskIds(tasks, config.dailyCommitmentTaskIds);
  const committedTasks = validIds.map(id => tasks.find(t => t.uuid === id)).filter(Boolean);
  const total = committedTasks.length;
  const doneCount = committedTasks.filter(t => t.isCompleted && !t.isDeleted).length;
  const remainingCount = total - doneCount;
  const remainingFocusLabel = formatHoursMinutes(getRemainingFocusMinutes(now, windows));

  let line;
  if (total === 0) {
    line = "Your picks from this morning are no longer on your list. Choose a fresh focus for the rest of the day.";
  } else if (doneCount === total) {
    line = "All your picks are done. Nice work.";
  } else if (doneCount > 0) {
    line = "Keep going — steady progress.";
  } else {
    line = "Keep only one target for the next hour.";
  }

  return {
    title: "Progress Check",
    total,
    doneCount,
    remainingCount,
    remainingFocusLabel,
    countLine: total === 0 ? null : `You picked ${total}. ${doneCount} ${doneCount === 1 ? "is" : "are"} done. ${remainingCount} remain${remainingCount === 1 ? "s" : ""}.`,
    timeLine: `You have about ${remainingFocusLabel} focus time left today.`,
    line,
    showNarrowSuggestion: total > 0 && doneCount === 0,
    committedTasks,
  };
}

export function buildMiddayCheckDone(config = {}, todayStr, now = Date.now()) {
  return { ...config, dailyMiddayCheckDate: todayStr, dailyMiddayCheckSnoozeUntil: null, lastUpdated: now };
}

export function buildMiddayCheckSnooze(config = {}, now = Date.now()) {
  return { ...config, dailyMiddayCheckSnoozeUntil: now + SNOOZE_MS, lastUpdated: now };
}

// "Narrow to one" never edits/moves/completes the underlying task — it only
// records which committed task to highlight as the single next target.
export function buildNarrowToOne(config = {}, taskId, now = Date.now()) {
  return { ...config, dailyCommitmentNarrowedTaskId: taskId, dailyCommitmentNarrowedAt: now, lastUpdated: now };
}

// ─────────────────────────────────────────────────────────────────────────
// Check-in 3: End-of-Day Reflection ("Day Close")
// ─────────────────────────────────────────────────────────────────────────

// Eligible once per Loci day, starting 30 minutes before the final focus
// window closes, with no upper bound (covers "first open after it closed").
// getLociNowMinutes pushes early-morning hours of an overnight window's tail
// past 1440 so this lines up correctly with getOverallSpan's endMin.
export function shouldShowReflection(now, windows, config = {}, todayStr) {
  if (config.dailyCheckinsEnabled === false) return false;
  if (config.dailyReflectionDate === todayStr) return false;
  const lociNow = getLociNowMinutes(now, windows);
  const span = getOverallSpan(windows);
  return lociNow >= span.endMin - 30;
}

export const REFLECTION_MOODS = [
  { key: "better", label: "Better than yesterday" },
  { key: "rough", label: "Rough but moving" },
  { key: "reset", label: "Need a reset" },
];

// Summarizes the day for the reflection card: how the morning's commitment
// went, total Today tasks completed, and (if a key deadline is configured)
// whether today's deadline move was done.
export function buildEndOfDaySummary(tasks = [], config = {}, todayStr) {
  const committedIds = config.dailyCommitmentDate === todayStr ? config.dailyCommitmentTaskIds : [];
  const validIds = getValidCommittedTaskIds(tasks, committedIds);
  const committedTasks = validIds.map(id => tasks.find(t => t.uuid === id)).filter(Boolean);
  const committedTotal = committedTasks.length;
  const committedDone = committedTasks.filter(t => t.isCompleted && !t.isDeleted).length;
  const totalCompletedToday = countTodayCompletedTasks(tasks, todayStr);

  let verdict;
  if (committedTotal > 0 && committedDone === committedTotal) {
    verdict = "You kept your promise today.";
  } else if (committedDone > 0 || totalCompletedToday > 0) {
    verdict = "Partial progress still counts. The day moved.";
  } else {
    verdict = "No verdict. Reset the next move.";
  }

  const hasKeyDeadline = !!(config.deadlineLabel || config.deadlineAction);
  const deadlineMoveDone = hasKeyDeadline ? isDailyDone(config.deadlineDailyDoneDate, todayStr) : null;

  return { title: "Day Close", committedTotal, committedDone, totalCompletedToday, verdict, hasKeyDeadline, deadlineMoveDone };
}

export function buildReflectionSave(config = {}, { mood, note } = {}, todayStr, now = Date.now()) {
  return {
    ...config,
    dailyReflectionDate: todayStr,
    dailyReflectionMood: mood ?? null,
    dailyReflectionNote: typeof note === "string" ? note.trim().slice(0, 280) : "",
    dailyReflectionCompletedAt: now,
    lastUpdated: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Optional AI wording — isolated for later use, never required.
// ─────────────────────────────────────────────────────────────────────────

const LOCAL_CHECKIN_LINES = {
  morningEmpty: "No tasks for today yet. Add one tiny task to start.",
  morningChoose: "Pick what matters most right now.",
  middayAllDone: "All your picks are done. Nice work.",
  middayGood: "Keep going — steady progress.",
  middayBehind: "Keep only one target for the next hour.",
  reflectionAllDone: "You kept your promise today.",
  reflectionPartial: "Partial progress still counts. The day moved.",
  reflectionNone: "No verdict. Reset the next move.",
};

export function getLocalCheckinLine(kind) {
  return LOCAL_CHECKIN_LINES[kind] || "";
}

// Validates an optional AI-generated line for a check-in: must be a short,
// single-sentence, markdown-free string, or the local fallback is used.
// AI never decides data here — at most it rewords an already-correct local
// line. No AI calls happen in this module; a future caller can pass the
// resolved AI string (or omit it) and this stays the single fallback gate.
export function pickCheckinLine(kind, aiLine) {
  const fallback = getLocalCheckinLine(kind);
  if (typeof aiLine !== "string") return fallback;
  const trimmed = aiLine.trim();
  if (!trimmed || trimmed.length > 140) return fallback;
  if (/[\n\r`*_#]/.test(trimmed)) return fallback;
  if ((trimmed.match(/[.!?]/g) || []).length > 2) return fallback;
  return trimmed;
}
