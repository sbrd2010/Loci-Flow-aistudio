import { getRemainingFocusMinutes } from "./focusWindows";

// The header's "WED 23 SEP · 5h40m LEFT" (turn 37 on). Both figures change at
// most once a minute, so callers build this on a minute tick rather than on
// every render. `left` is null once the day's focus windows are used up.
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function buildDayClock(now, windows) {
  const mins = Math.round(getRemainingFocusMinutes(now, windows));
  const h = Math.floor(mins / 60);
  return {
    date: `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`,
    left: mins <= 0 ? null
      : h > 0 ? `${h}h${String(mins % 60).padStart(2, "0")}m`
      : `${mins}m`,
  };
}
