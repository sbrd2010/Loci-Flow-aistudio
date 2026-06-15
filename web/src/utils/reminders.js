import { buildCheckinNotificationBody } from "./coachCheckin";
import { shouldShowMorningCommitment, shouldShowMiddayCheck, shouldShowReflection } from "./dailyCoachCheckins";
import { shouldShowMorningRitual } from "./morningRitual";
import { getLociDayStr } from "./focusWindows";

// In-memory map of task UUID → timeout ID (cleared on page refresh, re-scheduled on load)
const scheduled = new Map();
const COACH_CHECKIN_KEY = "__coach_checkin__";

// Fallback (non-service-worker) notifications don't go through sw.js's
// notificationclick handler, so they'd otherwise have no deep-link behavior.
// Replicate it via a window event that App.jsx listens for alongside the SW message.
function attachFallbackClickHandler(notif, data) {
  if (!data) return;
  notif.onclick = () => {
    window.focus();
    notif.close();
    window.dispatchEvent(new CustomEvent("loci-notification-click", { detail: data }));
  };
}

// Shows a notification via the service worker (preferred — works while the
// tab is backgrounded) or falls back to the Notification constructor.
// Returns true if a notification was (likely) shown, false if both paths failed.
async function showNotificationSafe(title, opts) {
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
    } else {
      attachFallbackClickHandler(new Notification(title, opts), opts.data);
    }
    return true;
  } catch (_) {
    try {
      attachFallbackClickHandler(new Notification(title, opts), opts.data);
      return true;
    } catch (_) {
      return false;
    }
  }
}

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

  const id = setTimeout(() => {
    scheduled.delete(task.uuid);
    const body = task.title;
    const opts = { body, icon: "/icon-192.png", tag: `task-${task.uuid}`, renotify: true, data: { uuid: task.uuid } };
    showNotificationSafe("🎯 Task reminder", opts);
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
  // (skip the coach check-in, which shares this map but isn't a task)
  for (const [uuid] of scheduled) {
    if (uuid !== COACH_CHECKIN_KEY && !activeUuids.has(uuid)) cancelReminder(uuid);
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

  const id = setTimeout(() => {
    scheduled.delete(COACH_CHECKIN_KEY);
    const opts = { body: buildCheckinNotificationBody(checkin.note), icon: "/icon-192.png", tag: "loci-coach-checkin", renotify: true, data: { type: "coach-checkin" } };
    showNotificationSafe("🤖 Coach check-in", opts);
  }, delay);

  scheduled.set(COACH_CHECKIN_KEY, id);
}

export function cancelCoachCheckin() {
  const id = scheduled.get(COACH_CHECKIN_KEY);
  if (id != null) { clearTimeout(id); scheduled.delete(COACH_CHECKIN_KEY); }
}

// Pure check for which of the three daily check-in cards (Today tab) are due
// right now. Mirrors the eligibility rules each card already uses so the
// push notification fires exactly when the card would appear.
export function getDueDailyCheckins(config, windows, now = new Date()) {
  const todayStr = getLociDayStr(now, windows);
  const morningRitualPending = shouldShowMorningRitual(now, config);
  const due = [];
  if (shouldShowMorningCommitment(now, windows, config, todayStr, morningRitualPending)) due.push("morning");
  if (shouldShowMiddayCheck(now, windows, config, todayStr)) due.push("midday");
  if (shouldShowReflection(now, windows, config, todayStr)) due.push("reflection");
  return due;
}

const DAILY_CHECKIN_NOTIFICATIONS = {
  morning: { title: "🌅 Today's Commitment", body: "What matters most today? Open Loci to set your focus." },
  midday: { title: "📊 Progress Check", body: "How's it going? Open Loci to check your progress." },
  reflection: { title: "🌙 Day Close", body: "Wrap up your day — open Loci to reflect." },
};

// The only valid Daily Coach Check-in slots — used to validate slot values that
// arrive from outside the app (notification deep-link URL params, SW postMessage)
// before they're trusted as object keys or state.
export const DAILY_CHECKIN_SLOTS = new Set(Object.keys(DAILY_CHECKIN_NOTIFICATIONS));

const NOTIFIED_DAILY_CHECKINS_KEY = "loci_notified_daily_checkins";

// localStorage-backed dedup so a due check-in only notifies once per Loci day,
// even across refreshes, backgrounded/discarded tabs, or multiple open tabs.
// Keys are scoped per user (`${slot}-${userId}-${todayStr}`) so a shared browser
// or a sign-out/sign-in user switch doesn't suppress another account's check-ins.
// Pruned to today's entries on every read.
function loadNotifiedDailyCheckins(todayStr) {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(NOTIFIED_DAILY_CHECKINS_KEY) || "[]");
  } catch (_) {}
  return Array.isArray(stored) ? stored.filter(key => typeof key === "string" && key.endsWith(`-${todayStr}`)) : [];
}

// Other Loci tabs heartbeat this key (every ~10s) while visible, so a hidden tab
// can tell a foregrounded tab is already showing the user this check-in.
export const VISIBLE_HEARTBEAT_KEY = "loci_tab_visible_at";
const VISIBLE_HEARTBEAT_STALE_MS = 15_000;

function isAnotherTabVisible() {
  try {
    const last = Number(localStorage.getItem(VISIBLE_HEARTBEAT_KEY) || 0);
    return (Date.now() - last) < VISIBLE_HEARTBEAT_STALE_MS;
  } catch (_) {
    return false;
  }
}

// Fires a push notification for each daily check-in card that's due while
// the app is backgrounded/closed, so check-ins reach the user even if they
// never open the tab. Safe to call repeatedly (e.g. on a polling interval).
export async function checkDailyCheckinNotifications(config, windows) {
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (isAnotherTabVisible()) return;

  const now = new Date();
  const todayStr = getLociDayStr(now, windows);
  const userId = config?.userId || "anon";
  for (const slot of getDueDailyCheckins(config, windows, now)) {
    const key = `${slot}-${userId}-${todayStr}`;
    const notified = loadNotifiedDailyCheckins(todayStr);
    if (notified.includes(key)) continue;
    // Reserve the key (synchronously, before awaiting) so a concurrent poll from
    // another background tab sees it claimed and skips this slot — otherwise both
    // tabs would read the same un-reserved `notified` list and both notify.
    localStorage.setItem(NOTIFIED_DAILY_CHECKINS_KEY, JSON.stringify([...notified, key]));
    const { title, body } = DAILY_CHECKIN_NOTIFICATIONS[slot];
    const shown = await showNotificationSafe(title, { body, icon: "/icon-192.png", tag: `loci-daily-checkin-${slot}`, renotify: true, data: { type: "daily-checkin", slot } });
    if (!shown) {
      // Release the reservation so a later poll (this tab or another) retries this slot.
      const current = loadNotifiedDailyCheckins(todayStr);
      localStorage.setItem(NOTIFIED_DAILY_CHECKINS_KEY, JSON.stringify(current.filter(k => k !== key)));
    }
  }
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
