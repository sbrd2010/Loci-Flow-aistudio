import { useEffect, useState } from "react";
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
// Returns { raw, status }.
//
// `status` exists because "the week was empty" and "the week could not be read"
// are different facts, and returning null for both let the screen assert that
// nothing was logged when it had simply never looked — in demo mode, which has
// no uid, and on any refused or failed read. A screen whose entire claim is
// that its figures are real must not do that.
//
//   "loading"     — subscribed, first snapshot not in yet
//   "ready"       — `raw` is what the ledger holds for this window
//   "unavailable" — no uid, or the read was refused/failed
export function useFocusLedger(uid, days = 7, windows) {
  const [state, setState] = useState(() => ({ raw: null, status: uid ? "loading" : "unavailable", uid }));
  // The oldest day in the window, as a plain "YYYY-MM-DD" string. Depending on
  // THIS rather than on `windows` gives both properties at once: a fresh windows
  // array on every render cannot retrigger the subscription (the string is
  // unchanged), but a synced config change that genuinely moves the loci-day
  // boundary does resubscribe. Holding the windows in a ref instead kept a
  // startAt from the old boundary, so a newly included day read back empty
  // until the component remounted.
  const oldest = lociDayWindow(days, new Date(), windows)[0];

  useEffect(() => {
    if (!uid) {
      setState({ raw: null, status: "unavailable", uid });
      return undefined;
    }
    // Cleared only when the USER changes, not on every resubscribe: the day
    // key moves at the loci-day boundary and blanking the screen then would be
    // a flash for no reason. Signing in as someone else must never leave the
    // previous account's minutes on screen while the new read lands.
    setState(prev => (prev.uid === uid ? prev : { raw: null, status: "loading", uid }));
    const eventsQuery = query(
      ref(db, `activityLogs/${uid}/events`),
      orderByKey(),
      startAt(oldest),
    );
    return onValue(
      eventsQuery,
      snapshot => setState({ raw: snapshot.val(), status: "ready", uid }),
      // A refused or failed read must never take the screen down — but it is
      // reported as unavailable rather than as an empty week, so the caller can
      // say "couldn't read this" instead of "you did nothing".
      () => setState({ raw: null, status: "unavailable", uid }),
    );
  }, [uid, oldest]);

  return state;
}
