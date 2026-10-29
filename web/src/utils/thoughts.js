// Thoughts (Q56): notes that live in Mind Box › Brain dump (payload.brainDump),
// captured from Add (Task | Thought), Mind Box's field, Focus's "Park a
// thought" or Rescue. At most 50; at 40 Mind Box says so. A thought keeps its
// line breaks (78 §5) and its **bold** / __underline__ markers.

import { safeUUID } from "./uuid";
import { escapeThought, plainThought, trimThought } from "./thoughtFormat";
import { notebookText, normalizeHighlights } from "./thoughtNotebook";

export const THOUGHTS_MAX = 50;
export const THOUGHTS_NOTE_AT = 40;
export const THOUGHT_MAX_CHARS = 2000;

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

export function addThought(payload, text, now = Date.now(), options = {}) {
  const clean = trimThought(options.notebook ? String(text || "") : cleanThought(text), THOUGHT_MAX_CHARS);
  const dump = thoughtsOf(payload);
  if (!plainThought(clean) || dump.length >= THOUGHTS_MAX) return null;
  const item = { id: safeUUID(), text: clean, createdAt: now, fmt: THOUGHT_FORMAT };
  const highlights = normalizeHighlights(options.highlights, notebookText(clean));
  if (highlights.length) item.highlights = highlights;
  return { payload: { ...payload, brainDump: [...dump, item] }, item };
}

export function sameThoughtContent(a, b) {
  if (!a || !b) return a === b;
  const marks = t => JSON.stringify(normalizeHighlights(t.highlights, notebookText(thoughtText(t))));
  return thoughtText(a) === thoughtText(b) && marks(a) === marks(b);
}

export function editThought(payload, id, text, highlights = [], now = Date.now()) {
  const dump = thoughtsOf(payload);
  const original = dump.find(t => t.id === id);
  const clean = trimThought(String(text || ""), THOUGHT_MAX_CHARS);
  if (!original || !plainThought(clean)) return null;
  const item = { ...original, text: clean, fmt: THOUGHT_FORMAT };
  const normalized = normalizeHighlights(highlights, notebookText(clean));
  if (normalized.length) item.highlights = normalized; else delete item.highlights;
  if (sameThoughtContent(item, original)) return { payload, item: original };
  item.updatedAt = Math.max(now, (Number(original.updatedAt) || Number(original.createdAt) || 0) + 1);
  item.revisionId = safeUUID();
  return { payload: { ...payload, brainDump: dump.map(t => t.id === id ? item : t) }, item };
}

export function thoughtDate(createdAt, now = Date.now()) {
  const date = new Date(createdAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

// Task titles have a 1,000-character rules limit; the note keeps the complete
// notebook entry when it cannot be represented by a single title.
export function thoughtTaskDraft(item) {
  const source = notebookText(thoughtText(item));
  const plain = plainThought(thoughtText(item));
  let title = "";
  for (const ch of plain) { if (title.length + ch.length > 1000) break; title += ch; }
  return { title, ...(plain.length > 1000 || source.includes("\n") ? { note: source } : {}) };
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
