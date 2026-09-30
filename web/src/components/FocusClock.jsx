import React from "react";
import { clockParts, ringGeometry } from "../utils/focusClock";

// The focus clock (59a). A ring by default: the time left in this block as an
// `--accent` arc over a `--panel` track, from 12 o'clock and shrinking
// clockwise, `--edge` while paused; the digits inside. Settings → Focus timer
// → Clock can make it Numbers (58a–b): the digits alone, large, with "Left in
// this block." under them.
export default function FocusClock({ mode = "ring", size, secondsLeft, maxSeconds, paused = false, valueText, caption = "Left in this block." }) {
  const { lead, seconds, hours, lastMinute } = clockParts(secondsLeft, maxSeconds);
  const digits = (
    <span className={`focus-mode-time-digits${lastMinute ? " is-last-minute" : ""}`} aria-hidden="true">
      {lead}:<span className="fm-secs">{seconds}</span>
    </span>
  );
  const progress = {
    role: "progressbar",
    "aria-label": "Session progress",
    "aria-valuemin": 0,
    "aria-valuemax": maxSeconds,
    "aria-valuenow": Math.max(0, maxSeconds - secondsLeft),
    "aria-valuetext": valueText,
  };

  if (mode === "numbers") {
    return (
      <div className={`fm-numbers${paused ? " is-paused" : ""}`} {...progress}>
        {digits}
        <span className="fm-numbers-caption">{caption}</span>
      </div>
    );
  }

  const g = ringGeometry(size, secondsLeft, maxSeconds, hours);
  const mid = size / 2;
  return (
    <div className={`fm-ring${paused ? " is-paused" : ""}`} style={{ width: size, height: size, fontSize: g.fontSize }} {...progress}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="fm-ring-track" cx={mid} cy={mid} r={g.r} strokeWidth={g.stroke} fill="none" />
        {secondsLeft > 0 && <circle
          className="fm-ring-arc"
          cx={mid} cy={mid} r={g.r} strokeWidth={g.stroke} fill="none"
          strokeLinecap="round" strokeDasharray={g.dash} strokeDashoffset={g.offset}
          transform={`rotate(-90 ${mid} ${mid})`}
        />}
      </svg>
      {digits}
    </div>
  );
}

// The small ring (59e–f): the focus bar's 28px ring and the one on Today's
// "Back to focus" — the arc alone, no digits.
export function MiniRing({ size = 28, secondsLeft, maxSeconds, paused = false }) {
  const stroke = Math.max(3, size / 10);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Number(maxSeconds) > 0 ? Math.min(1, Math.max(0, Number(secondsLeft) / Number(maxSeconds))) : 0;
  const mid = size / 2;
  return (
    <svg className={`fm-mini-ring${paused ? " is-paused" : ""}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="fm-ring-track" cx={mid} cy={mid} r={r} strokeWidth={stroke} fill="none" />
      {secondsLeft > 0 && (
        <circle
          className="fm-ring-arc"
          cx={mid} cy={mid} r={r} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${f * c} ${c}`} strokeDashoffset={-(1 - f) * c}
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      )}
    </svg>
  );
}
