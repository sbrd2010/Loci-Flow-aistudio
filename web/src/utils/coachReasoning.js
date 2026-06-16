const REASONING_TAG_RE = /\s*\[\[THINK:\s*((?:[^\]]|\](?!\]))+?)\s*\]\]/gi;

// Matches an unclosed/malformed [[THINK: ... block (no closing ]]) through to
// the end of the string — e.g. if the model's output gets cut off mid-block —
// so a literal "[[THINK:" never reaches the chat UI.
const UNCLOSED_REASONING_TAG_RE = /\s*\[\[THINK:[\s\S]*$/i;

// Some models omit the [[ ]] delimiters and write "THINK: - Mood: ... - Move: ..."
// as plain text. Strip from "THINK:" at the start through the end of the
// "- Move:" entry (always the last field). Uses [^.]* for Move content so
// the period that terminates the field (and the whitespace that follows it)
// marks the exact boundary whether inline or multiline.
const BARE_REASONING_RE = /^\s*THINK:\s*-\s*Mood:[\s\S]*?-\s*Move:[^.]*\.?\s*/i;

const FALLBACK_REPLY = "I'm here. Let's pick one small next step.";

// Strips the hidden "private response plan" block (see
// buildReasoningInstruction) from the model's raw output before any other tag
// parsing — same non-greedy pattern as coachMemory's MEMORY_TAG_RE.
// Fail-safe: also drops any malformed/unclosed [[THINK: ... block so
// "[[THINK:" never leaks into the visible reply, and falls back to a safe
// reply if nothing visible remains after stripping.
export function stripReasoningTag(text = "") {
  const cleaned = text
    .replace(REASONING_TAG_RE, "")
    .replace(UNCLOSED_REASONING_TAG_RE, "")
    .replace(BARE_REASONING_RE, "")
    .trim();
  return cleaned || FALLBACK_REPLY;
}

// Hidden pre-reply response plan: a structured block the model writes before
// its visible reply, forcing it to reason about mood, gaps, patterns, and
// risks before composing anything. Stripped via stripReasoningTag — never
// shown and never referenced in the visible reply.
export function buildReasoningInstruction(firstName = "friend") {
  return `BEFORE YOU REPLY — sketch a private response plan:
Start your raw output with this hidden block (each line under 20 words):
[[THINK:
- Mood: infer ${firstName}'s energy/emotion from their word choice — frustrated, scattered, avoidant, focused, deflecting, etc. — or "neutral" if no signal.
- Gap: any observed friction from the data — pinned task not started, many open tasks, missed deadline move, no completions yet today — or "none".
- Pattern: any recurring theme from their profile or memory that's relevant here — or "none visible".
- Trap: one thing that would feel tone-deaf or useless right now — e.g. "listing all their tasks", "generic encouragement", "jumping to a fix before they feel heard".
- Move: single best angle for this reply — empathy-first, specific reframe, name one task, action-nudge, or ask one good question.
]]
This is your hidden response plan — stripped automatically and never shown to ${firstName}. Like the other hidden tags, never mention, explain, or refer to it in your visible reply. Then write your visible reply, shaped by this plan — not a restatement of it.`;
}
