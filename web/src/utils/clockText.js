// Try-out 10/19/20: reading a typed time of day, and the times a picker
// offers to tap. Minutes are from midnight (0–1439).

const pad = (n) => String(n).padStart(2, "0");

export function formatHHMM(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

// "14:30", "14.30", "14h30", "1430", "930", "9", "2pm", "2:30 pm", "12am"
// → minutes, or null.
export function parseClock(text) {
  const s = String(text ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:[:.h](\d{2}))?(am|pm|a|p)?$/) || s.match(/^(\d{1,2})(\d{2})(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    const pm = ampm.startsWith("p");
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  } else if (h > 23) return null;
  return h * 60 + min;
}

// The next `count` quarter-hours after `from` (minutes; may run past
// midnight when `limit` allows, as the Day map's day can).
export function quarterHoursAfter(from, count = 6, limit = 1440) {
  const out = [];
  for (let m = Math.floor(from / 15) * 15 + 15; out.length < count && m < limit; m += 15) out.push(m);
  return out;
}

// "HH:MM" ↔ minutes for the reminder's stored time.
export function minutesOfHHMM(hhmm) {
  const m = String(hhmm || "").match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Reminder quick picks (try-out 10): In 1 hour (to the next 5 minutes),
// This evening 18:00 while it's before 17:30, Tomorrow 09:00, and next
// Monday 09:00 (a week on when today is Monday).
export function reminderQuickPicks(now = new Date()) {
  const picks = [];
  const inHour = new Date(now.getTime() + 60 * 60_000);
  inHour.setSeconds(0, 0);
  inHour.setMinutes(Math.ceil(inHour.getMinutes() / 5) * 5);
  picks.push({ key: "hour", label: "In 1 hour", date: ymd(inHour), time: formatHHMM(inHour.getHours() * 60 + inHour.getMinutes()) });
  if (now.getHours() * 60 + now.getMinutes() < 17 * 60 + 30) {
    picks.push({ key: "evening", label: "This evening", date: ymd(now), time: "18:00" });
  }
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  picks.push({ key: "tomorrow", label: "Tomorrow", date: ymd(tomorrow), time: "09:00" });
  const monday = new Date(now); monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  picks.push({ key: "monday", label: "Monday", date: ymd(monday), time: "09:00" });
  return picks;
}
