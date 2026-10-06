import React, { useEffect, useRef, useState } from "react";
import { formatClock24 } from "../utils/dayMapPlan";
import { mergeWindowSpans } from "../utils/focusWindows";
import { currentDayMinutes } from "../hooks/useDayRoute";
import { quarterHoursAfter } from "../utils/clockText";
import TimePicker from "./ui/TimePicker";
import { cssZoom } from "../utils/cssZoom";

// "From [time]" (52d–e): where the route starts, now or later. The Day map
// page and Today's Day map column both show it. Try-out 19: in place of the
// browser's long dropdown, a small panel — Now, the next quarter-hours, or
// a typed time. A time before now means after midnight, when the day runs
// past it; the start is never before now nor after the day ends.
export default function DayMapFrom({ anchorMinutes, onChangeAnchor, windows }) {
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const [actualNow, setActualNow] = useState(() => currentDayMinutes(windows));
  useEffect(() => {
    const id = setInterval(() => setActualNow(currentDayMinutes(windowsRef.current)), 30_000);
    return () => clearInterval(id);
  }, []);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  // Fixed under the button, so a scrolling column (Today's Day map view)
  // never cuts it off; rects are screen px, the style is CSS px.
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      const z = cssZoom();
      const width = Math.min(340, window.innerWidth / z - 24);
      setPlace({ top: r.bottom / z + 6, left: Math.max(12, Math.min(r.left / z, window.innerWidth / z - width - 12)), width });
    }
    setOpen(true);
  };

  // Start times run to the end of the day: midnight, or later when the last
  // window runs past it.
  const dayEnd = Math.max(1440, ...mergeWindowSpans(windows).map(([, end]) => end));
  const isNow = anchorMinutes <= actualNow;
  const shown = isNow ? actualNow : anchorMinutes;
  const choices = [
    { minutes: actualNow, label: `Now · ${formatClock24(actualNow)}` },
    ...quarterHoursAfter(actualNow, 7, dayEnd).map(m => ({ minutes: m })),
  ];
  const normalize = (typed) => [typed, typed + 1440].find(m => m >= actualNow && m < dayEnd) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    // Fixed in place, it would float off the button if the page moved.
    const moved = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [open]);

  const pick = (m) => { onChangeAnchor(m); setOpen(false); buttonRef.current?.focus(); };

  return (
    <div
      className="dm-from"
      ref={rootRef}
      onKeyDown={(e) => {
        // Esc in the picker is the picker's own; with it shut, Esc goes on
        // to the page (back to Today).
        if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
      }}
    >
      <span className="dm-from-label" aria-hidden="true">From</span>
      <button
        ref={buttonRef}
        type="button"
        className="dm-from-select"
        aria-label={`Route start time: ${formatClock24(shown)}${isNow ? ", now" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        {formatClock24(shown)}{isNow ? " (now)" : ""}
        <span className="dm-from-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="dm-from-pop" role="dialog" aria-label="Start the route at" style={place || undefined}>
          <TimePicker
            label="Route start"
            idPrefix="dm-from"
            value={shown}
            choices={choices}
            normalize={normalize}
            hint={`Pick a time from now until ${formatClock24(dayEnd)}`}
            onChange={pick}
          />
        </div>
      )}
    </div>
  );
}
