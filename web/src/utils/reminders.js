import { buildCheckinNotificationBody } from "./coachCheckin";
import { shouldShowMorningCommitment, shouldShowMiddayCheck, shouldShowReflection, computeDailyCheckinTimes } from "./dailyCoachCheckins";
import { shouldShowMorningRitual } from "./morningRitual";
import { getLociDayStr } from "./focusWindows";
import {
  isNativeApp,
  notifPermissionGranted,
  idFromString,
  nativeScheduleAt,
  nativeShowNow,
  nativeCancel,
  nativeReschedule,
  nativeReconcileReminders,
} from "./nativeNotifs";

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
    if (isNativeApp()) {
      const key = String(opts?.data?.uuid || opts?.tag || title);
      return await nativeShowNow(idFromString(key), { title, body: opts?.body || "", extra: opts?.data || {} });
    }
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
    } else {
      attachFallbackClickHandler(new Notification(title, opts), opts.data);
    }
    return true;
  } catch (_) {
    if (isNativeApp()) return false;
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
  if (!notifPermissionGranted()) return;

  const delay = task.reminderAt - Date.now();
  cancelReminder(task.uuid);
  if (delay <= 0) return; // already past — don't fire stale reminder

  // Native: schedule via the OS so the reminder fires even when the app is closed.
  // nativeReschedule cancels any prior reminder with the same id first.
  if (isNativeApp()) {
    nativeReschedule(idFromString(task.uuid), {
      title: "🎯 Task reminder",
      body: task.title,
      at: new Date(task.reminderAt),
      extra: { uuid: task.uuid },
    });
    return;
  }

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
  if (isNativeApp()) nativeCancel(idFromString(uuid));
}

export function scheduleAllReminders(tasks = []) {
  const activeUuids = new Set(tasks.filter(t => t.uuid).map(t => t.uuid));
  // Cancel any scheduled reminders for tasks no longer in the active list
  // (skip the coach check-in, which shares this map but isn't a task)
  for (const [uuid] of scheduled) {
    if (uuid !== COACH_CHECKIN_KEY && !activeUuids.has(uuid)) cancelReminder(uuid);
  }
  // Native reminders aren't tracked in the in-memory map, so reconcile them
  // against the OS pending list to cancel reminders for removed tasks.
  if (isNativeApp()) nativeReconcileReminders(activeUuids);
  tasks.forEach(t => scheduleReminder(t));
}

// Schedules a one-off notification for a pending "Coach Check-In" (see
// utils/coachCheckin.js). Re-schedulable on app load — calling it again
// replaces any previously-scheduled check-in.
export function scheduleCoachCheckin(checkin) {
  cancelCoachCheckin();
  if (!checkin?.fireAt) return;
  if (!notifPermissionGranted()) return;

  const delay = checkin.fireAt - Date.now();
  if (delay <= 0 || delay > MAX_TIMEOUT_MS) return; // already due, or out of the 1-180min range — CoachTab resumes on next open

  // Native: schedule via the OS so the check-in fires even when the app is closed.
  if (isNativeApp()) {
    nativeReschedule(idFromString(COACH_CHECKIN_KEY), {
      title: "🤖 Coach check-in",
      body: buildCheckinNotificationBody(checkin.note),
      at: new Date(checkin.fireAt),
      extra: { type: "coach-checkin" },
    });
    return;
  }

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
  if (isNativeApp()) nativeCancel(idFromString(COACH_CHECKIN_KEY));
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
  if (!notifPermissionGranted()) return;
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

// Native-only counterpart to checkDailyCheckinNotifications: rather than
// polling every 5 minutes for a due slot (which needs the JS runtime alive —
// fine for a backgrounded browser tab, unreliable once Android backgrounds
// or kills the app), pre-schedule each of today's still-eligible check-ins
// as one-shot OS alarms via nativeScheduleAt so they fire regardless of
// process state. Callers should re-run this whenever config changes (same
// trigger as checkDailyCheckinNotifications already uses), so a slot that
// becomes newly eligible mid-day — e.g. midday right after the morning
// commitment is saved — gets (re)scheduled promptly; nativeScheduleAt
// replaces any prior alarm with the same id, so re-running this is always
// safe to repeat.
//
// State-based eligibility gates (already done today, skipped, snoozed,
// morning-ritual-pending) ARE re-checked here via the same shouldShowX
// predicates the web poll uses, evaluated with the computed target time as
// `now` — so a slot already satisfied as of scheduling time is correctly
// skipped rather than firing a stale/redundant notification. What this
// can't do: adapt if state changes again *after* scheduling but *before*
// the target time (e.g. the check-in gets done from another device) — the
// native alarm still fires; opening the app at that point just shows
// nothing new for that slot, the same class of harmless redundancy an
// already-fired notification for a just-completed action would produce
// with any scheduler.
// Slot -> the config field holding that slot's own snooze timestamp, so a
// snoozed slot whose originally-computed target has already passed can be
// retargeted to the snooze expiry instead of being abandoned for the day
// (see the "snoozeUntil" retargeting step below).
const DAILY_CHECKIN_SNOOZE_FIELDS = {
  morning: "dailyCommitmentSnoozeUntil",
  midday: "dailyMiddayCheckSnoozeUntil",
  reflection: "dailyReflectionSnoozeUntil",
};

export function scheduleDailyCheckins(config, windows, now = new Date()) {
  if (!isNativeApp()) return;
  const todayStr = getLociDayStr(now, windows);
  const targets = computeDailyCheckinTimes(now, windows);

  for (const slot of Object.keys(DAILY_CHECKIN_NOTIFICATIONS)) {
    const id = idFromString(`daily-checkin-${slot}`);
    if (config?.dailyCheckinsEnabled === false) {
      nativeCancel(id);
      continue;
    }

    let target = targets[slot];
    // The originally-computed target (e.g. midday's scheduled-focus-time
    // midpoint) is a single fixed instant with no notion of snooze. If it's
    // already passed but the user snoozed this exact slot to a later time,
    // retarget to the snooze expiry instead of giving up on the slot for
    // the rest of the day — otherwise a snooze tapped after the original
    // target only re-notifies if something else happens to rerun this
    // scheduler before the snooze expires (loopcheck/Codex finding).
    if (!target || target.getTime() <= now.getTime()) {
      const snoozeUntil = config?.[DAILY_CHECKIN_SNOOZE_FIELDS[slot]];
      if (typeof snoozeUntil === "number" && snoozeUntil > now.getTime()) {
        target = new Date(snoozeUntil);
      }
    }
    if (!target || target.getTime() <= now.getTime()) {
      nativeCancel(id);
      continue;
    }

    let eligible;
    if (slot === "morning") {
      eligible = shouldShowMorningCommitment(target, windows, config, todayStr, shouldShowMorningRitual(target, config));
    } else if (slot === "midday") {
      eligible = shouldShowMiddayCheck(target, windows, config, todayStr);
    } else {
      eligible = shouldShowReflection(target, windows, config, todayStr);
    }
    if (!eligible) {
      nativeCancel(id);
      continue;
    }
    const { title, body } = DAILY_CHECKIN_NOTIFICATIONS[slot];
    nativeScheduleAt(id, { title, body, at: target, extra: { type: "daily-checkin", slot } });
  }
}

// Cancels any native alarms scheduled by scheduleDailyCheckins, without
// scheduling anything new — used to suppress daily check-in notifications
// during an active focus session (App.jsx re-schedules once the session
// ends, same as scheduleDailyCheckins would naturally do on its next run).
export function cancelDailyCheckins() {
  if (!isNativeApp()) return;
  for (const slot of Object.keys(DAILY_CHECKIN_NOTIFICATIONS)) {
    nativeCancel(idFromString(`daily-checkin-${slot}`));
  }
}

// Cancels every native OS-level alarm this module can schedule: all task
// reminders (via an empty active-uuid set, so nativeReconcileReminders
// treats every currently-pending one as stale), the Coach check-in, and all
// three daily check-ins. Native alarms are OS-persisted, not cleared by a
// page reload/re-render the way the in-memory `scheduled` map is — call
// this on sign-out/account-switch so a previous account's task titles and
// check-ins can't surface as notifications on a shared/signed-out device.
export function cancelAllNativeScheduling() {
  if (!isNativeApp()) return;
  nativeReconcileReminders(new Set());
  cancelCoachCheckin();
  cancelDailyCheckins();
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
