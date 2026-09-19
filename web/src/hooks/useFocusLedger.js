import { useEffect, useRef, useState } from "react";
import { ref, query, orderByKey, startAt, onValue } from "firebase/database";
import { db } from "../firebase";
import { lociDayWindow } from "../utils/focusLedger";

// Subscribes to the focus events the app has always been writing and never
// reading: activityLogs/{uid}/events/{lociDateString}/{eventId}.
//
// The read is BOUNDED. Event days are keyed "YYYY-MM-DD", which sorts
// lexicographically in the same order it sorts chronologically, so orderByKey
// + startAt(oldestDayInWindow) fetches just the window instead of a user's
// entire history. Subscribing to the whole node would work today and get
// steadily worse for exactly the people who use the app most.
//
// Returns the raw { date: { eventId: event } } object for utils/focusLedger to
// aggregate, or null when there is nothing to read — no uid (demo mode has
// none), or the read was refused. Callers treat null as "no minutes yet" and
// render moves instead of durations, which is the addendum's own fallback.
export function useFocusLedger(uid, days = 7, windows) {
  const [raw, setRaw] = useState(null);
  // Held in a ref so a fresh windows array on every render cannot retrigger the
  // subscription. The window only shifts when the day does, and re-reading one
  // extra day is far cheaper than tearing down and rebuilding the listener.
  const windowsRef = useRef(windows);
  windowsRef.current = windows;

  useEffect(() => {
    if (!uid) {
      setRaw(null);
      return undefined;
    }
    const oldest = lociDayWindow(days, new Date(), windowsRef.current)[0];
    const eventsQuery = query(
      ref(db, `activityLogs/${uid}/events`),
      orderByKey(),
      startAt(oldest),
    );
    return onValue(
      eventsQuery,
      snapshot => setRaw(snapshot.val()),
      // A refused or failed read is not an error state worth surfacing: the
      // figures simply fall back to moves. Never let it take the screen down.
      () => setRaw(null),
    );
  }, [uid, days]);

  return raw;
}
