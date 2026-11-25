// #680: the functional form of a full-payload save. A save built from a
// render's copy and applied after a wait (a permission prompt, a dialog, an
// AI reply) wrote that old copy back over whatever another device had
// committed meanwhile, and the merge took it as this device's edit
// (mergeTasksForWrite: local != base and server == base). The function form
// is evaluated at apply time against the live payload instead.
//
// This decides, purely, whether and what to apply:
//   - owner and session first: the save function must belong to the account
//     and the session that are current now, and the live payload to that
//     account; otherwise the updater is never called;
//   - the updater runs once; a throw is refused;
//   - null is a deliberate "nothing to save";
//   - anything else must be a complete payload (tasks array, config object,
//     every top-level key the live payload has). normalizePayload fills
//     missing collections with empty ones, so a partial result such as {}
//     would otherwise empty real data.
// Outcomes: "applied" (with next), "noop", "refused:owner", "refused:threw"
// (with error), "refused:invalid". The updater is a caller contract: pure,
// with no side effects; inputs, ids and times are captured outside it.

const isPlainObject = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export function resolveFunctionalSave({ update, live, owner }) {
  const { uid, currentUid, payloadUid, session, currentSession } = owner || {};
  if (!uid || currentUid !== uid || payloadUid !== uid || session !== currentSession || !isPlainObject(live)) {
    return { outcome: "refused:owner" };
  }
  let next;
  try {
    next = update(live);
  } catch (error) {
    return { outcome: "refused:threw", error };
  }
  if (next === null) return { outcome: "noop" };
  const complete = isPlainObject(next)
    && Array.isArray(next.tasks)
    && isPlainObject(next.config)
    && Object.keys(live).every(key => Object.prototype.hasOwnProperty.call(next, key));
  if (!complete) return { outcome: "refused:invalid" };
  return { outcome: "applied", next };
}
