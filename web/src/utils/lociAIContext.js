import { getValidCommittedTaskIds, REFLECTION_MOODS } from "./dailyCoachCheckins";
import { buildDeadlineProgressMirror } from "./deadlineProgressMirror";
import { formatMinutesToTime, getFocusWindows, getLociDayStr } from "./focusWindows";

const HORIZON_ORDER = ["today", "week", "month", "quarter", "halfyear", "office"];

const HORIZON_LABELS = {
  today: "TODAY",
  week: "THIS WEEK",
  month: "THIS MONTH",
  quarter: "QUARTER",
  halfyear: "6 MONTHS",
  office: "WORK"
};

export function isActiveLociTask(task) {
  return !!task && !task.isDeleted && !task.isCompleted && !task.isParked;
}

export function getLocalDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildLociTaskContext(allTasks = [], date = new Date(), windows = getFocusWindows({})) {
  const active = allTasks.filter(isActiveLociTask);
  const lines = [];
  let total = 0;

  for (const horizon of HORIZON_ORDER) {
    const horizonTasks = active.filter(task => task.horizonLevel === horizon);
    if (horizonTasks.length === 0) continue;

    total += horizonTasks.length;
    lines.push(`${HORIZON_LABELS[horizon]} (${horizonTasks.length}):`);
    horizonTasks.slice(0, 8).forEach(task => {
      const focus = task.isNowFocus ? " [NOW FOCUS]" : "";
      const estimate = task.timeEstimateMinutes ? ` (${task.timeEstimateMinutes}min)` : "";
      lines.push(`  - [${task.priority || "P3"}]${focus} ${task.title}${estimate}`);
    });
    if (horizonTasks.length > 8) lines.push(`  ... +${horizonTasks.length - 8} more`);
  }

  const todayStr = getLociDayStr(date, windows);
  const completedToday = allTasks.filter(task => !task.isDeleted && task.isCompleted && task.dateCompletedString === todayStr).length;
  if (completedToday > 0) {
    lines.push(`\nCOMPLETED TODAY: ${completedToday} task${completedToday > 1 ? "s" : ""}`);
  }

  return total === 0 ? "No active tasks yet." : lines.join("\n");
}

export function buildLociAnchorsContext(anchors = [], checkedIds = []) {
  if (!anchors || anchors.length === 0) return "";
  const lines = anchors.map(a => `  [${checkedIds.includes(a.id) ? "✓" : " "}] ${a.text}`);
  return "DAILY ANCHORS:\n" + lines.join("\n");
}

const REFLECTION_NOTE_MAX_LENGTH = 140;

// Strips markdown/newlines and caps length for AI context (separate from the
// 280-char storage cap in buildReflectionSave).
function sanitizeReflectionNoteForContext(note) {
  if (typeof note !== "string") return "";
  const cleaned = note.replace(/[\r\n]+/g, " ").replace(/[`*_#]/g, "").trim();
  if (!cleaned) return "";
  return cleaned.length > REFLECTION_NOTE_MAX_LENGTH
    ? `${cleaned.slice(0, REFLECTION_NOTE_MAX_LENGTH).trim()}...`
    : cleaned;
}

function quoteTitles(titlesList) {
  return titlesList.map(title => `'${title}'`).join(", ");
}

// Short, current-day-only summary of today's Daily Check-in state (Today's
// Commitment, Progress Check, Day Close) for the AI Coach. Returns "" when
// there is nothing to report for today. Reuses getValidCommittedTaskIds from
// dailyCoachCheckins.js so missing/deleted/moved task IDs are handled the
// same way as the check-in cards themselves.
export function buildLociCheckinContext(config = {}, tasks = [], todayStr) {
  const lines = [];

  let committedTasks = [];
  if (config.dailyCommitmentDate === todayStr) {
    const validIds = getValidCommittedTaskIds(tasks, config.dailyCommitmentTaskIds);
    committedTasks = validIds.map(id => tasks.find(t => t.uuid === id)).filter(Boolean);
  }

  if (committedTasks.length > 0) {
    const doneTasks = committedTasks.filter(t => t.isCompleted && !t.isDeleted);
    const remainingTasks = committedTasks.filter(t => !(t.isCompleted && !t.isDeleted));
    const total = committedTasks.length;
    lines.push(`- Commitment: ${total} task${total === 1 ? "" : "s"} selected; ${doneTasks.length} complete, ${remainingTasks.length} remaining.`);

    if (remainingTasks.length > 0) {
      lines.push(`- Remaining committed tasks: ${quoteTitles(remainingTasks.map(t => t.title))}.`);
    }
    if (doneTasks.length > 0) {
      lines.push(`- Completed committed tasks: ${quoteTitles(doneTasks.map(t => t.title))}.`);
    }
    if (config.dailyMiddayCheckDate === todayStr) {
      lines.push("- Progress check: done at midday today.");
    }

    const narrowedTask = committedTasks.find(t => t.uuid === config.dailyCommitmentNarrowedTaskId);
    if (narrowedTask) {
      lines.push(`- Narrowed focus: '${narrowedTask.title}'.`);
    }
  }

  if (config.dailyReflectionDate === todayStr) {
    const moodEntry = REFLECTION_MOODS.find(m => m.key === config.dailyReflectionMood);
    if (moodEntry) {
      lines.push(`- Reflection: ${moodEntry.label}.`);
    }

    const note = sanitizeReflectionNoteForContext(config.dailyReflectionNote);
    if (note) {
      lines.push(`- Tomorrow note: '${note}'.`);
    }
  }

  if (lines.length === 0) return "";

  return [
    "Daily check-in context for today:",
    ...lines,
    "Use this only for supportive coaching. Do not imply judgment."
  ].join("\n");
}

// Snapshot of the live Focus/Pomodoro session so the coach knows the user has
// already started a task instead of asking what to work on next.
export function buildLociFocusSessionContext(focusTimer = {}) {
  const { activeTask, focusSessionActive, isTimerRunning, timerSecondsLeft, timerMaxSeconds } = focusTimer;
  if (!focusSessionActive || !activeTask) return "";

  const elapsedSec = Math.max(0, (timerMaxSeconds || 0) - (timerSecondsLeft || 0));
  const elapsedMin = Math.round(elapsedSec / 60);
  const remainingMin = Math.round((timerSecondsLeft || 0) / 60);

  return [
    `LIVE FOCUS SESSION (${isTimerRunning ? "running" : "paused"}):`,
    `- Working on "${activeTask.title}" — ${elapsedMin} min elapsed, ${remainingMin} min remaining.`,
    "- They have already started this task. Don't ask what to start next; reference this session."
  ].join("\n");
}

// Always-on Key Deadline summary for the AI Coach (previously only surfaced
// during the end-of-day Reflection check-in).
export function buildLociDeadlineContext(config = {}, today = new Date()) {
  if (!config.deadlineLabel && !config.deadlineDate && !config.deadlineAction) return "";

  const label = (config.deadlineLabel || "Key deadline").trim();
  const action = (config.deadlineAction || "one real move").trim();
  const lines = [`KEY DEADLINE: "${label}"`];

  if (config.deadlineDate) {
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const target = new Date(`${config.deadlineDate}T00:00:00`);
    const days = Math.round((target - start) / 86400000);
    if (days > 0) lines.push(`- ${days} day${days === 1 ? "" : "s"} remaining.`);
    else if (days === 0) lines.push("- Due today.");
    else lines.push("- Deadline date has passed.");
  }

  const mirror = buildDeadlineProgressMirror(config, today);
  lines.push(`- Today's move ("${action}"): ${mirror.todayStatus === "done" ? "done" : "not done yet"}.`);
  if (mirror.missedCount > 0) {
    lines.push(`- ${mirror.missedCount} missed move${mirror.missedCount === 1 ? "" : "s"} in the last 7 days.`);
  }
  if (mirror.doneRun > 1) {
    lines.push(`- Current streak: ${mirror.doneRun} day${mirror.doneRun === 1 ? "" : "s"} done in a row.`);
  }

  return lines.join("\n");
}

// Today's planned Day Map route, in order — mirrors the filter/sort used by
// DayMapPage so the coach sees the same route the user laid out.
export function buildLociDayMapContext(tasks = [], todayStr) {
  const scheduled = (tasks || [])
    .filter(t => !t.isDeleted && !t.isParked && t.dayMapDate === todayStr && (t.dayMapOrder != null || !!t.dayMapPeriod))
    .sort((a, b) => {
      const oa = a.dayMapOrder ?? Infinity;
      const ob = b.dayMapOrder ?? Infinity;
      if (oa !== ob) return oa - ob;
      return (a.dayMapStartMinutes ?? 0) - (b.dayMapStartMinutes ?? 0);
    });

  if (scheduled.length === 0) return "";

  const lines = scheduled.map(t => {
    const time = t.dayMapStartMinutes != null ? `${formatMinutesToTime(t.dayMapStartMinutes)} — ` : "";
    const status = t.isCompleted ? "[DONE] " : "";
    return `  ${time}${status}${t.title}`;
  });

  return ["TODAY'S DAY MAP (planned route, in order):", ...lines].join("\n");
}

// Brain Dump backlog size — always-on so the coach knows raw thoughts are
// waiting to be organized, even before the behavioural profile kicks in.
export function buildLociBrainDumpContext(brainDump = []) {
  const count = (brainDump || []).length;
  if (count === 0) return "";
  return `BRAIN DUMP: ${count} unprocessed thought${count === 1 ? "" : "s"} waiting to be organized into tasks.`;
}

// Recent completion velocity (last 3 and 7 days) from the contributions
// heatmap — distinct from the lifetime avgCompletionsPerActiveDay in the
// behavioural profile, this surfaces short-term momentum or a recent stall.
export function buildLociVelocityContext(contributions = [], today = new Date()) {
  if (!contributions || contributions.length === 0) return "";

  const byDate = new Map(contributions.map(c => [c.dateString, Number(c.count) || 0]));
  const sumLastNDays = (n) => {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      total += byDate.get(getLocalDateString(d)) || 0;
    }
    return total;
  };

  const last3 = sumLastNDays(3);
  const last7 = sumLastNDays(7);

  return [
    "COMPLETION VELOCITY:",
    `- Last 3 days: ${last3} task${last3 === 1 ? "" : "s"} completed.`,
    `- Last 7 days: ${last7} task${last7 === 1 ? "" : "s"} completed.`
  ].join("\n");
}

export function buildLociCoreInstruction({ firstName = "friend" } = {}) {
  return `LOCI AI BRAIN - NON-NEGOTIABLE RULES:
- You are Loci's execution coach, not a generic chatbot.
- Help ${firstName} move from planning to action.
- Never use the word "ADHD" in user-facing responses. Say focus challenge, overwhelm, momentum, time awareness, reset, or execution support.
- Use the user's real Loci data when it is provided: Today, Day Map, Roadmap, Brain Dump, Now Focus, Key Deadline, and completed tasks.
- Prefer one tiny next action over long advice.
- Convert vague thoughts into small executable tasks.
- Preserve the user's original meaning. Do not delete, overwrite, or replace user data without clear confirmation.
- If asked for JSON, return valid JSON only.
- Understand Loci horizons: Today, Week, Month, Quarter, 6 Months, Work.
- Be warm, kind, and supportive, but do not fake progress.
- Hold up a mirror only when useful: delayed tasks, repeated over-planning, missed daily moves, or priority overload.
- When holding up the mirror, be direct without shame. Name the pattern, then give one small next move.
- Do not suggest more planning as the default solution. The default solution is a small start.`;
}
