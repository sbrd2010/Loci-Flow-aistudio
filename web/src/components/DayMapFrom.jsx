import React, { useEffect, useRef, useState } from "react";
import { formatClock24 } from "../utils/dayMapPlan";
import { mergeWindowSpans } from "../utils/focusWindows";
import { currentDayMinutes } from "../hooks/useDayRoute";

// "From [time]" (52d–e): where the route starts, now or later. The Day map
// page and Today's Day map column both show it.
export default function DayMapFrom({ anchorMinutes, onChangeAnchor, windows }) {
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const [actualNow, setActualNow] = useState(() => currentDayMinutes(windows));
  useEffect(() => {
    const id = setInterval(() => setActualNow(currentDayMinutes(windowsRef.current)), 30_000);
    return () => clearInterval(id);
  }, []);

  // Start times run to the end of the day: midnight, or later when the last
  // window runs past it.
  const dayEnd = Math.max(1440, ...mergeWindowSpans(windows).map(([, end]) => end));
  const options = [actualNow];
  for (let m = Math.ceil(actualNow / 15) * 15; m <= actualNow + 600 && m < dayEnd; m += 15) {
    if (m !== actualNow) options.push(m);
  }
  if (!options.includes(anchorMinutes) && anchorMinutes > actualNow) {
    options.push(anchorMinutes);
    options.sort((a, b) => a - b);
  }

  return (
    <label className="dm-from">
      <span className="dm-from-label">From</span>
      <select
        className="dm-from-select"
        value={anchorMinutes}
        onChange={e => onChangeAnchor(Number(e.target.value))}
        aria-label="Route start time"
      >
        {options.map(m => (
          <option key={m} value={m}>{formatClock24(m)}{m === actualNow ? " (now)" : ""}</option>
        ))}
      </select>
    </label>
  );
}
