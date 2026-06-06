export function formatCountdown(msLeft) {
  if (typeof msLeft !== "number" || isNaN(msLeft) || msLeft <= 0) return null;
  const totalSecs = Math.floor(msLeft / 1000);
  const dd = Math.floor(totalSecs / 86400);
  const hh = String(Math.floor((totalSecs % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSecs % 60).padStart(2, "0");
  return `${dd}d ${hh}h ${mm}m ${ss}s`;
}

// Format time remaining in today as "09h 32m" (minutes granularity — seconds would be noisy)
export function formatTodayCountdown(msLeft) {
  if (typeof msLeft !== "number" || isNaN(msLeft) || msLeft <= 0) return null;
  const totalMins = Math.floor(msLeft / 60000);
  const hh = String(Math.floor(totalMins / 60)).padStart(2, "0");
  const mm = String(totalMins % 60).padStart(2, "0");
  return `${hh}h ${mm}m`;
}

// Returns true only if the saved date string matches today's date string exactly.
// Any mismatch (next day, undefined, empty) returns false — auto-resets the checkpoint.
export function isDailyDone(savedDate, todayStr) {
  return typeof savedDate === "string" && savedDate.length > 0 && savedDate === todayStr;
}
