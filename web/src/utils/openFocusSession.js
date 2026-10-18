// The open focus session, kept in this browser so a refresh doesn't lose it
// (#527). The timer's state lives in memory; this is a small copy of it, saved
// every few seconds while a session runs and on the page going away. On the
// next load it comes back paused, and the time worked is what the copy says:
// the minutes between its last save and the page coming back are never
// credited. This device only: nothing here is synced.

import { focusExpiryReason } from "./focusSession";

export const OPEN_SESSION_KEY = "loci_open_focus_session";
export const OPEN_SESSION_SAVE_MS = 5000;

// This tab's id, kept for the life of the tab (it survives a refresh, a new
// tab gets its own), so a tab can tell a session it saved from one another
// live tab is running.
export function thisTabId() {
  try {
    let id = sessionStorage.getItem("loci_tab_id");
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("loci_tab_id", id); }
    return id;
  } catch { return "unknown"; }
}

// Another tab is running this session right now: its copy was saved a moment
// ago by a different tab. Restoring it here would run it twice.
export function ownedByOtherLiveTab(snap, now = Date.now()) {
  return !!snap.tabId && snap.tabId !== thisTabId() && now - snap.savedAt < OPEN_SESSION_SAVE_MS * 3;
}

// Whether another tab holds the open session, by a Web Lock its owner keeps
// for as long as it has one (loopcheck of #530): a lock goes when its tab does,
// frozen, throttled or killed, which a "saved a moment ago" guess cannot tell.
const LOCK_NAME = "loci-open-focus-session";
let releaseLock = null;
const locks = () => (typeof navigator !== "undefined" && navigator.locks?.request ? navigator.locks : null);

export function holdSessionLock() {
  const l = locks();
  if (!l || releaseLock) return;
  const held = new Promise((resolve) => { releaseLock = resolve; });
  l.request(LOCK_NAME, () => held).catch(() => { releaseLock = null; });
}

export function dropSessionLock() {
  if (releaseLock) releaseLock();
  releaseLock = null;
}

// Takes the lock for this tab if no other tab has it, and keeps it: the check
// and the hold are one request, so two tabs reopening together cannot both
// find it free (Codex review of #530). true: this tab has it now; false:
// another tab has it; null: this browser can't say.
export function claimSessionLock() {
  const l = locks();
  if (!l) return Promise.resolve(null);
  if (releaseLock) return Promise.resolve(true);
  return new Promise((resolve) => {
    l.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return undefined; }
      resolve(true);
      return new Promise((release) => { releaseLock = release; });
    }).catch(() => resolve(null));
  });
}

const num = (v) => typeof v === "number" && Number.isFinite(v);

export function saveOpenSession(snapshot) {
  try { localStorage.setItem(OPEN_SESSION_KEY, JSON.stringify(snapshot)); } catch { /* storage blocked or full */ }
}

export function clearOpenSession() {
  try { localStorage.removeItem(OPEN_SESSION_KEY); } catch { /* storage blocked */ }
}

// The saved session for this account, or null: nothing saved, another
// account's, or not shaped as saveOpenSession writes it.
export function loadOpenSession(uid) {
  let snap;
  try { snap = JSON.parse(localStorage.getItem(OPEN_SESSION_KEY)); } catch { return null; }
  if (!snap || snap.v !== 1 || !uid || snap.uid !== uid) return null;
  if (typeof snap.focusSessionId !== "string" || !snap.focusSessionId) return null;
  if (!snap.task || typeof snap.task !== "object" || !snap.task.uuid) return null;
  const numbers = [snap.savedAt, snap.focusStartedAt, snap.initialPlannedSeconds, snap.accumulatedElapsed,
    snap.accumulatedPlanned, snap.blocks, snap.extensions, snap.timerMaxSeconds, snap.timerSecondsLeft];
  if (!numbers.every(num)) return null;
  if (snap.pausedAt != null && !num(snap.pausedAt)) return null;
  return snap;
}

// A saved session shaped as the focus timer reports an ended one, for the
// terminal ledger event: the time worked is the time saved, and it ends when
// the page was last seen (the pause it was in, or the save). As the timer's
// own readOpenSession does, a session whose pause ran out or whose day ended
// reads as expired, and is cut at the end of its day (Codex review of #530).
export function savedSessionAsEnded(snap, focusEndReason, now = Date.now()) {
  const blockElapsed = Math.max(0, snap.timerMaxSeconds - snap.timerSecondsLeft);
  const stopAt = snap.pausedAt ?? snap.savedAt;
  const expired = focusExpiryReason({ sessionOpen: true, pausedAt: stopAt, dayEndsAt: snap.dayEndsAt, now });
  const endAt = expired === "day_ended" ? Math.min(stopAt, snap.dayEndsAt) : stopAt;
  const worked = snap.accumulatedElapsed + blockElapsed;
  return {
    focusSessionId: snap.focusSessionId,
    focusStartedAt: snap.focusStartedAt,
    focusInitialPlannedSeconds: snap.initialPlannedSeconds,
    focusFinalPlannedSeconds: snap.accumulatedPlanned + snap.timerMaxSeconds,
    focusElapsedSeconds: expired
      ? Math.max(snap.accumulatedElapsed, Math.round(worked - (stopAt - endAt) / 1000))
      : worked,
    focusEndReason: expired || focusEndReason,
    focusBlocks: snap.blocks,
    focusExtensions: snap.extensions,
    focusPausedAt: stopAt,
    focusEndedAt: endAt,
    task: snap.task,
    // On the day it began, as an expired session is (the hold's entry, if it
    // banked one, is amended in place).
    ...(snap.ledgerEntry
      ? { eventId: snap.ledgerEntry.eventId, lociDateString: snap.ledgerEntry.lociDateString }
      : snap.startDay ? { lociDateString: snap.startDay } : {}),
  };
}
