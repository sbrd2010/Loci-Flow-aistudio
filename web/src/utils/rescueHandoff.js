import { getFocusWindows } from "./focusWindows";
import { getLociDayStr } from "./dailyAnchors";

const REASON_LABELS = {
  overwhelmed: "overwhelmed",
  tired: "low energy",
  anxious: "anxious",
  distracted: "distracted",
};

const ENTRY_POINT_LABELS = {
  deep_focus: "Deep Focus",
  today: "Home/Today",
  mindbox: "Mind Box",
};

const OUTCOME_LABELS = {
  accepted: "accepted a next step",
  parked: "parked the task",
  timer_started: "started a timer",
  dismissed: "left without resolving it",
  still_stuck: "may still be stuck",
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getLociDay(date = new Date(), config = {}) {
  return getLociDayStr(date, getFocusWindows(config));
}

export function buildRescueHandoffSummary({
  reason,
  task = null,
  entryPoint = "today",
  outcome = "dismissed",
  chatted = false,
  now = new Date(),
  config = {},
} = {}) {
  if (!chatted || !reason) return null;

  const reasonLabel = REASON_LABELS[reason] || cleanText(reason);
  const entryLabel = ENTRY_POINT_LABELS[entryPoint] || ENTRY_POINT_LABELS.today;
  const outcomeLabel = OUTCOME_LABELS[outcome] || OUTCOME_LABELS.dismissed;
  const taskTitle = cleanText(task?.title);
  const taskText = taskTitle ? ` while stuck on "${taskTitle}"` : " without a selected task";
  const text = `Used Rescue Mode from ${entryLabel} earlier today (${reasonLabel}${taskText}) and ${outcomeLabel}.`;

  return {
    text,
    reason,
    taskTitle: taskTitle || null,
    entryPoint,
    outcome,
    lociDay: getLociDay(now, config),
    createdAt: now.getTime(),
  };
}

export function buildRescueHandoffContext(summary, { now = new Date(), config = {} } = {}) {
  if (!summary?.text || summary.consumedAt) return "";
  if (summary.lociDay && summary.lociDay !== getLociDay(now, config)) return "";
  return `RECENT RESCUE MODE HANDOFF:\n${summary.text}\nUse this only as lightweight context. Do not claim you saw the Rescue chat transcript, and do not mention it unless it helps the user's current message.`;
}

// A Coach reply is built from a handoff summary that existed at prompt-build
// time, but the config it eventually clears may have been rewritten (e.g. by
// a newer Rescue session) while the AI call was in flight. Only clear if the
// latest summary is still the same one that was actually used.
export function shouldClearRescueHandoff(latestSummary, usedAt) {
  return usedAt != null && latestSummary?.createdAt === usedAt;
}
