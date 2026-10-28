// #612: "Delete all my data". One atomic update removes the synced payload
// and the activity log, leaving only a tombstone (when the account was
// deleted) under the old uid. The rules refuse any later write to sync/{uid}
// or activityLogs/{uid} once it exists, so a save still in flight, or another
// device still signed in, cannot write the data back.
//
// The same update keeps a copy in deletedAccounts/{uid}, which no app can
// read: the owner can restore it on request for 30 days, and a daily job
// (scripts/purge-deleted-accounts.mjs) erases it after that.
import { ref, update, get, serverTimestamp } from "firebase/database";
import { deleteUser } from "firebase/auth";

export const RETENTION_DAYS = 30;

export const tombstonePath = (uid) => `activityLogs/${uid}/accountDeletedAt`;

// Both times are the server's: a device clock that is wrong can't make the
// copy go early or stay forever (the rules check deletedAt against it).
export function deletionUpdate(uid, copy = {}) {
  if (!uid) throw new Error("deletionUpdate: no uid");
  const now = serverTimestamp();
  return {
    [`deletedAccounts/${uid}`]: {
      deletedAt: now,
      email: copy.email || null,
      sync: copy.sync ?? null,
      activityLogs: copy.activityLogs ?? null,
    },
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

// A reload is asynchronous: a timer could write a loci_ key back after the
// clear. The flag (sessionStorage, so it survives the reload) has the next
// load clear again before anything reads the cache.
const WIPE_FLAG = "loci-wipe-pending";
export function markWipePending(session = globalThis.sessionStorage) {
  try { session?.setItem(WIPE_FLAG, "1"); } catch { /* private mode */ }
}
export function finishPendingWipe(local = globalThis.localStorage, session = globalThis.sessionStorage) {
  try {
    if (session?.getItem(WIPE_FLAG) !== "1") return false;
    session.removeItem(WIPE_FLAG);
  } catch { return false; }
  clearLocalLociData(local);
  return true;
}

// Signs in again first: Firebase only deletes an account after a recent
// sign-in, and if that fails nothing has been deleted. If the data goes but
// the sign-in record can't be removed, the error says so ("account_left").
export async function deleteAllMyData({ db, user, reauthenticate, deps = { ref, update, get, deleteUser } }) {
  if (!user?.uid) throw new Error("not_signed_in");
  await reauthenticate(user);
  // The copy is taken from the server, not this device's cache, so it holds
  // what other devices saved too.
  const [syncSnap, logsSnap] = await Promise.all([
    deps.get(deps.ref(db, `sync/${user.uid}`)),
    deps.get(deps.ref(db, `activityLogs/${user.uid}`)),
  ]);
  const copy = { email: user.email, sync: syncSnap.val(), activityLogs: logsSnap.val() };
  await deps.update(deps.ref(db), deletionUpdate(user.uid, copy));
  try {
    await deps.deleteUser(user);
  } catch (err) {
    const left = new Error("account_left");
    left.cause = err;
    throw left;
  }
}
