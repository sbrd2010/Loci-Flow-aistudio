export function requestNotifPermission() {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  Notification.requestPermission().catch(() => {});
}

export function notifyFocusComplete(taskTitle) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification("Focus session complete", {
      body: taskTitle ? `"${taskTitle}" — well done!` : "Your focus block is done. Well done!",
      tag: "loci-focus-complete",
    });
  } catch {}
}
