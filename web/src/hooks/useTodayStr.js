import { useState, useEffect } from "react";
import { getLocalDateString } from "../utils/deadlineCountdown";
import { getLociDayStr } from "../utils/focusWindows";

// Components that don't otherwise re-render every second (unlike TodayTab's
// 1s clock tick) can hold a stale "today" string across a midnight rollover
// if left mounted/idle. This hook re-checks periodically and triggers a
// re-render only when the local calendar date actually changes.
export function useTodayStr() {
  const [todayStr, setTodayStr] = useState(getLocalDateString);

  useEffect(() => {
    const id = setInterval(() => {
      setTodayStr((prev) => {
        const next = getLocalDateString();
        return prev === next ? prev : next;
      });
    }, 60000);
    return () => clearInterval(id);
  }, []);

  return todayStr;
}

// The same, for the Loci day: it ends when the last focus window ends, so a
// window running past midnight keeps "today" until then. A minute tick keeps
// an idle screen from holding yesterday.
export function useLociDayStr(windows) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 60000);
    return () => clearInterval(id);
  }, []);
  return getLociDayStr(new Date(), windows);
}
