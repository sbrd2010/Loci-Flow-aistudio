// Try-out 8/9: the one set of task lengths offered everywhere (Add task and
// the task panel), and the typed "Other" field's reader.
export const ESTIMATE_CHIPS = [5, 15, 25, 30, 45, 60, 90, 120, 180];

// The longest length a typed time may set: a working day.
export const ESTIMATE_MAX = 12 * 60;

export function formatEstimate(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return "None";
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m / 60}h`;
}

// "40", "40m", "40 min", "1h", "1h20", "1h 20m", "1:20", "1.5h", "2 hours"
// → minutes, or null when it isn't a length from 1 minute to 12 hours.
export function parseEstimate(text) {
  const s = String(text ?? "").trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;
  let min = null;
  let m;
  if ((m = s.match(/^(\d+)\s*:\s*(\d{1,2})$/))) {
    min = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/))) {
    if (m[2] && m[1].includes(".")) return null;
    min = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  } else if ((m = s.match(/^(\d+)\s*(?:m|min|mins|minute|minutes)?$/))) {
    min = Number(m[1]);
  }
  if (min == null || !Number.isFinite(min)) return null;
  min = Math.round(min);
  return min >= 1 && min <= ESTIMATE_MAX ? min : null;
}
