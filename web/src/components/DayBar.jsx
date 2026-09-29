import React from "react";
import { formatClock24, formatSpan } from "../utils/dayMapPlan";

// The Day map page's day bar (56a–c): 8px from the day's start to past its
// end. Done up to now, planned from now to the finish, fine red hatching past
// the day end; the start, NOW and DAY ENDS under it, and a legend of three
// words (two when the day fits). `bar` is dayBar()'s result.
export default function DayBar({ bar, now, doneMinutes, plannedMinutes, overBy }) {
  const pct = (share) => `${Math.round(share * 1000) / 10}%`;
  const label = `The day so far: it runs ${formatClock24(bar.start)} to ${formatClock24(bar.end)}; now ${formatClock24(now)}`
    + (bar.over ? `; ${formatSpan(overBy)} past the day end` : "");
  return (
    <div className="dm-daybar">
      <div className="dm-daybar-track" role="img" aria-label={label}>
        <span className="dm-daybar-done" style={{ width: pct(bar.now) }} />
        <span className="dm-daybar-planned" style={{ left: pct(bar.now), width: pct(Math.max(0, bar.finish - bar.now)) }} />
        {bar.over && <span className="dm-daybar-past" style={{ left: pct(bar.dayEnd), width: pct(1 - bar.dayEnd) }} />}
      </div>
      <div className="dm-daybar-labels" aria-hidden="true">
        <span className={bar.now < 0.12 ? "is-covered" : undefined}>{formatClock24(bar.start)}</span>
        <span className="dm-daybar-now" style={{ left: pct(bar.now), transform: `translateX(-${pct(bar.now)})` }}>{formatClock24(now)} NOW</span>
        <span className={`dm-daybar-end${bar.over ? " is-over" : ""}`} style={{ left: pct(bar.dayEnd), transform: `translateX(-${pct(bar.dayEnd)})` }}>
          {Math.abs(bar.dayEnd - bar.now) < 0.12 ? "" : formatClock24(bar.start + (bar.end - bar.start) * bar.dayEnd)}
        </span>
      </div>
      <ul className="dm-daybar-legend" aria-hidden="true">
        {doneMinutes != null && <li><span className="dm-key is-done" />done {formatSpan(doneMinutes)}</li>}
        <li><span className="dm-key is-planned" />planned {formatSpan(plannedMinutes)}</li>
        {bar.over && <li><span className="dm-key is-past" />past your day end {formatSpan(overBy)}</li>}
      </ul>
    </div>
  );
}
