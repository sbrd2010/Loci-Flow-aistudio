// Firebase omits null/empty-array keys on write, so fields like `brainDump`
// arrive as `undefined` after a read when the array was empty or the key was
// never written. normalizePayload ensures required fields always exist so
// callers can safely spread or iterate without null-checks.
export const BRAIN_DUMP_LIMIT = 50;

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function sanitizeString(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || fallback;
}

function fallbackTask(index, fallbackUserId, now) {
  return {
    id: now + index,
    userId: fallbackUserId,
    uuid: `repaired-invalid-${now}-${index}`,
    title: "Recovered invalid task",
    concreteStep: "Review or delete this recovered item",
    horizonLevel: "week",
    priority: "P3",
    category: "Personal",
    timeEstimateMinutes: 25,
    deadlineTimestamp: null,
    reminderAt: null,
    isCompleted: false,
    isParked: false,
    isNowFocus: false,
    orderIndex: index,
    dateCompletedString: null,
    isDeleted: true,
    lastUpdated: now,
  };
}

// Repairs task objects so the next full-payload RTDB set() satisfies the current
// database.rules.json task schema. This is intentionally applied to existing
// local/cache payloads too, not only newly-created tasks, because one malformed
// old task can make every later full save fail atomically.
export function sanitizeTaskForRules(task, index = 0, fallbackUserId = "", now = Date.now()) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return fallbackTask(index, fallbackUserId, now);
  }

  const repaired = {
    ...task,
    id: task.id ?? (now + index),
    userId: sanitizeString(task.userId, 200, fallbackUserId),
    title: sanitizeString(task.title, 300, "Untitled task"),
  };

  if (!repaired.uuid) repaired.uuid = `repaired-${now}-${index}`;

  if (hasOwn(task, "concreteStep")) {
    repaired.concreteStep = sanitizeString(task.concreteStep, 300, "Do first tiny step");
  }

  // Firebase's set() throws synchronously on any `undefined`-valued key
  // anywhere in the payload, deterministically failing every retry.
  for (const key of Object.keys(repaired)) {
    if (repaired[key] === undefined) delete repaired[key];
  }

  return repaired;
}

export function sanitizeTasksForRules(tasks, fallbackUserId = "", now = Date.now()) {
  return arrayOrEmpty(tasks).map((task, index) => sanitizeTaskForRules(task, index, fallbackUserId, now));
}

function brainDumpsEqual(a, b) {
  try {
    return JSON.stringify(arrayOrEmpty(a)) === JSON.stringify(arrayOrEmpty(b));
  } catch {
    return false;
  }
}

function inferBrainDumpUpdatedAt(raw, brainDump) {
  const explicit = finiteNumber(raw.brainDumpUpdatedAt);
  if (explicit !== null) return explicit;

  // Legacy payloads did not have field-level metadata. If legacy brainDump
  // items exist, use the payload timestamp as the best available age signal.
  if (brainDump.length) {
    const payloadTimestamp = finiteNumber(raw.timestamp);
    if (payloadTimestamp !== null) return payloadTimestamp;
  }

  return 0;
}

export function normalizePayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { tasks: [], config: {}, contributions: [], brainDump: [], brainDumpUpdatedAt: 0 };
  }
  const brainDump = arrayOrEmpty(raw.brainDump);
  const config = objectOrEmpty(raw.config);
  const fallbackUserId = sanitizeString(raw.userId, 200, sanitizeString(config.userId, 200, ""));
  return {
    ...raw,
    tasks: sanitizeTasksForRules(raw.tasks, fallbackUserId),
    config,
    contributions: arrayOrEmpty(raw.contributions),
    brainDump,
    brainDumpUpdatedAt: inferBrainDumpUpdatedAt(raw, brainDump),
  };
}

export function prepareBrainDumpForSave(updatedPayload = {}, currentPayload = {}, now = Date.now()) {
  const currentBrainDump = arrayOrEmpty(currentPayload?.brainDump);
  const incomingHasBrainDump = updatedPayload?.brainDump !== undefined;
  let nextBrainDump = incomingHasBrainDump
    ? arrayOrEmpty(updatedPayload.brainDump)
    : currentBrainDump;

  if (incomingHasBrainDump && nextBrainDump.length > BRAIN_DUMP_LIMIT) {
    if (currentBrainDump.length >= BRAIN_DUMP_LIMIT && nextBrainDump.length > currentBrainDump.length) {
      nextBrainDump = currentBrainDump;
    } else {
      nextBrainDump = nextBrainDump.slice(0, BRAIN_DUMP_LIMIT);
    }
  }

  const patch = { brainDump: nextBrainDump };
  const brainDumpChanged = incomingHasBrainDump && !brainDumpsEqual(nextBrainDump, currentBrainDump);
  const requestedBrainDumpUpdatedAt = finiteNumber(updatedPayload?.brainDumpUpdatedAt);
  const currentBrainDumpUpdatedAt = finiteNumber(currentPayload?.brainDumpUpdatedAt);

  if (brainDumpChanged) {
    patch.brainDumpUpdatedAt = now;
  } else if (requestedBrainDumpUpdatedAt !== null || currentBrainDumpUpdatedAt !== null) {
    patch.brainDumpUpdatedAt = requestedBrainDumpUpdatedAt ?? currentBrainDumpUpdatedAt;
  }

  return patch;
}

// Returns true when a savePayload call would reduce the active (non-deleted) task
// count by `threshold` or more relative to the currently-held payload. Completed
// and parked tasks are counted as active - only `isDeleted: true` is excluded.
// The guard is skipped when the current active count is below `threshold` itself
// (e.g. fresh user, demo mode) so it never fires on an empty or near-empty state.
export function isTaskCountDropSuspicious(nextTasks, currentTasks, threshold = 3) {
  const currentActive = arrayOrEmpty(currentTasks).filter(t => !t.isDeleted).length;
  if (currentActive < threshold) return false;
  const nextActive = arrayOrEmpty(nextTasks).filter(t => !t.isDeleted).length;
  return (currentActive - nextActive) >= threshold;
}

// Merges remote and local task arrays by uuid.
// For shared UUIDs: the task with the newer lastUpdated wins; remote wins on tie
// (avoids endless local/remote flip-flopping when timestamps are equal or absent).
// Local-only non-deleted tasks are appended (unsynced additions from another device).
// Local-only soft-deleted tasks are not resurrected.
// Returns { tasks, hasLocalContribution } where hasLocalContribution is true when
// any local-newer task won a conflict or any local-only non-deleted task was appended.
// Callers use hasLocalContribution to know whether to write the merged result back
// to RTDB for cross-device convergence.
function mergeTasks(remoteTasks, localTasks) {
  const sanitizedRemoteTasks = sanitizeTasksForRules(remoteTasks);
  const sanitizedLocalTasks = sanitizeTasksForRules(localTasks);
  const localByUuid = new Map(
    sanitizedLocalTasks
      .filter(t => t.uuid)
      .map(t => [t.uuid, t])
  );

  let hasLocalContribution = false;

  const merged = sanitizedRemoteTasks.map(remoteTask => {
    if (!remoteTask.uuid) return remoteTask;
    const localTask = localByUuid.get(remoteTask.uuid);
    if (!localTask) return remoteTask;
    const localTs = finiteNumber(localTask.lastUpdated) ?? 0;
    const remoteTs = finiteNumber(remoteTask.lastUpdated) ?? 0;
    if (localTs > remoteTs) {
      hasLocalContribution = true;
      return localTask;
    }
    return remoteTask;
  });

  const remoteUuids = new Set(sanitizedRemoteTasks.map(t => t.uuid).filter(Boolean));
  const localOnlyTasks = sanitizedLocalTasks.filter(
    t => t.uuid && !remoteUuids.has(t.uuid) && !t.isDeleted
  );

  if (localOnlyTasks.length > 0) hasLocalContribution = true;

  return { tasks: [...merged, ...localOnlyTasks], hasLocalContribution };
}

// Merges remote and local config objects using config.lastUpdated.
// The config with the newer lastUpdated wins as a whole; remote wins on tie or
// when neither/either side is missing lastUpdated (missing treated as 0), matching
// mergeTasks's tie-breaking convention.
// Returns { config, localConfigWon } where localConfigWon is true when the local
// config won and the merged result must be written back to RTDB for convergence.
function mergeConfig(remoteConfig, localConfig) {
  const local = objectOrEmpty(localConfig);
  const remoteTs = finiteNumber(remoteConfig?.lastUpdated) ?? 0;
  const localTs = finiteNumber(local.lastUpdated) ?? 0;

  if (localTs > remoteTs) {
    return { config: local, localConfigWon: true };
  }
  return { config: remoteConfig, localConfigWon: false };
}

// If RTDB omits `brainDump`, field-level metadata tells us whether that omission
// means "legacy/missing key, preserve newer local items" or "newer remote clear".
// Returns { merged, hasLocalContribution } where hasLocalContribution signals that
// the merged payload differs from remote due to local-newer tasks, and must be
// written back to RTDB so other devices converge on the correct state.
export function mergeRemotePayloadWithMeta(remote, local) {
  const normalized = normalizePayload(remote);
  if (!remote || typeof remote !== "object") return { merged: normalized, hasLocalContribution: false };

  const remoteHasBrainDump = hasOwn(remote, "brainDump");
  const remoteHasBrainDumpMeta = hasOwn(remote, "brainDumpUpdatedAt");
  const localBrainDump = arrayOrEmpty(local?.brainDump);
  const localBrainDumpUpdatedAt = finiteNumber(local?.brainDumpUpdatedAt) || 0;
  const remoteBrainDumpUpdatedAt = finiteNumber(remote.brainDumpUpdatedAt) || 0;

  if (!remoteHasBrainDump && localBrainDump.length) {
    const shouldPreserveLegacyLocal = !remoteHasBrainDumpMeta;
    const localIsNewerThanRemoteClear = remoteHasBrainDumpMeta && localBrainDumpUpdatedAt > remoteBrainDumpUpdatedAt;

    if (shouldPreserveLegacyLocal || localIsNewerThanRemoteClear) {
      normalized.brainDump = localBrainDump;
      normalized.brainDumpUpdatedAt = Math.max(localBrainDumpUpdatedAt, normalized.brainDumpUpdatedAt || 0);
    }
  }

  const { tasks, hasLocalContribution: tasksContribution } = mergeTasks(normalized.tasks, local?.tasks);
  normalized.tasks = tasks;

  const { config, localConfigWon } = mergeConfig(normalized.config, local?.config);
  normalized.config = config;

  return { merged: normalized, hasLocalContribution: tasksContribution || localConfigWon };
}

export function mergeRemotePayload(remote, local) {
  return mergeRemotePayloadWithMeta(remote, local).merged;
}
