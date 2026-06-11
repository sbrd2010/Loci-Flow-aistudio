import { getLocalDateString } from "./deadlineCountdown";
import { getLociDayStr, getFocusWindows } from "./focusWindows";

function hasDeadline(config = {}) {
  return !!(config.deadlineLabel || config.deadlineDate || config.deadlineAction);
}

function cloneHistory(history) {
  return history && typeof history === "object" && !Array.isArray(history) ? history : {};
}

function addDays(date, days) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function weekdayLabel(date) {
  return date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2);
}

function statusForDate(config, history, dateStr, todayStr) {
  if (history[dateStr] === "done" || config.deadlineDailyDoneDate === dateStr) return "done";
  if (history[dateStr] === "missed") return "missed";
  if (dateStr === todayStr) return "open";
  return "untracked";
}

function countDoneRun(days, todayStr) {
  const todayIndex = days.findIndex(d => d.dateStr === todayStr);
  if (todayIndex === -1) return 0;

  let run = 0;
  for (let i = todayIndex; i >= 0; i -= 1) {
    const day = days[i];
    if (day.status === "open" && i === todayIndex) continue;
    if (day.status !== "done") break;
    run += 1;
  }
  return run;
}

export function buildDeadlineProgressMirror(config = {}, today = new Date(), dayCount = 7) {
  const windows = getFocusWindows(config);
  const todayStr = getLociDayStr(today, windows);
  const deadlineExists = hasDeadline(config);

  if (!deadlineExists) {
    return {
      hasDeadline: false,
      todayStr,
      days: [],
      doneCount: 0,
      missedCount: 0,
      doneRun: 0,
      tone: "neutral",
      headline: "No key deadline set",
      body: "Set one key deadline in Settings when you want Loci to track your daily move."
    };
  }

  const history = cloneHistory(config.deadlineMoveHistory);

  // Parse todayStr local representation
  const [year, month, day] = todayStr.split("-").map(Number);
  const lociDate = new Date(year, month - 1, day);

  const dayIndex = lociDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const daysToMonday = dayIndex === 0 ? 6 : dayIndex - 1;

  const days = [];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  for (let i = 0; i < 7; i++) {
    const d = new Date(lociDate);
    d.setDate(d.getDate() - daysToMonday + i);
    const dateStr = getLocalDateString(d);

    const dateLabel = `${MONTHS[d.getMonth()]} ${d.getDate()}`;

    days.push({
      dateStr,
      label: weekdayLabel(d),
      dateLabel,
      isToday: dateStr === todayStr,
      status: statusForDate(config, history, dateStr, todayStr)
    });
  }

  const doneCount = days.filter(day => day.status === "done").length;
  const missedCount = days.filter(day => day.status === "missed").length;
  const todayStatus = days.find(day => day.isToday)?.status || "open";
  const doneRun = countDoneRun(days, todayStr);
  const action = (config.deadlineAction || "one real move").trim();
  const label = (config.deadlineLabel || "Key deadline").trim();

  if (todayStatus === "done") {
    return {
      hasDeadline: true,
      todayStr,
      label,
      action,
      days,
      doneCount,
      missedCount,
      doneRun,
      todayStatus,
      tone: "good",
      headline: "Today is protected",
      body: `${action} is marked done. Keep the rest of the day simple.`
    };
  }

  if (missedCount >= 3) {
    return {
      hasDeadline: true,
      todayStr,
      label,
      action,
      days,
      doneCount,
      missedCount,
      doneRun,
      todayStatus,
      tone: "urgent",
      headline: `${missedCount} missed moves in 7 days`,
      body: `No drama, but this is the pattern to interrupt today. Do ${action}.`
    };
  }

  if (missedCount > 0) {
    return {
      hasDeadline: true,
      todayStr,
      label,
      action,
      days,
      doneCount,
      missedCount,
      doneRun,
      todayStatus,
      tone: "watch",
      headline: `${missedCount} missed move${missedCount === 1 ? "" : "s"} this week`,
      body: `Today is still open. One small move keeps the deadline real.`
    };
  }

  return {
    hasDeadline: true,
    todayStr,
    label,
    action,
    days,
    doneCount,
    missedCount,
    doneRun,
    todayStatus,
    tone: "steady",
    headline: "Today is still open",
    body: `Protect the day with ${action}.`
  };
}
