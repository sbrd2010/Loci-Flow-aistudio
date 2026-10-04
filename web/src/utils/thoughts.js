// Thoughts (Q56): one-line notes that live in Mind Box (payload.brainDump),
// captured from Add (Task | Thought), Mind Box's field, or Focus's "Park a
// thought". At most 50; at 40 Mind Box says so.

import { safeUUID } from "./uuid";

export const THOUGHTS_MAX = 50;
export const THOUGHTS_NOTE_AT = 40;

export const thoughtsOf = (payload) => (Array.isArray(payload?.brainDump) ? payload.brainDump : []);

// The payload with the thought added, or null when there is nothing to add or
// Mind Box is full.
export function addThought(payload, text, now = Date.now()) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const dump = thoughtsOf(payload);
  if (!clean || dump.length >= THOUGHTS_MAX) return null;
  const item = { id: safeUUID(), text: clean, createdAt: now };
  return { payload: { ...payload, brainDump: [...dump, item] }, item };
}

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
