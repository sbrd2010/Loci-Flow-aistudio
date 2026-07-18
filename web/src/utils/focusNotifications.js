import { isNativeApp, notifPermissionGranted, requestNotifPermission as doRequestPermission, nativeShowNow, idFromString } from "./nativeNotifs";

export function requestNotifPermission() {
  if (isNativeApp()) { doRequestPermission(); return; }
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  Notification.requestPermission().catch(() => {});
}

export function notifyFocusComplete(taskTitle) {
  if (!notifPermissionGranted()) return;
  const body = taskTitle ? `"${taskTitle}" — well done!` : "Your focus block is done. Well done!";
  if (isNativeApp()) {
    nativeShowNow(idFromString("loci-focus-complete"), {
      title: "Focus session complete",
      body,
      extra: {},
    });
    return;
  }
  try {
    new Notification("Focus session complete", {
      body,
      tag: "loci-focus-complete",
    });
  } catch {}
}
