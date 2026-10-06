import React from "react";
import TimePicker from "./TimePicker";
import { formatHHMM, minutesOfHHMM, quarterHoursAfter, reminderQuickPicks } from "../../utils/clockText";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Try-out 10/20: one reminder picker wherever a task opens (Add task, the
// task panel on Today, the Day map and Plan). Quick picks first, then the
// day (the browser's date field, in Loci's style) and the time (typed, or a
// quarter-hour to tap). With no reminder set (`active` false) nothing shows
// as chosen, so the panel never looks set when it isn't.
export default function ReminderPicker({ date, time, onChange, active = true, idPrefix = "reminder" }) {
  const now = new Date();
  const today = ymd(now);
  const picks = reminderQuickPicks(now);
  const minutes = minutesOfHHMM(time);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Today: the next quarter-hours from now. Another day: the quarter-hours
  // around the time set.
  const choices = (date === today
    ? quarterHoursAfter(nowMin, 6)
    : quarterHoursAfter(Math.max(-15, (minutes ?? 9 * 60) - 45), 6)
  ).map((m) => ({ minutes: m }));

  return (
    <div className="rp">
      <div className="rp-quick" role="group" aria-label="Quick reminders">
        {picks.map((p) => {
          const on = active && p.date === date && p.time === time;
          return (
            <button key={p.key} type="button" className={`tp-chip rp-pick${on ? " is-on" : ""}`} aria-pressed={on}
              onClick={() => onChange({ date: p.date, time: p.time })}>
              {p.label} <span className="rp-pick-time">{p.time}</span>
            </button>
          );
        })}
      </div>
      <div className="rp-when">
        <label className="rp-date-label">
          <span className="rp-cap">Day</span>
          <input type="date" className="rp-date" aria-label="Reminder date" value={date} min={today}
            onChange={(e) => e.target.value && onChange({ date: e.target.value, time })} />
        </label>
        <div className="rp-time">
          <span className="rp-cap">Time</span>
          <TimePicker
            label="Reminder time"
            idPrefix={`${idPrefix}-time`}
            value={active ? minutes : null}
            choices={choices}
            onChange={(m) => onChange({ date, time: formatHHMM(m) })}
          />
        </div>
      </div>
    </div>
  );
}
