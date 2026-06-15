const REASONING_TAG_RE = /\s*\[\[THINK:\s*((?:[^\]]|\](?!\]))+?)\s*\]\]/gi;

// Strips the hidden "think before replying" scratchpad (see
// buildReasoningInstruction) from the model's raw output before any other
// tag parsing — same non-greedy pattern as coachMemory's MEMORY_TAG_RE.
export function stripReasoningTag(text = "") {
  return text.replace(REASONING_TAG_RE, "").trim();
}

// Hidden pre-reply scratchpad: a short structured block the model writes
// before its visible reply, so the reply is conditioned on an explicit read
// of the user's state and the most relevant context — instead of jumping
// straight from prompt to templated reply. Stripped via stripReasoningTag,
// like the memory/action tags — never shown and never referenced in the
// visible reply.
export function buildReasoningInstruction(firstName = "friend") {
  return `BEFORE YOU REPLY — think it through first:
Start your raw output with this hidden block (each line under 15 words):
[[THINK:
- State: what's actually going on for ${firstName} right now — their mood, and what they're asking for vs. what they might really need.
- Relevant: the one or two things from above (profile, memory, tasks, session) that actually matter for this reply — or "nothing specific" if none stand out.
- Angle: the single best next step or angle for your reply, given the above.
]]
This block is stripped automatically and never shown to ${firstName} — like the other hidden tags, never mention, explain, or refer to it in your visible reply. Then write your visible reply, shaped by this thinking — not as a restatement of it.`;
}
