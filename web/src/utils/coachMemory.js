// Coach Memory — Phase 3 "remembers a lot."
//
// Two-tier cross-session memory the AI Coach reads back on every chat system
// prompt via buildLociMemoryContext:
//  - Pinned Facts: durable facts about the user (goals, context, recurring
//    patterns) the coach should always know. AI-written via [[REMEMBER: ...]]
//    tags during chat, user-deletable in Settings.
//  - Recent Observations: a rolling log of lower-stakes notes from recent
//    conversations. AI-written via [[NOTE: ...]] tags, FIFO-capped,
//    user-deletable in Settings.
//
// Both caps are generous (storage is cheap) — they bound the prompt and keep
// the Settings list scannable, not to ration memory.

export const MAX_PINNED_FACTS = 15;
export const MAX_RECENT_OBSERVATIONS = 30;
const RECENT_OBSERVATIONS_IN_PROMPT = 10;
const MEMORY_ENTRY_MAX_LENGTH = 200;

function appendCapped(list = [], text, max, extra = {}) {
  // Collapse newlines/control chars so a memory entry can't break out of its
  // bullet line and inject extra "lines" into the system prompt.
  const trimmed = String(text || "").replace(/[\s\x00-\x1f\x7f]+/g, " ").trim().slice(0, MEMORY_ENTRY_MAX_LENGTH);
  if (!trimmed) return list;
  const next = [...list, { text: trimmed, ...extra }];
  while (next.length > max) next.shift();
  return next;
}

export function addPinnedFact(coachMemory = {}, text) {
  return { ...coachMemory, pinnedFacts: appendCapped(coachMemory.pinnedFacts, text, MAX_PINNED_FACTS) };
}

export function removePinnedFact(coachMemory = {}, index) {
  return { ...coachMemory, pinnedFacts: (coachMemory.pinnedFacts || []).filter((_, i) => i !== index) };
}

export function addRecentObservation(coachMemory = {}, text, lociDayStr) {
  return { ...coachMemory, recentObservations: appendCapped(coachMemory.recentObservations, text, MAX_RECENT_OBSERVATIONS, { lociDayStr }) };
}

export function removeRecentObservation(coachMemory = {}, index) {
  return { ...coachMemory, recentObservations: (coachMemory.recentObservations || []).filter((_, i) => i !== index) };
}

// [[REMEMBER: ...]] -> durable Pinned Fact. [[NOTE: ...]] -> Recent Observation.
// Both are stripped from the visible reply, mirroring coachActions.js's tags.
const MEMORY_TAG_RE = /\s*\[\[(REMEMBER|NOTE):\s*((?:[^\]]|\](?!\]))+?)\s*\]\]/gi;

export function parseMemoryTags(text = "") {
  const pinnedFacts = [];
  const observations = [];
  const cleanText = text.replace(MEMORY_TAG_RE, (_match, type, content) => {
    if (type.toUpperCase() === "REMEMBER") pinnedFacts.push(content.trim());
    else observations.push(content.trim());
    return "";
  }).trim();
  return { cleanText, pinnedFacts, observations };
}

// Injected into the coach's system prompt so it can recall facts and recent
// context across sessions. Recent Observations are capped lower here than in
// storage — the Settings panel can show the full history without bloating
// every prompt.
export function buildLociMemoryContext(coachMemory = {}) {
  const pinned = coachMemory.pinnedFacts || [];
  const recent = coachMemory.recentObservations || [];
  if (pinned.length === 0 && recent.length === 0) return "";

  const lines = [];
  if (pinned.length > 0) {
    lines.push("WHAT YOU KNOW ABOUT THEM (remember these across conversations):");
    pinned.forEach(f => lines.push(`  - ${f.text}`));
  }
  if (recent.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("RECENT NOTES (from recent conversations):");
    recent.slice(-RECENT_OBSERVATIONS_IN_PROMPT).forEach(o => lines.push(`  - ${o.text}`));
  }
  return lines.join("\n");
}
