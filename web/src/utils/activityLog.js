import { safeUUID } from "./uuid";
import { getLociDayStr, getFocusWindows } from "./focusWindows";

// Storage lives at activityLogs/${uid}/... — a separate root the normal
// sync/${uid} listener never subscribes to, so ordinary app startup never
// downloads ledger history. See CLAUDE.md / the Insights plan for the full
// rationale.

// getLociDayStr expects a Date instance (every existing call site in the
// codebase passes one), but these builders accept `now` as either a Date or
// an epoch-ms number for caller convenience — normalize both ways so
// utcTimestamp/focusStartedAt/etc. stay epoch-ms while lociDateString still
// gets a real Date. `windows` also has no safe default inside
// getLociDayStr itself (it calls .some() on it unconditionally), so default
// to getFocusWindows() here — the same fallback the rest of the app uses
// for an unconfigured focus window.
function toEpochMs(now) {
  return now instanceof Date ? now.getTime() : now;
}
function toDateObj(now) {
  return now instanceof Date ? now : new Date(now);
}
function resolveWindows(windows) {
  return windows || getFocusWindows();
}

export function activityEventPath(uid, lociDateString, eventId) {
  return `activityLogs/${uid}/events/${lociDateString}/${eventId}`;
}

export function activitySnapshotPath(uid, lociDateString) {
  return `activityLogs/${uid}/snapshots/${lociDateString}`;
}

export function activityMetaPath(uid, key) {
  return `activityLogs/${uid}/meta/${key}`;
}

// Wraps a single event as a fully-qualified {path: event} patch, ready to
// pass straight to writeActivityEvents(). Every write-path call site uses
// this (or eventsPatch below for a batch) instead of building the path by
// hand, so the path shape only lives in one place.
export function eventPatch(uid, event) {
  return { [activityEventPath(uid, event.lociDateString, event.eventId)]: event };
}

// Same as eventPatch, but for several events written together in one
// analytics-only update() call — e.g. a batch action like Bad Day Reset
// where every affected task gets its own event, written together once the
// core batch write confirms.
export function eventsPatch(uid, events) {
  const patch = {};
  for (const event of events) {
    patch[activityEventPath(uid, event.lociDateString, event.eventId)] = event;
  }
  return patch;
}

// Small-enum classification of a task, attached to events for future
// analytics grouping — deliberately never titles/notes/free text (Firebase
// Spark-plan storage efficiency, and this leaves the task's own record).
// A field missing on the task is simply omitted here, not fabricated as a
// default — RTDB rejects `undefined` outright, and inventing "Personal"/
// "P3"/"today" for a task that never actually had one would misrepresent
// what's genuinely known, the same sparse-and-honest rule fromState/toState
// already follow below.
function taskSnapshotFrom(task) {
  const snapshot = {};
  if (task.category) snapshot.category = task.category;
  if (task.priority) snapshot.priority = task.priority;
  if (task.horizonLevel) snapshot.horizonLevel = task.horizonLevel;
  return snapshot;
}

// Builds a sparse task-mutation event. Firebase RTDB rejects `undefined`
// values outright, and even if it didn't, padding every event with every
// possible field defeats the point of a sparse ledger — fromState/toState
// are only included when the caller actually supplies them, never a
// generic diff of the whole task.
export function buildTaskMutationEvent(type, task, { fromState, toState, source = "user", now = Date.now(), windows } = {}) {
  const nowMs = toEpochMs(now);
  const event = {
    eventId: safeUUID(),
    schemaVersion: 1,
    type,
    utcTimestamp: nowMs,
    lociDateString: getLociDayStr(toDateObj(now), resolveWindows(windows)),
    taskId: task.uuid,
    source,
    taskSnapshot: taskSnapshotFrom(task),
  };
  if (fromState !== undefined) event.fromState = fromState;
  if (toState !== undefined) event.toState = toState;
  return event;
}

// Builds a "focus_started" event — a distinct shape from task-mutation
// events (no fromState/toState), correlated to its eventual terminal event
// via focusSessionId.
export function buildFocusStartedEvent(task, focusSessionId, { source = "user", focusInitialPlannedSeconds, now = Date.now(), windows } = {}) {
  const nowMs = toEpochMs(now);
  return {
    eventId: safeUUID(),
    schemaVersion: 1,
    type: "focus_started",
    utcTimestamp: nowMs,
    lociDateString: getLociDayStr(toDateObj(now), resolveWindows(windows)),
    taskId: task.uuid,
    focusSessionId,
    focusStartedAt: nowMs,
    focusInitialPlannedSeconds,
    source,
    taskSnapshot: taskSnapshotFrom(task),
  };
}

// Builds a terminal focus event ("focus_completed" or "focus_abandoned").
// focusStartedAt/focusInitialPlannedSeconds are the SAME values captured on
// the start event — preserved for correlation by the caller, never
// recomputed here.
export function buildFocusTerminalEvent(type, task, focusSessionId, {
  focusStartedAt, focusInitialPlannedSeconds, focusFinalPlannedSeconds,
  focusElapsedSeconds, focusEndReason, now = Date.now(), windows,
} = {}) {
  const nowMs = toEpochMs(now);
  return {
    eventId: safeUUID(),
    schemaVersion: 1,
    type,
    utcTimestamp: nowMs,
    lociDateString: getLociDayStr(toDateObj(now), resolveWindows(windows)),
    taskId: task.uuid,
    focusSessionId,
    focusStartedAt,
    focusInitialPlannedSeconds,
    focusEndedAt: nowMs,
    focusFinalPlannedSeconds,
    focusElapsedSeconds,
    focusEndReason,
    taskSnapshot: taskSnapshotFrom(task),
  };
}

// One-per-Loci-day capture of which tasks were sitting in Today, incomplete
// and not parked, at the moment this day began — this snapshot IS the
// carryover set for that day (not compared against any prior snapshot).
// Separate schema from activity events entirely: no eventId, taskId,
// source, fromState, or toState — none of those apply to a whole-state
// capture.
export function buildTodaySnapshot(tasks, { now = Date.now(), windows } = {}) {
  const nowMs = toEpochMs(now);
  const lociDateString = getLociDayStr(toDateObj(now), resolveWindows(windows));
  const todayTaskIds = (tasks || [])
    .filter(t => t.horizonLevel === "today" && !t.isCompleted && !t.isDeleted && !t.isParked)
    .map(t => t.uuid);
  return {
    schemaVersion: 1,
    lociDateString,
    capturedAt: nowMs,
    todayTaskIds,
  };
}
