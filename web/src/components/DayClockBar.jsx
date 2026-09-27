import React from "react";
import { formatClock24 } from "../utils/dayMapPlan";

// The day clock's bar (50e–f, 50k): how much of the day has passed, with the
// start, NOW and the end under it. `progress` is dayProgress()'s result.
export default function DayClockBar({ progress }) {
  const nowPct = Math.round(progress.passed * 1000) / 10;
  return (
    <>
      <div
        className="dm-dayclock-bar"
        role="progressbar"
        aria-label="The day so far"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(nowPct)}
        aria-valuetext={`${Math.round(nowPct)}% of the day has passed; it ends at ${formatClock24(progress.end)}`}
      >
        <span className="dm-dayclock-fill" style={{ width: `${nowPct}%` }} />
      </div>
      <div className="dm-dayclock-labels" aria-hidden="true">
        {/* NOW sits exactly where the fill ends. Shifting it by the same
            share of its own width keeps it inside the bar at 0% and 100%;
            near an end, that end's time gives way to it. */}
        <span className={nowPct < 15 ? "is-covered" : undefined}>{formatClock24(progress.start)}</span>
        <span className="dm-dayclock-now" style={{ left: `${nowPct}%`, transform: `translateX(-${nowPct}%)` }}>{formatClock24(progress.now)} NOW</span>
        <span className={nowPct > 85 ? "is-covered" : undefined}>{formatClock24(progress.end)}</span>
      </div>
    </>
  );
}
