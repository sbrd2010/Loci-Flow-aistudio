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
  if (!raw || typeof raw !== "object") return raw;
  const brainDump = arrayOrEmpty(raw.brainDump);
  return {
    ...raw,
    tasks: arrayOrEmpty(raw.tasks),
    config: objectOrEmpty(raw.config),
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
// and parked tasks are counted as active — only `isDeleted: true` is excluded.
// The guard is skipped when the current active count is below `threshold` itself
// (e.g. fresh user, demo mode) so it never fires on an empty or near-empty state.
export function isTaskCountDropSuspicious(nextTasks, currentTasks, threshold = 3) {
  const currentActive = arrayOrEmpty(currentTasks).filter(t => !t.isDeleted).length;
  if (currentActive < threshold) return false;
  const nextActive = arrayOrEmpty(nextTasks).filter(t => !t.isDeleted).length;
  return (currentActive - nextActive) >= threshold;
}

// Applies a payload received from RTDB on top of the currently-held local payload.
// If RTDB omits `brainDump`, field-level metadata tells us whether that omission
// means "legacy/missing key, preserve newer local items" or "newer remote clear".
export function mergeRemotePayload(remote, local) {
  const normalized = normalizePayload(remote);
  if (!remote || typeof remote !== "object") return normalized;

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

  // Preserve tasks added locally but not yet synced to RTDB (identified by uuid absence).
  // Guards against a fresh-load browser writing a stale full payload that overwrites
  // unsynced additions made on another device.
  const remoteUuids = new Set((normalized.tasks || []).map(t => t.uuid).filter(Boolean));
  const localOnlyTasks = arrayOrEmpty(local?.tasks).filter(
    t => t.uuid && !remoteUuids.has(t.uuid) && !t.isDeleted
  );
  if (localOnlyTasks.length > 0) {
    normalized.tasks = [...normalized.tasks, ...localOnlyTasks];
  }

  return normalized;
}
