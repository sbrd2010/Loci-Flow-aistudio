// Native notifications bridge for the Capacitor Android app.
//
// On the web, Loci uses the browser Notification API + a service worker
// (see reminders.js / sw.js). Inside the Capacitor Android WebView the Web
// Notification API is unavailable, so this module routes the same operations
// through @capacitor/local-notifications instead. The plugin schedules
// notifications natively, which means reminders fire even when the app is
// closed — something the web setTimeout approach cannot do.
//
// Every function no-ops on web (non-native) so the existing web/test paths
// are completely untouched. The native plugin is imported lazily so the web
// bundle never loads it.

import { Capacitor } from "@capacitor/core";

export function isNativeApp() {
  try {
    return typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();
  } catch (_) {
    return false;
  }
}

// Cache the dynamic import's promise (not just its resolved value) so
// concurrent first callers — e.g. nativeReconcileReminders cancelling
// several stale ids via Promise.all — share a single in-flight import()
// instead of each issuing their own. Re-issuing import() per call is at
// best redundant work; concurrent overlapping first calls to it have also
// been observed to leave later callers permanently unresolved.
let _lnModulePromise = null;
async function LocalNotifications() {
  if (!_lnModulePromise) _lnModulePromise = import("@capacitor/local-notifications");
  const mod = await _lnModulePromise;
  return mod.LocalNotifications;
}

// Capacitor local-notification ids must be positive integers. Hash a string
// key (task uuid / slot key) to a stable 31-bit int (djb2).
export function idFromString(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h & 0x7fffffff;
  }
  return h || 1;
}

// Cached native permission so synchronous guards in reminders.js can decide
// without awaiting. Defaults to "default" (unknown) so reminders schedule
// optimistically on a fresh install; settled to granted/denied after the first
// check or a user prompt.
let _nativePerm = "default";

function mapPermission(display) {
  // Capacitor returns "granted" | "denied" | "prompt" | "prompt-with-rationale".
  // Map anything that isn't an explicit decision back to "default" so the app
  // still prompts the user (rather than treating prompt as a hard denial).
  if (display === "granted") return "granted";
  if (display === "denied") return "denied";
  return "default";
}

export function notifSupported() {
  if (isNativeApp()) return true;
  return typeof Notification !== "undefined";
}

export function notifPermissionState() {
  if (isNativeApp()) return _nativePerm;
  return typeof Notification !== "undefined" ? Notification.permission : "denied";
}

// On native we treat "default" (unknown) as ready so reminders schedule
// immediately on load; the native scheduler is a no-op if permission is
// actually denied. A recorded "denied" disables scheduling.
export function notifPermissionGranted() {
  if (isNativeApp()) return _nativePerm !== "denied";
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

export async function refreshNativePermission() {
  if (!isNativeApp()) return;
  try {
    const LN = await LocalNotifications();
    const res = await LN.checkPermissions();
    _nativePerm = mapPermission(res.display);
  } catch (_) {
    _nativePerm = "denied";
  }
  return _nativePerm;
}

// A fresh install's cached permission is "default" (unknown), so callers
// schedule optimistically before the user has actually granted anything —
// intentional (see notifPermissionGranted above), but it means a schedule
// attempted before permission is truly granted can silently fail. Nothing
// else retries it afterward: this event lets App.jsx re-run its scheduling
// effects the moment requestNotifPermission() below actually flips to
// "granted", instead of leaving reminders/check-ins unscheduled until some
// unrelated task/config edit happens to rerun the scheduler.
export const NATIVE_PERMISSION_GRANTED_EVENT = "loci-native-permission-granted";

export async function requestNotifPermission() {
  if (isNativeApp()) {
    const prev = _nativePerm;
    try {
      const LN = await LocalNotifications();
      const res = await LN.requestPermissions();
      _nativePerm = mapPermission(res.display);
    } catch (_) {
      _nativePerm = "denied";
    }
    if (_nativePerm === "granted" && prev !== "granted" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(NATIVE_PERMISSION_GRANTED_EVENT));
    }
    return _nativePerm;
  }
  if (typeof Notification === "undefined") return "denied";
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return "denied";
  }
}

// Per-id operation queue: rapid successive calls for the SAME notification id
// (e.g. a task's reminder time edited twice within a second) otherwise race —
// nothing guarantees the underlying LocalNotifications.cancel()/schedule()
// calls settle in call order, so a later edit's schedule could resolve before
// an earlier edit's, leaving the OS holding the stale time. Chaining every
// mutating call for a given id onto the same promise forces them to run and
// settle strictly in call order, while different ids stay fully independent.
const _idQueues = new Map();

function serializeById(id, fn) {
  const prev = _idQueues.get(id) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn regardless of the previous op's outcome
  _idQueues.set(id, next);
  next.finally(() => { if (_idQueues.get(id) === next) _idQueues.delete(id); });
  return next;
}

async function rawScheduleAt(id, { title, body, at, extra = {} }) {
  try {
    const LN = await LocalNotifications();
    await LN.schedule({
      notifications: [{
        id,
        title,
        body,
        // No exact-alarm permission is requested (see README_ANDROID.md), so
        // without allowWhileIdle Android can defer this well past `at` once
        // the device enters Doze — allowWhileIdle uses the wake-while-idle
        // alarm path instead, without needing the exact-alarm permission.
        schedule: { at, allowWhileIdle: true },
        smallIcon: "ic_launcher_foreground",
        extra,
      }],
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function rawCancel(id) {
  try {
    const LN = await LocalNotifications();
    await LN.cancel({ notifications: [{ id }] });
  } catch (_) {}
}

// Schedule a notification at a specific time. Replaces any prior notification
// with the same numeric id. Returns true on success.
export function nativeScheduleAt(id, opts) {
  if (!isNativeApp()) return Promise.resolve(false);
  return serializeById(id, () => rawScheduleAt(id, opts));
}

// Show a notification immediately (used by the foreground / polling paths).
export function nativeShowNow(id, { title, body, extra = {} }) {
  return nativeScheduleAt(id, { title, body, at: new Date(Date.now() + 1000), extra });
}

// Reschedule: cancel any existing notification with this id, then schedule the
// new one, as a single serialized unit per id — see serializeById above. Uses
// the raw (non-serialized) primitives internally so this doesn't deadlock
// against its own queue slot.
export function nativeReschedule(id, opts) {
  if (!isNativeApp()) return Promise.resolve(false);
  return serializeById(id, async () => {
    await rawCancel(id);
    return rawScheduleAt(id, opts);
  });
}

// Reconcile native task reminders against the active task list: cancel any
// pending task reminder whose uuid is no longer in `activeUuids`. (Coach
// check-in has its own single-id lifecycle and is not touched here.)
export async function nativeReconcileReminders(activeUuids) {
  if (!isNativeApp()) return;
  try {
    const LN = await LocalNotifications();
    const pending = await LN.getPending();
    const toCancel = [];
    for (const n of pending.notifications || []) {
      const uuid = n.extra && n.extra.uuid;
      if (uuid && !activeUuids.has(uuid)) toCancel.push(n.id);
    }
    // Route through the same per-id queue as every other mutating call
    // (nativeScheduleAt/nativeCancel/nativeReschedule), not a direct batch
    // LN.cancel() — otherwise a reconcile racing a concurrent schedule/cancel
    // for the same id can settle out of order and leave the OS holding a
    // stale alarm (the exact race serializeById exists to prevent).
    await Promise.all(toCancel.map(id => nativeCancel(id)));
  } catch (_) {}
}

export function nativeCancel(id) {
  if (!isNativeApp()) return Promise.resolve();
  return serializeById(id, () => rawCancel(id));
}

// LN.cancel() only removes PENDING (not-yet-fired) notifications — a
// reminder/check-in that already fired is sitting in the Android
// notification shade as a DELIVERED notification, which cancel() cannot
// touch (Codex finding). Used alongside cancelAllNativeScheduling on
// sign-out/switch-user/exit-demo so a previous account's already-shown
// notifications don't linger in the shade on a shared/signed-out device.
export async function nativeClearDelivered() {
  if (!isNativeApp()) return;
  try {
    const LN = await LocalNotifications();
    await LN.removeAllDeliveredNotifications();
  } catch (_) {}
}

// Register a listener for notification taps. The callback receives the
// notification's `extra` payload. Returns an unsubscribe function.
export async function addNativeNotificationClickListener(cb) {
  if (!isNativeApp()) return () => {};
  try {
    const LN = await LocalNotifications();
    await LN.addListener("localNotificationActionPerformed", (event) => {
      const extra = event?.notification?.extra || {};
      try { cb(extra); } catch (_) {}
    });
    return () => { try { LN.removeAllListeners(); } catch (_) {} };
  } catch (_) {
    return () => {};
  }
}
