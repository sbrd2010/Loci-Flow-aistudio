// #612: "Delete all my data". One atomic update removes the synced payload
// and the activity log, leaving only a tombstone (when the account was
// deleted) under the old uid. The rules refuse any later write to sync/{uid}
// or activityLogs/{uid} once it exists, so a save still in flight, or another
// device still signed in, cannot write the data back.
import { ref, update } from "firebase/database";
import { deleteUser } from "firebase/auth";

export const tombstonePath = (uid) => `activityLogs/${uid}/accountDeletedAt`;

export function deletionUpdate(uid, now = Date.now()) {
  if (!uid) throw new Error("deletionUpdate: no uid");
  return {
    [`sync/${uid}`]: null,
    [`activityLogs/${uid}`]: { accountDeletedAt: now },
  };
}

// Everything Loci keeps in this browser is under loci_: the offline copy of
// the payload, settings, own AI keys and view state.
export function clearLocalLociData(storage = globalThis.localStorage) {
  if (!storage) return;
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith("loci_")) keys.push(k);
    }
  } catch { return; }
  keys.forEach(k => { try { storage.removeItem(k); } catch { /* private mode */ } });
}

// Signs in again first: Firebase only deletes an account after a recent
// sign-in, and if that fails nothing has been deleted. If the data goes but
// the sign-in record can't be removed, the error says so ("account_left").
export async function deleteAllMyData({ db, user, reauthenticate, now = Date.now(), deps = { ref, update, deleteUser } }) {
  if (!user?.uid) throw new Error("not_signed_in");
  await reauthenticate(user);
  await deps.update(deps.ref(db), deletionUpdate(user.uid, now));
  try {
    await deps.deleteUser(user);
  } catch (err) {
    const left = new Error("account_left");
    left.cause = err;
    throw left;
  }
}
