import { ref, query, orderByKey, startAt, get } from "firebase/database";
import { db } from "../firebase";
import { lociDayWindow } from "./focusLedger";

// One read of the focus log for the last `days` Loci days, for a chat question
// that asks how the period went. The Review screen subscribes with
// useFocusLedger; the chat needs an answer once, now, and must not wait on a slow
// or refused read: past `timeoutMs` it gives up.
//
// Returns the same shape the hook does (`raw`: { [lociDay]: { [id]: event } }),
// or null when the log could not be read, so the caller can say "not available"
// instead of claiming nothing was logged.
const demoLedger = () => (typeof window !== "undefined" && typeof window.__LOCI_DEMO_FOCUS__ === "function" ? window.__LOCI_DEMO_FOCUS__() : null);

export async function readFocusOnce(uid, days, windows, { now = new Date(), timeoutMs = 2000 } = {}) {
  if (!uid) return demoLedger();
  const oldest = lociDayWindow(days, now, windows)[0];
  const read = get(query(ref(db, `activityLogs/${uid}/events`), orderByKey(), startAt(oldest)))
    .then(snapshot => snapshot.val() || {})
    .catch(() => null);
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
