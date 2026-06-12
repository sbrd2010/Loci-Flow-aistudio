// "Coach Check-In" — lets the AI coach honor a request like "check on me in
// 10 minutes" by scheduling a real reminder and resuming the conversation
// when it fires, instead of claiming it has no concept of time.
//
// The coach signals a check-in by ending its reply with an invisible
// [[CHECKIN_IN:N]] tag (N = minutes from now). This module parses that tag,
// builds the check-in record, and produces the resume message/notification text.

const CHECKIN_TAG_RE = /\s*\[\[CHECKIN_IN:\s*(\d+)\s*\]\]/i;
const MIN_MINUTES = 1;
const MAX_MINUTES = 180;

// Strips a [[CHECKIN_IN:N]] tag from an AI reply, clamping N to a sane range.
// Returns { cleanText, minutes } — minutes is null if no tag was found.
export function parseCheckinTag(text = "") {
  const match = text.match(CHECKIN_TAG_RE);
  if (!match) return { cleanText: text, minutes: null };
  const raw = parseInt(match[1], 10);
  const minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, raw));
  const cleanText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  return { cleanText, minutes };
}

// Picks which task the check-in should reference: the pinned Now Focus task
// if there is one, else the first active Today task, else null.
export function pickCheckinNote(todayActiveTasks = []) {
  const nowFocus = todayActiveTasks.find(t => t.isNowFocus);
  return (nowFocus || todayActiveTasks[0])?.title || null;
}

export function buildCoachCheckin(minutes, note, now = Date.now()) {
  return { fireAt: now + minutes * 60000, note: note || null, createdAt: now };
}

export function isCheckinDue(coachCheckin, now = Date.now()) {
  return !!(coachCheckin && coachCheckin.fireAt && coachCheckin.fireAt <= now);
}

export function buildCheckinResumeMessage(firstName, note) {
  const name = firstName || "friend";
  return note
    ? `Hey ${name} — checking in like I said I would. How did it go with "${note}"?`
    : `Hey ${name} — checking in like I said I would. How are things going?`;
}

export function buildCheckinNotificationBody(note) {
  return note ? `How did it go with "${note}"?` : "How are things going?";
}
