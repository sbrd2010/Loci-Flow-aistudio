import { useCallback, useEffect, useRef, useState } from "react";
import { getLociNowMinutes, getOverallSpan, mergeWindowSpans } from "../utils/focusWindows";
import { flattenFocusEvents } from "../utils/focusLedger";
import { RESCUE_STATE, earlyEndsInLastHour, hintLine, rescueHint, settleShown } from "../utils/rescueHint";

// Today's Rescue hint (Q55.2), live. What it watches stays on this device —
// when the one thing became the one thing (or its last session ended) and
// "I'm stuck" presses per task today; what it remembers (shown today, tapped,
// ignored days, off) is in config and syncs (utils/rescueHint.js).

const SINCE_KEY = "loci_one_thing_since";
const STUCK_KEY = "loci_stuck_presses";

function readJSON(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch { return null; }
}
function writeJSON(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function useRescueHint({ config, saveConfigPatch, todayStr, windows, oneThing, focusActive, ledgerRaw, onOpenRescue }) {
  const oneThingId = oneThing ? String(oneThing.uuid || oneThing.id) : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    const onVis = () => { setVisible(document.visibilityState !== "hidden"); setNowMs(Date.now()); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // The clock for "no start": it restarts when the one thing changes and
  // while a session runs on it, so it counts from the session's end.
  const [since, setSince] = useState(() => readJSON(SINCE_KEY));
  useEffect(() => {
    if (!oneThingId) return;
    if (focusActive || since?.uuid !== oneThingId) {
      const next = { uuid: oneThingId, at: Date.now() };
      writeJSON(SINCE_KEY, next);
      setSince(next);
    }
  }, [oneThingId, focusActive, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const [stuck, setStuck] = useState(() => readJSON(STUCK_KEY));
  const stuckCount = stuck?.date === todayStr && oneThingId ? Number(stuck.counts?.[oneThingId]) || 0 : 0;
  const noteStuck = useCallback(() => {
    if (!oneThingId) return;
    const cur = readJSON(STUCK_KEY);
    const counts = cur?.date === todayStr ? { ...cur.counts } : {};
    counts[oneThingId] = (Number(counts[oneThingId]) || 0) + 1;
    const next = { date: todayStr, counts };
    writeJSON(STUCK_KEY, next);
    setStuck(next);
  }, [oneThingId, todayStr]);

  // A day that ended with the hint untapped counts as ignored, once.
  const settledFor = useRef(null);
  useEffect(() => {
    if (settledFor.current === todayStr) return;
    settledFor.current = todayStr;
    const patch = settleShown(config, todayStr);
    if (patch) saveConfigPatch(patch);
  }, [todayStr, config, saveConfigPatch]);

  const lociNow = getLociNowMinutes(new Date(nowMs), windows);
  const hint = rescueHint({
    config, todayStr, nowMs, lociNow,
    dayStart: getOverallSpan(windows).startMin,
    inWindow: mergeWindowSpans(windows).some(([s, e]) => lociNow >= s && lociNow < e),
    focusActive, visible, oneThingId,
    sinceMs: since?.uuid === oneThingId ? since.at : null,
    stuckCount,
    earlyEnds: earlyEndsInLastHour(flattenFocusEvents(ledgerRaw), todayStr, nowMs),
  });

  // The first time it shows today, it's remembered (once a day, every device).
  const recorded = useRef(null);
  useEffect(() => {
    if (!hint?.isNew || recorded.current === todayStr) return;
    recorded.current = todayStr;
    saveConfigPatch({ rescueHintShown: { date: todayStr, kind: hint.kind, minutes: hint.minutes, acted: false } });
  }, [hint?.isNew, hint?.kind, hint?.minutes, todayStr, saveConfigPatch]);

  const act = (open) => {
    if (!hint) return;
    saveConfigPatch({ rescueHintShown: { date: todayStr, kind: hint.kind, minutes: hint.minutes, acted: true }, rescueHintIgnored: 0 });
    if (open) onOpenRescue?.(RESCUE_STATE[hint.kind]);
  };

  return {
    hint: hint && {
      line: hintLine(hint.kind, hint.minutes),
      onOpen: () => act(true),
      onNotToday: () => act(false),
    },
    noteStuck,
  };
}
