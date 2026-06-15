const REASONING_TAG_RE = /\s*\[\[THINK:\s*((?:[^\]]|\](?!\]))+?)\s*\]\]/gi;

// Matches an unclosed/malformed [[THINK: ... block (no closing ]]) through to
// the end of the string — e.g. if the model's output gets cut off mid-block —
// so a literal "[[THINK:" never reaches the chat UI.
const UNCLOSED_REASONING_TAG_RE = /\s*\[\[THINK:[\s\S]*$/i;

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
    .trim();
  return cleaned || FALLBACK_REPLY;
}

// Hidden pre-reply response plan: a short structured block the model writes
// before its visible reply — State / Relevant / Angle — so the reply is
// shaped by an explicit read of the user's state and the most relevant
// context, instead of going straight from prompt to templated reply. Stripped
// via stripReasoningTag, like the memory/action tags — never shown and never
// referenced in the visible reply.
export function buildReasoningInstruction(firstName = "friend") {
  return `BEFORE YOU REPLY — sketch a private response plan:
Start your raw output with this hidden block (each line under 15 words):
[[THINK:
- State: what's actually going on for ${firstName} right now — their mood, and what they're asking for vs. what kind of response would help them take one next step.
- Relevant: the one or two things from above (profile, memory, tasks, session) that actually matter for this reply — or "nothing specific" if none stand out.
- Angle: the single best next step or angle for your reply, given the above.
]]
This is your hidden response plan — stripped automatically and never shown to ${firstName}. Like the other hidden tags, never mention, explain, or refer to it in your visible reply. Then write your visible reply, shaped by this plan — not as a restatement of it.`;
}
