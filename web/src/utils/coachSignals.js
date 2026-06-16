import { getFocusWindows, getLociDayStr } from "./focusWindows";

function getLocalDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isActiveTask(task) {
  return !!task && !task.isDeleted && !task.isCompleted && !task.isParked;
}

function taskEstimate(task) {
  return Number(task?.timeEstimateMinutes) > 0 ? Number(task.timeEstimateMinutes) : 25;
}

function formatTaskTitle(task) {
  return task?.title ? task.title : "the next task";
}

export function getDeadlineMissStreak(config = {}, date = new Date()) {
  const history = config.deadlineMoveHistory || {};
  let streak = 0;

  for (let offset = -1; offset >= -14; offset -= 1) {
    const day = getLocalDateString(addDays(date, offset));
    const status = history[day];
    if (status === "done") break;
    if (status === "missed") {
      streak += 1;
      continue;
    }
    break;
  }

  return streak;
}

export function buildExecutionCoachSignal(payload = {}, date = new Date()) {
  const tasks = payload.tasks || [];
  const config = payload.config || {};
  const todayStr = getLocalDateString(date);
  const lociTodayStr = getLociDayStr(date, getFocusWindows(config));
  const todayTasks = tasks.filter(task => task.horizonLevel === "today" && !task.isDeleted && !task.isParked);
  const activeToday = todayTasks.filter(isActiveTask).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const completedToday = tasks.filter(task => !task.isDeleted && task.isCompleted && task.dateCompletedString === lociTodayStr);
  const nowFocus = activeToday.find(task => task.isNowFocus) || null;
  const dayMapNext = activeToday
    .filter(task => task.dayMapDate === todayStr && task.dayMapOrder != null)
    .sort((a, b) => (a.dayMapOrder ?? 999) - (b.dayMapOrder ?? 999))[0] || null;
  const totalPlannedMinutes = activeToday.reduce((sum, task) => sum + taskEstimate(task), 0);
  const p1Count = activeToday.filter(task => task.priority === "P1").length;

  const hasDeadline = !!(config.deadlineLabel || config.deadlineDate || config.deadlineAction);
  const deadlineDoneToday = config.deadlineDailyDoneDate === lociTodayStr;
  const deadlineMissStreak = getDeadlineMissStreak(config, date);
  const deadlineAction = (config.deadlineAction || "make one visible move").trim();

  if (hasDeadline && !deadlineDoneToday && deadlineMissStreak >= 3 && (!config.deadlineDate || config.deadlineDate >= lociTodayStr)) {
    return {
      shouldShow: true,
      level: "mirror",
      reason: "deadline_missed_three_days",
      title: "Today cannot become another parked day",
      body: `Three deadline moves slipped. Do this first: ${deadlineAction}.`,
      primaryTaskUuid: dayMapNext?.uuid || nowFocus?.uuid || activeToday[0]?.uuid || null
    };
  }

  if (nowFocus) {
    return {
      shouldShow: true,
      level: "anchor",
      reason: "now_focus_active",
      title: "Stay with the pinned task",
      body: `Open ${formatTaskTitle(nowFocus)} and do only the next tiny step.`,
      primaryTaskUuid: nowFocus.uuid || null
    };
  }

  if (dayMapNext) {
    return {
      shouldShow: true,
      level: "anchor",
      reason: "day_map_next_task",
      title: "Follow the route",
      body: `Your next Day Map task is ${formatTaskTitle(dayMapNext)}. Start there.`,
      primaryTaskUuid: dayMapNext.uuid || null
    };
  }

  if (
    config.deadlineDate &&
    config.deadlineDate < lociTodayStr &&
    config.deadlineFollowupAskedFor !== config.deadlineDate
  ) {
    const label = (config.deadlineLabel || "your key deadline").trim();
    return {
      shouldShow: true,
      level: "nudge",
      reason: "deadline_date_passed_followup",
      title: `How did ${label} go?`,
      body: `Your deadline for ${label} has passed. Want to check in on how it went and plan what's next?`,
      primaryTaskUuid: null,
    };
  }

  if (hasDeadline && !deadlineDoneToday) {
    return {
      shouldShow: true,
      level: "nudge",
      reason: "deadline_move_open_today",
      title: "Protect today's move",
      body: `Before the day disappears, make this move: ${deadlineAction}.`,
      primaryTaskUuid: activeToday[0]?.uuid || null
    };
  }

  if (activeToday.length >= 8 && completedToday.length === 0) {
    return {
      shouldShow: true,
      level: "mirror",
      reason: "too_many_today_none_done",
      title: "The list is bigger than the next move",
      body: `There are ${activeToday.length} open tasks today. Pick one and make a two-minute start.`,
      primaryTaskUuid: activeToday[0]?.uuid || null
    };
  }

  if (p1Count >= 4) {
    return {
      shouldShow: true,
      level: "nudge",
      reason: "priority_pressure",
      title: "Too many fires blur the first step",
      body: `${p1Count} P1 tasks are active today. Start with ${formatTaskTitle(activeToday[0])}.`,
      primaryTaskUuid: activeToday[0]?.uuid || null
    };
  }

  if (totalPlannedMinutes >= 360) {
    return {
      shouldShow: true,
      level: "nudge",
      reason: "heavy_today_load",
      title: "Make the day smaller before starting",
      body: `Today has about ${Math.round(totalPlannedMinutes / 60)}h planned. Start with one task, not the whole list.`,
      primaryTaskUuid: activeToday[0]?.uuid || null
    };
  }

  if (activeToday.length > 0) {
    return {
      shouldShow: true,
      level: "quiet",
      reason: "next_task_available",
      title: "One clean start",
      body: `Start with ${formatTaskTitle(activeToday[0])}. Two minutes counts.`,
      primaryTaskUuid: activeToday[0]?.uuid || null
    };
  }

  return {
    shouldShow: false,
    level: "quiet",
    reason: "no_active_today_tasks",
    title: "",
    body: "",
    primaryTaskUuid: null
  };
}
