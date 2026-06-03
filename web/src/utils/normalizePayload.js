// Firebase omits null/empty-array keys on write, so fields like `brainDump`
// arrive as `undefined` after a read when the array was empty or the key was
// never written. normalizePayload ensures required fields always exist so
// callers can safely spread or iterate without null-checks.
export function normalizePayload(raw) {
  if (!raw || typeof raw !== "object") return raw;
  return {
    ...raw,
    tasks: raw.tasks || [],
    config: raw.config || {},
    contributions: raw.contributions || [],
    brainDump: raw.brainDump || [],
  };
}

// Applies a payload received from RTDB on top of the currently-held local payload.
// Core rule: if the remote snapshot is missing the `brainDump` key entirely (Firebase
// omits it when the array was empty at write time) AND the local copy has items,
// preserve the local items rather than silently wiping them.
export function mergeRemotePayload(remote, local) {
  const normalized = normalizePayload(remote);
  if (
    !Object.prototype.hasOwnProperty.call(remote, "brainDump") &&
    local?.brainDump?.length
  ) {
    normalized.brainDump = local.brainDump;
  }
  return normalized;
}
