// In-memory map of task UUID → timeout ID (cleared on page refresh, re-scheduled on load)
const scheduled = new Map();

function shouldScheduleReminder(task) {
  return !!(task.reminderAt && !task.isCompleted && !task.isDeleted && !task.isParked);
}

export function scheduleReminder(task) {
  if (!shouldScheduleReminder(task)) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  const delay = task.reminderAt - Date.now();
  cancelReminder(task.uuid);
  if (delay <= 0) return; // already past — don't fire stale reminder

  const id = setTimeout(async () => {
    scheduled.delete(task.uuid);
    const body = task.title;
    const opts = { body, icon: "/icon-192.png", tag: `task-${task.uuid}`, renotify: true, data: { uuid: task.uuid } };
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification("🎯 Task reminder", opts);
      } else {
        new Notification("🎯 Task reminder", opts);
      }
    } catch (_) {
      try { new Notification("🎯 Task reminder", opts); } catch (_) {}
    }
  }, delay);

  scheduled.set(task.uuid, id);
}

export function cancelReminder(uuid) {
  const id = scheduled.get(uuid);
  if (id != null) { clearTimeout(id); scheduled.delete(uuid); }
}

export function scheduleAllReminders(tasks = []) {
  const activeUuids = new Set(tasks.filter(t => t.uuid).map(t => t.uuid));
  // Cancel any scheduled reminders for tasks no longer in the active list
  for (const [uuid] of scheduled) {
    if (!activeUuids.has(uuid)) cancelReminder(uuid);
  }
  tasks.forEach(t => scheduleReminder(t));
}

export function formatReminderLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isTomorrow = d.toDateString() === new Date(now.getTime() + 86400000).toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${timeStr}`;
  if (isTomorrow) return `Tomorrow ${timeStr}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined }) + " " + timeStr;
}
