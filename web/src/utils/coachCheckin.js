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

// Strips a [[CHECKIN_IN:N]] tag from an AI reply. Returns { cleanText, minutes }
// — minutes is null if no tag was found, or if N is outside the 1-180 valid
// range (treated the same as no tag, so a valid request-message fallback can
// be used instead of an out-of-range AI guess).
export function parseCheckinTag(text = "") {
  const match = text.match(CHECKIN_TAG_RE);
  if (!match) return { cleanText: text, minutes: null };
  const raw = parseInt(match[1], 10);
  const cleanText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  const minutes = raw >= MIN_MINUTES && raw <= MAX_MINUTES ? raw : null;
  return { cleanText, minutes };
}

// Picks which task the check-in should reference: an explicitly mentioned
// task (caller-resolved exact-title match against the user's message) wins,
// else the pinned Now Focus task if there is one, else null (generic
// check-in) — never an arbitrary task the user didn't ask about.
export function pickCheckinNote(activeTasks = [], mentionedTitle = null) {
  if (mentionedTitle) return mentionedTitle;
  const nowFocus = activeTasks.find(t => t.isNowFocus);
  return nowFocus?.title || null;
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

// Deterministic fallback for natural-language check-in requests, used when an
// AI reply omits [[CHECKIN_IN:N]] despite the system prompt instructing it to
// include one (e.g. "check on me in 10 minutes", "get back to me at 11am").
// Only the user's LATEST message is inspected, mirroring the [[CHECKIN_IN:N]]
// instruction to base tags only on that message. Returns minutes (1-180), or
// null if no clear, non-recurring check-in request with a valid time is found.
const CHECKIN_INTENT_RE = /\b(check (on|in|back)|get back to me|follow up|circle back|remind me|ask me again|ping me|come back to me)\b/i;
const RECURRING_RE = /\b(every|each|daily|recurring|repeatedly)\b/i;
const DURATION_RE = /\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i;
const ABS_TIME_RE = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

export function parseCheckinRequestFromMessage(text = "", now = Date.now()) {
  if (!CHECKIN_INTENT_RE.test(text) || RECURRING_RE.test(text)) return null;

  const duration = text.match(DURATION_RE);
  if (duration) {
    const value = parseInt(duration[1], 10);
    const minutes = duration[2].toLowerCase().startsWith("h") ? value * 60 : value;
    return minutes >= MIN_MINUTES && minutes <= MAX_MINUTES ? minutes : null;
  }

  const absTime = text.match(ABS_TIME_RE);
  if (absTime) {
    let hour = parseInt(absTime[1], 10);
    const minute = absTime[2] ? parseInt(absTime[2], 10) : 0;
    const meridiem = absTime[3]?.toLowerCase();
    if (hour > 23 || minute > 59) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now) target.setDate(target.getDate() + 1);
    const minutes = Math.round((target.getTime() - now) / 60000);
    return minutes >= MIN_MINUTES && minutes <= MAX_MINUTES ? minutes : null;
  }

  return null;
}

// Guards App's Coach Check-In poller against appending a duplicate resume
// message when two tabs (or a reload near fireAt) both see the same due
// coachCheckin before either tab's "coachCheckin: null" write propagates to
// the other.
export function isDuplicateCheckinResume(chatHistory, resumeText) {
  const history = chatHistory || [];
  const last = history[history.length - 1];
  return !!last && !last.isUser && last.text === resumeText;
}
