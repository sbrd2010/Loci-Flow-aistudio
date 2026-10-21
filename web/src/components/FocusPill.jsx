import React from "react";
import { MiniRing } from "./FocusClock";

const clock = (s) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};

// 75i / 75k: on Coach Chat the focus bar would cover the composer, so the
// session shows as one pill instead — a 24px ring, the time (or PAUSED, or
// where block end has got to), "Back to focus" and F. In the app header on a
// computer, in the Chat | Review row on a phone. The rest of the bar's
// controls are on the focus page it opens.
export default function FocusPill({ secondsLeft, maxSeconds, isRunning, blockEnd = null, onBack, className = "" }) {
  const phase = blockEnd?.phase || null;
  const ring = phase === "break"
    ? { secondsLeft: blockEnd.breakLeft, maxSeconds: blockEnd.breakSeconds, paused: false }
    : phase ? { secondsLeft: 1, maxSeconds: 1, paused: false }
      : { secondsLeft, maxSeconds, paused: !isRunning };
  const time = phase === "done" ? "BLOCK DONE"
    : phase === "break" ? clock(blockEnd.breakLeft)
      : phase === "over" ? "BREAK’S OVER"
        : isRunning ? clock(secondsLeft) : "PAUSED";
  return (
    <button type="button" className={`focus-pill${className ? ` ${className}` : ""}`} onClick={onBack}>
      <MiniRing size={24} secondsLeft={ring.secondsLeft} maxSeconds={ring.maxSeconds} paused={ring.paused} />
      <span className="focus-pill-time">{time}</span>
      <span className="focus-pill-label">Back to focus</span>
      <kbd className="focus-pill-key" aria-hidden="true">F</kbd>
    </button>
  );
}
