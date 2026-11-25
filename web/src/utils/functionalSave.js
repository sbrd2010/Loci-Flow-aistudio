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
//   - anything else must be a complete payload: a plain object (not a
//     thenable) with a tasks array and a config object, every field the live
//     payload has (none set to undefined), and the known lists still lists.
//     normalizePayload fills missing or malformed collections with empty
//     ones, so a partial or malformed result would otherwise empty real data.
// Outcomes: "applied" (with next), "noop", "refused:owner", "refused:threw"
// (with error), "refused:invalid". The updater is a caller contract: pure,
// with no side effects; inputs, ids and times are captured outside it.

const isPlainObject = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const COLLECTIONS = ["tasks", "contributions", "brainDump", "chatHistory"];

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
  if (!isPlainObject(next) || typeof next.then === "function") return { outcome: "refused:invalid" };
  if (!Array.isArray(next.tasks) || !isPlainObject(next.config)) return { outcome: "refused:invalid" };
  for (const key of Object.keys(live)) {
    if (live[key] === undefined) continue;
    // Every live field is kept (undefined would be dropped and refilled as empty).
    if (!Object.prototype.hasOwnProperty.call(next, key) || next[key] === undefined) return { outcome: "refused:invalid" };
  }
  // A list stays a list: brainDump: null or contributions: {} would be
  // normalised into an empty list and merged as a deletion. An emptied list
  // ([]) is a legitimate result.
  for (const key of COLLECTIONS) {
    if (Array.isArray(live[key]) && !Array.isArray(next[key])) return { outcome: "refused:invalid" };
    // A non-list is refused only if the updater made it: null where nothing
    // was a list (chatHistory cleared to null), or a live non-list passed
    // through unchanged, stays valid.
    if (next[key] != null && !Array.isArray(next[key]) && next[key] !== live[key]) return { outcome: "refused:invalid" };
  }
  return { outcome: "applied", next };
}
