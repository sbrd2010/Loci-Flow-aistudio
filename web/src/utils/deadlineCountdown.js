export function formatCountdown(msLeft) {
  if (typeof msLeft !== "number" || isNaN(msLeft) || msLeft <= 0) return null;
  const dd = Math.floor(msLeft / 86400000);
  return dd === 0 ? null : `${dd}d`;
}

// Format time remaining in today as "09h 32m" (minutes granularity; seconds would be noisy).
export function formatTodayCountdown(msLeft) {
  if (typeof msLeft !== "number" || isNaN(msLeft) || msLeft <= 0) return null;
  const totalMins = Math.floor(msLeft / 60000);
  const hh = String(Math.floor(totalMins / 60)).padStart(2, "0");
  const mm = String(totalMins % 60).padStart(2, "0");
  return `${hh}h ${mm}m`;
}

// Returns true only if the saved date string matches today's date string exactly.
// Any mismatch (next day, undefined, empty) returns false, so the checkpoint resets daily.
export function isDailyDone(savedDate, todayStr) {
  return typeof savedDate === "string" && savedDate.length > 0 && savedDate === todayStr;
}

export function getLocalDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isValidDateString(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function parseLocalDate(dateStr) {
  if (!isValidDateString(dateStr)) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function addDays(dateStr, days) {
  const parsed = parseLocalDate(dateStr);
  if (!parsed) return null;
  parsed.setDate(parsed.getDate() + days);
  return getLocalDateString(parsed);
}

function isBeforeDate(a, b) {
  const parsedA = parseLocalDate(a);
  const parsedB = parseLocalDate(b);
  if (!parsedA || !parsedB) return false;
  return parsedA.getTime() < parsedB.getTime();
}

function hasDeadline(config = {}) {
  return !!(config.deadlineLabel || config.deadlineDate || config.deadlineAction);
}

function cloneHistory(history) {
  return history && typeof history === "object" && !Array.isArray(history) ? { ...history } : {};
}

// Whether completing or reopening a task changes the key deadline's daily
// move, and to what.
//
// J3 deleted the Key Deadline strip on the grounds that "the 'today's move'
// line is the commitment itself" — and with it the only two writers of
// deadlineDailyDoneDate. Day Close and buildExecutionCoachSignal kept reading
// it, so for anyone with a key deadline the move read as never made no matter
// how much they finished. Completing the commitment is that move.
//
// `tasks` is the list AFTER the toggle, so the answer is simply "is any of
// today's committed tasks complete now" — which keeps reopening one while
// another still stands from wrongly clearing it. Returns an empty patch when
// the toggled task isn't the commitment, or there is no key deadline at all.
export function buildCommitmentDeadlineMovePatch(config = {}, tasks = [], toggledTask = {}, todayStr) {
  if (!hasDeadline(config) || !todayStr) return {};
  const committed = config.dailyCommitmentDate === todayStr && Array.isArray(config.dailyCommitmentTaskIds)
    ? config.dailyCommitmentTaskIds
    : [];
  // The pinned task counts even when nothing recorded it — other paths pin
  // (Day Map, Rescue, the Coach) without going through the wall's own record.
  const relevant = new Set(committed);
  if (toggledTask.isNowFocus && toggledTask.uuid) relevant.add(toggledTask.uuid);
  if (!relevant.has(toggledTask.uuid)) return {};
  const anyDone = tasks.some((t) => t && relevant.has(t.uuid) && t.isCompleted);
  return { deadlineDailyDoneDate: anyDone ? todayStr : null };
}

export function markDeadlineMoveDone(config = {}, todayStr = getLocalDateString()) {
  if (!isValidDateString(todayStr)) return config;
  return {
    ...config,
    deadlineDailyDoneDate: todayStr,
    deadlineMoveHistory: {
      ...cloneHistory(config.deadlineMoveHistory),
      [todayStr]: "done"
    },
    deadlineMoveTrackingStartDate: config.deadlineMoveTrackingStartDate || todayStr,
    deadlineMoveLastCheckedDate: todayStr
  };
}

export function markDeadlineMoveOpen(config = {}, todayStr = getLocalDateString()) {
  if (!isValidDateString(todayStr)) return config;
  const history = cloneHistory(config.deadlineMoveHistory);
  delete history[todayStr];
  return {
    ...config,
    deadlineDailyDoneDate: null,
    deadlineMoveHistory: history,
    deadlineMoveTrackingStartDate: config.deadlineMoveTrackingStartDate || todayStr,
    deadlineMoveLastCheckedDate: todayStr
  };
}

export function buildDeadlineMoveRollover(config = {}, todayStr = getLocalDateString()) {
  if (!hasDeadline(config) || !isValidDateString(todayStr)) return null;

  const history = cloneHistory(config.deadlineMoveHistory);
  const lastChecked = isValidDateString(config.deadlineMoveLastCheckedDate)
    ? config.deadlineMoveLastCheckedDate
    : null;

  if (!lastChecked) {
    return {
      ...config,
      deadlineMoveHistory: history,
      deadlineMoveTrackingStartDate: config.deadlineMoveTrackingStartDate || todayStr,
      deadlineMoveLastCheckedDate: todayStr
    };
  }

  if (!isBeforeDate(lastChecked, todayStr)) return null;

  let cursor = lastChecked;
  let guard = 0;
  while (cursor && isBeforeDate(cursor, todayStr) && guard < 45) {
    if (!history[cursor]) {
      history[cursor] = config.deadlineDailyDoneDate === cursor ? "done" : "missed";
    }
    cursor = addDays(cursor, 1);
    guard += 1;
  }

  return {
    ...config,
    deadlineMoveHistory: history,
    deadlineMoveTrackingStartDate: config.deadlineMoveTrackingStartDate || lastChecked,
    deadlineMoveLastCheckedDate: todayStr
  };
}
