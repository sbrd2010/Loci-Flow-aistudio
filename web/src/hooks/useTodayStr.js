import { useState, useEffect } from "react";
import { getLocalDateString } from "../utils/deadlineCountdown";

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
