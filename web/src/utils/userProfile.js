const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeUserProfile(payload) {
  const tasks = (payload.tasks || []).filter(t => !t.isDeleted);
  const contributions = payload.contributions || [];
  const brainDump = payload.brainDump || [];

  const completed = tasks.filter(t => t.isCompleted);
  const active = tasks.filter(t => !t.isCompleted);
  const total = tasks.length;

  const completionRate = total > 0 ? Math.round((completed.length / total) * 100) / 100 : 0;

  // Horizon distribution across active tasks
  const horizonCounts = {};
  active.forEach(t => {
    const h = t.horizonLevel || "today";
    horizonCounts[h] = (horizonCounts[h] || 0) + 1;
  });
  const horizonMix = {};
  Object.entries(horizonCounts).forEach(([h, n]) => {
    horizonMix[h] = active.length > 0 ? Math.round((n / active.length) * 100) / 100 : 0;
  });

  // Priority distribution across all tasks
  const priorityCounts = {};
  tasks.forEach(t => {
    const p = t.priority || "P3";
    priorityCounts[p] = (priorityCounts[p] || 0) + 1;
  });
  const priorityMix = {};
  Object.entries(priorityCounts).forEach(([p, n]) => {
    priorityMix[p] = total > 0 ? Math.round((n / total) * 100) / 100 : 0;
  });

  // Average time estimate (only tasks that have one)
  const tasksWithEstimate = tasks.filter(t => t.timeEstimateMinutes > 0);
  const avgEstimateMinutes = tasksWithEstimate.length > 0
    ? Math.round(tasksWithEstimate.reduce((s, t) => s + t.timeEstimateMinutes, 0) / tasksWithEstimate.length)
    : 0;

  // Completion pattern by day of week (from dateCompletedString on completed tasks)
  const completionsByDay = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  completed.forEach(t => {
    if (t.dateCompletedString) {
      const [y, m, d] = t.dateCompletedString.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      completionsByDay[DAY_NAMES[dow]]++;
    }
  });
  const dayEntries = Object.entries(completionsByDay);
  const bestCompletionDay = dayEntries.reduce((a, b) => b[1] > a[1] ? b : a, ["none", -1])[0];

  // Average completions per day the user was active (from contribution graph)
  const activeDays = contributions.filter(c => c.count > 0);
  const avgCompletionsPerActiveDay = activeDays.length > 0
    ? Math.round((activeDays.reduce((s, c) => s + c.count, 0) / activeDays.length) * 10) / 10
    : 0;

  const dominantHorizon = Object.entries(horizonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "today";

  return {
    totalTasks: total,
    totalCompleted: completed.length,
    totalActive: active.length,
    completionRate,
    dominantHorizon,
    horizonMix,
    priorityMix,
    avgEstimateMinutes,
    completionsByDay,
    bestCompletionDay,
    avgCompletionsPerActiveDay,
    brainDumpPending: brainDump.length,
  };
}

// Turns a stored profile into a plain-text block for Coach system prompts.
// Returns empty string if there isn't enough data yet.
export function profileToCoachContext(profile) {
  if (!profile || profile.totalTasks < 5) return "";

  const rate = Math.round(profile.completionRate * 100);
  const h = profile.dominantHorizon;
  const horizonLabel = {
    today: "day-by-day (lives in Today)", week: "weekly planner", month: "monthly thinker",
    quarter: "quarterly strategist", halfyear: "big-picture thinker", office: "work-focused"
  }[h] || h;

  const lines = [
    `USER BEHAVIOURAL PROFILE (${profile.totalTasks} tasks tracked):`,
    `- Completion rate: ${rate}% (${profile.totalCompleted} completed of ${profile.totalTasks} added)`,
    `- Planning style: ${horizonLabel}`,
  ];

  if (profile.avgEstimateMinutes > 0) lines.push(`- Average task estimate: ${profile.avgEstimateMinutes} min`);
  if (profile.avgCompletionsPerActiveDay > 0) lines.push(`- On active days: completes ~${profile.avgCompletionsPerActiveDay} tasks`);
  if (profile.bestCompletionDay && profile.bestCompletionDay !== "none") lines.push(`- Most productive day of week: ${profile.bestCompletionDay}`);
  if (profile.brainDumpPending > 0) lines.push(`- Brain dump backlog: ${profile.brainDumpPending} unprocessed items`);

  if (rate < 40) lines.push(`- Pattern flag: adds significantly more tasks than completes — likely over-planning`);
  else if (rate > 80) lines.push(`- Pattern flag: high executor — completes most of what is added`);

  const p1Rate = profile.priorityMix?.P1 || 0;
  if (p1Rate > 0.35) lines.push(`- Priority flag: ${Math.round(p1Rate * 100)}% of tasks marked P1 — may be overusing urgency`);

  return lines.join("\n");
}
