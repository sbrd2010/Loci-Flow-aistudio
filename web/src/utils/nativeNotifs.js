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

async function LocalNotifications() {
  const mod = await import("@capacitor/local-notifications");
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

export async function requestNotifPermission() {
  if (isNativeApp()) {
    try {
      const LN = await LocalNotifications();
      const res = await LN.requestPermissions();
      _nativePerm = mapPermission(res.display);
    } catch (_) {
      _nativePerm = "denied";
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

// Schedule a notification at a specific time. Replaces any prior notification
// with the same numeric id. Returns true on success.
export async function nativeScheduleAt(id, { title, body, at, extra = {} }) {
  if (!isNativeApp()) return false;
  try {
    const LN = await LocalNotifications();
    await LN.schedule({
      notifications: [{
        id,
        title,
        body,
        schedule: { at },
        smallIcon: "ic_launcher_foreground",
        extra,
      }],
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Show a notification immediately (used by the foreground / polling paths).
export async function nativeShowNow(id, { title, body, extra = {} }) {
  return nativeScheduleAt(id, { title, body, at: new Date(Date.now() + 1000), extra });
}

// Reschedule: cancel any existing notification with this id, then schedule the
// new one. Awaits the cancel first so it can't race ahead and delete the newly
// scheduled notification.
export async function nativeReschedule(id, { title, body, at, extra = {} }) {
  if (!isNativeApp()) return false;
  await nativeCancel(id);
  return nativeScheduleAt(id, { title, body, at, extra });
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
      if (uuid && !activeUuids.has(uuid)) toCancel.push({ id: n.id });
    }
    if (toCancel.length) await LN.cancel({ notifications: toCancel });
  } catch (_) {}
}

export async function nativeCancel(id) {
  if (!isNativeApp()) return;
  try {
    const LN = await LocalNotifications();
    await LN.cancel({ notifications: [{ id }] });
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
