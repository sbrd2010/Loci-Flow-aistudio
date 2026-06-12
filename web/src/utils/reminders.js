import { buildCheckinNotificationBody } from "./coachCheckin";

// In-memory map of task UUID → timeout ID (cleared on page refresh, re-scheduled on load)
const scheduled = new Map();
const COACH_CHECKIN_KEY = "__coach_checkin__";

// JS setTimeout silently wraps around for delays > 2^31 ms (~24.8 days) and fires immediately.
// Chain a re-schedule callback at this boundary so distant reminders work correctly.
const MAX_TIMEOUT_MS = 2_000_000_000; // ~23 days — safely below 2^31

function shouldScheduleReminder(task) {
  return !!(task?.uuid && task.reminderAt && !task.isCompleted && !task.isDeleted && !task.isParked);
}

export function scheduleReminder(task) {
  if (!shouldScheduleReminder(task)) {
    if (task?.uuid) cancelReminder(task.uuid);
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  const delay = task.reminderAt - Date.now();
  cancelReminder(task.uuid);
  if (delay <= 0) return; // already past — don't fire stale reminder

  if (delay > MAX_TIMEOUT_MS) {
    // Reschedule at the boundary; the callback recalculates the remaining delay
    const id = setTimeout(() => {
      scheduled.delete(task.uuid);
      scheduleReminder(task);
    }, MAX_TIMEOUT_MS);
    scheduled.set(task.uuid, id);
    return;
  }

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

// Schedules a one-off notification for a pending "Coach Check-In" (see
// utils/coachCheckin.js). Re-schedulable on app load — calling it again
// replaces any previously-scheduled check-in.
export function scheduleCoachCheckin(checkin) {
  cancelCoachCheckin();
  if (!checkin?.fireAt) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  const delay = checkin.fireAt - Date.now();
  if (delay <= 0 || delay > MAX_TIMEOUT_MS) return; // already due, or out of the 1-180min range — CoachTab resumes on next open

  const id = setTimeout(async () => {
    scheduled.delete(COACH_CHECKIN_KEY);
    const opts = { body: buildCheckinNotificationBody(checkin.note), icon: "/icon-192.png", tag: "loci-coach-checkin", renotify: true, data: { type: "coach-checkin" } };
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification("🤖 Coach check-in", opts);
      } else {
        new Notification("🤖 Coach check-in", opts);
      }
    } catch (_) {
      try { new Notification("🤖 Coach check-in", opts); } catch (_) {}
    }
  }, delay);

  scheduled.set(COACH_CHECKIN_KEY, id);
}

export function cancelCoachCheckin() {
  const id = scheduled.get(COACH_CHECKIN_KEY);
  if (id != null) { clearTimeout(id); scheduled.delete(COACH_CHECKIN_KEY); }
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
