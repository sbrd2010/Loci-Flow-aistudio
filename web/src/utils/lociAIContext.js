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

export function buildLociTaskContext(allTasks = [], date = new Date()) {
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

  const todayStr = getLocalDateString(date);
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
