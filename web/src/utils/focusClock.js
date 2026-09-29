// The focus clock (59a; Numbers = 58a–b): what it reads and how the ring is
// drawn. Pure, so the page, and later the focus bar and the mini window
// (59b, 59e), draw the same clock.

// "18:42" or, for a block over 99 minutes, "1:05:42": the part before the
// seconds, and the seconds. From 0:59 left the seconds stand at full size
// and weight (`lastMinute`).
export function clockParts(secondsLeft, maxSeconds) {
  const s = Math.max(0, Math.round(Number(secondsLeft) || 0));
  const hours = Number(maxSeconds) > 99 * 60;
  const pad = (n) => String(n).padStart(2, "0");
  const lead = hours ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}` : pad(Math.floor(s / 60));
  return { lead, seconds: pad(s % 60), hours, lastMinute: s < 60 };
}

// The ring at `size` px: the remaining arc from 12 o'clock, shrinking
// clockwise (its start moves round as time passes). Stroke = size / 48, at
// least 4. The digits: 21% of the size for mm:ss, 16% for h:mm:ss.
export function ringGeometry(size, secondsLeft, maxSeconds, hours = false) {
  const stroke = Math.max(4, size / 48);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Number(maxSeconds) > 0 ? Math.min(1, Math.max(0, Number(secondsLeft) / Number(maxSeconds))) : 0;
  return {
    stroke, r, c,
    dash: `${f * c} ${c}`,
    offset: -(1 - f) * c,
    fontSize: size * (hours ? 0.16 : 0.21),
  };
}
