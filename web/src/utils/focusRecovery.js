import { getLociDayStr } from "./focusWindows";

// Durability for the 00:00 hold (K4). #382 made the bell bank the session's
// minutes, but "banked" only meant handed to Firebase's in-memory queue: the
// RTDB *web* client has no durable offline persistence, so a process killed
// during that write loses it — and a process killed BEFORE the bell loses the
// whole session, because nothing about it survived outside React.
//
// This is the other half: a small record in localStorage, written as the
// session's shape changes and drained on the next launch. localStorage is
// synchronous and survives process death, which is the one property the
// Firebase queue does not have.
//
// It deliberately does NOT try to credit a session killed mid-block. We cannot
// know when the process died, and guessing would put invented minutes in the
// user's own time log. K4's promise is about the bell: a block that ran to its
// end is owed its minutes whether or not anyone was watching, and that is
// exactly what this recovers.

export const SNAPSHOT_VERSION = 1;

export function focusSnapshotKey(uid) {
  return `loci_focus_session_v1_${uid}`;
}

// The shape persisted for an open session. Only the task fields the ledger
// actually records are kept — no title, no notes: this sits in localStorage,
// and an event carries a small enum snapshot anyway (see activityLog's
// taskSnapshotFrom).
export function buildFocusSnapshot({
  uid, focusSessionId, focusStartedAt, focusInitialPlannedSeconds,
  accumulatedElapsedSeconds, accumulatedPlannedSeconds, blockPlannedSeconds,
  deadlineAt, bellAt, running, rang, task, entry,
}) {
  if (!uid || !focusSessionId || !task?.uuid) return null;
  return {
    v: SNAPSHOT_VERSION,
    uid,
    focusSessionId,
    focusStartedAt: Number(focusStartedAt) || null,
    focusInitialPlannedSeconds: Number(focusInitialPlannedSeconds) || 0,
    accumulatedElapsedSeconds: Number(accumulatedElapsedSeconds) || 0,
    accumulatedPlannedSeconds: Number(accumulatedPlannedSeconds) || 0,
    blockPlannedSeconds: Number(blockPlannedSeconds) || 0,
    deadlineAt: Number(deadlineAt) || null,
    bellAt: Number(bellAt) || null,
    running: !!running,
    rang: !!rang,
    task: {
      uuid: task.uuid,
      ...(task.category ? { category: task.category } : {}),
      ...(task.priority ? { priority: task.priority } : {}),
      ...(task.horizonLevel ? { horizonLevel: task.horizonLevel } : {}),
    },
    entry: entry?.eventId && entry?.lociDateString
      ? { eventId: entry.eventId, lociDateString: entry.lociDateString }
      : null,
  };
}

// The moment the block ended, or null if it has not. Two ways a bell is owed:
// it fired and we may not have finished writing it (rang), or it never fired
// because the process died first, but the deadline has since passed.
export function bellMomentFor(snapshot, now = Date.now()) {
  if (!snapshot) return null;
  if (snapshot.rang) return snapshot.bellAt || snapshot.deadlineAt || null;
  if (!snapshot.running || !snapshot.deadlineAt) return null;
  // Still mid-block when the process died. We cannot know how long they
  // actually worked, and inventing a figure is worse than recording none.
  if (Number(now) < snapshot.deadlineAt) return null;
  return snapshot.deadlineAt;
}

// What the next launch owes the ledger for a session it found abandoned:
// the arguments for one terminal event, or null when nothing is owed.
//
// Timestamped at the BELL, never at the recovery. A session whose block ended
// on Tuesday night must land on Tuesday's Loci day even if the app is next
// opened on Friday — every figure downstream buckets by lociDateString.
export function recoverableFocusEntry(snapshot, { uid, now = Date.now(), windows } = {}) {
  if (!snapshot || snapshot.v !== SNAPSHOT_VERSION) return null;
  // Never recover one account's session into another's ledger.
  if (!uid || snapshot.uid !== uid) return null;
  const bellAt = bellMomentFor(snapshot, now);
  if (!bellAt) return null;
  const blockSeconds = snapshot.blockPlannedSeconds;
  if (!(blockSeconds > 0)) return null;
  return {
    task: snapshot.task,
    focusSessionId: snapshot.focusSessionId,
    options: {
      focusStartedAt: snapshot.focusStartedAt,
      focusInitialPlannedSeconds: snapshot.focusInitialPlannedSeconds,
      focusFinalPlannedSeconds: snapshot.accumulatedPlannedSeconds + blockSeconds,
      // The block ran to its end, so its whole planned length is elapsed —
      // that is what reaching 00:00 means.
      focusElapsedSeconds: snapshot.accumulatedElapsedSeconds + blockSeconds,
      focusEndReason: "timer_elapsed_recovered",
      now: bellAt,
      windows,
      // Reuse the identity the bell pinned, so this AMENDS that entry rather
      // than adding a second one for the same session. When the process died
      // before the bell there is no pinned entry, so one is derived from the
      // session id: deterministic, so a second recovery of the same snapshot
      // lands on the same path instead of duplicating it.
      eventId: snapshot.entry?.eventId || snapshot.focusSessionId,
      lociDateString: snapshot.entry?.lociDateString
        || (windows ? getLociDayStr(new Date(bellAt), windows) : undefined),
    },
  };
}

// localStorage can throw (private mode, blocked site data) and can hold
// something another version wrote. Every read and write is defensive, and a
// record that cannot be parsed is treated as absent rather than fatal.
export function readFocusSnapshot(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(focusSnapshotKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.v === SNAPSHOT_VERSION ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function writeFocusSnapshot(uid, snapshot) {
  if (!uid) return false;
  try {
    if (!snapshot) {
      localStorage.removeItem(focusSnapshotKey(uid));
      return true;
    }
    localStorage.setItem(focusSnapshotKey(uid), JSON.stringify(snapshot));
    return true;
  } catch (_) {
    return false;
  }
}

export function clearFocusSnapshot(uid) {
  return writeFocusSnapshot(uid, null);
}
