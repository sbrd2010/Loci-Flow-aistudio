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

// What the key deadline's daily-move state SHOULD be, given today's
// commitments and the current task list. Returns undefined when it has no
// opinion — no key deadline, or nothing committed today.
//
// J3 deleted the Key Deadline strip on the grounds that "the 'today's move'
// line is the commitment itself" — and with it the only two writers of
// deadlineDailyDoneDate, while Day Close, buildExecutionCoachSignal and the
// history mirror all went on reading it. Completing the commitment is that
// move now.
//
// This is a derivation rather than a patch applied at each completion, and
// deliberately so: three separate places in this app write isCompleted, and a
// first attempt that patched only Today's handler left the ordinary
// finish-the-timer path still reporting the move as open. Asking "is any of
// today's commitments complete right now" cannot be missed by a new path, and
// it also means reopening one commitment while another stands doesn't
// wrongly clear it.
export function deriveCommitmentDeadlineMove(config = {}, tasks = [], todayStr) {
  if (!hasDeadline(config) || !todayStr) return undefined;
  const committed = config.dailyCommitmentDate === todayStr && Array.isArray(config.dailyCommitmentTaskIds)
    ? config.dailyCommitmentTaskIds
    : [];
  if (committed.length === 0) return undefined;
  // The horizon predicate matches getValidCommittedTaskIds, which is what Day
  // Close uses: a recorded commitment can later be moved to Week or Month and
  // completed there. Without this, that completion marked the deadline move
  // done while Day Close omitted the same task — two readers of one field
  // disagreeing about what counts.
  const anyDone = (tasks || []).some((t) =>
    t && committed.includes(t.uuid) && t.isCompleted && !t.isDeleted && t.horizonLevel === "today"
  );
  return anyDone ? todayStr : null;
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
