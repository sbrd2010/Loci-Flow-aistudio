// Thoughts (Q56): notes that live in Mind Box › Brain dump (payload.brainDump),
// captured from Add (Task | Thought), Mind Box's field, Focus's "Park a
// thought" or Rescue. At most 50; at 40 Mind Box says so. A thought keeps its
// line breaks (78 §5) and its **bold** / __underline__ markers.

import { safeUUID } from "./uuid";
import { escapeThought, plainThought, trimThought } from "./thoughtFormat";

export const THOUGHTS_MAX = 50;
export const THOUGHTS_NOTE_AT = 40;
export const THOUGHT_MAX_CHARS = 500;

export const thoughtsOf = (payload) => (Array.isArray(payload?.brainDump) ? payload.brainDump : []);

// A thought saved before 78 §5, or by an older app on the same database, is
// plain text: its "__init__" or "2**3" is not underline or bold, and "Make it
// a task" must keep it as typed (review of #511, 1.1). Only a thought saved
// in the marked format carries fmt; any other is escaped as it's read, and
// nothing stored is rewritten.
export const THOUGHT_FORMAT = 1;
export const thoughtText = (item) => (item?.fmt === THOUGHT_FORMAT ? String(item.text || "") : escapeThought(item?.text));

// The payload with the thought added, or null when there is nothing to add or
// Mind Box is full.
// Spaces inside a line collapse; at most one blank line between lines.
export function cleanThought(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function addThought(payload, text, now = Date.now()) {
  const clean = trimThought(cleanThought(text), THOUGHT_MAX_CHARS);
  const dump = thoughtsOf(payload);
  if (!plainThought(clean) || dump.length >= THOUGHTS_MAX) return null;
  const item = { id: safeUUID(), text: clean, createdAt: now, fmt: THOUGHT_FORMAT };
  return { payload: { ...payload, brainDump: [...dump, item] }, item };
}

// Plain typed text (Focus's "Park a thought", Rescue): its *, _ and \ are
// kept as typed, never read as markers.
export const addPlainThought = (payload, text, now = Date.now()) => addThought(payload, escapeThought(text), now);

// Let go: the thought goes, and Undo puts it back where it was.
export function letGoThought(payload, id) {
  const dump = thoughtsOf(payload);
  const at = dump.findIndex(d => d.id === id);
  if (at < 0) return null;
  return { payload: { ...payload, brainDump: dump.filter(d => d.id !== id) }, item: dump[at], at };
}

// Null when Mind Box filled up again in the meantime: Undo can't add a 51st.
export function restoreThought(payload, item, at) {
  const dump = thoughtsOf(payload);
  if (!item || dump.some(d => d.id === item.id)) return payload;
  if (dump.length >= THOUGHTS_MAX) return null;
  const next = [...dump];
  next.splice(Math.min(Math.max(0, at), next.length), 0, item);
  return { ...payload, brainDump: next };
}

// Newest first by createdAt. Stored order isn't time order after a sync
// merge appends the other device's thoughts.
export function newestThoughtsFirst(list) {
  const at = t => (Number.isFinite(t?.createdAt) ? t.createdAt : -Infinity);
  return [...(list || [])].reverse().sort((a, b) => at(b) - at(a));
}
