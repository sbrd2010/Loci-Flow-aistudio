// Parses a JSON array out of an AI reply, tolerating markdown code fences,
// leading sentences, and the "AI usage note" callAI appends after the reply.
// Throws if no JSON array can be found or parsed. Moved from aiCall.js (#603),
// which re-exports it, so scripts can use it without Firebase.
export function extractJsonArray(raw) {
  // Strip usage warning appended by appendAIUsageWarning before any parsing —
  // the warning text is not JSON and causes JSON.parse to fail on first try.
  const noWarning = String(raw || "").replace(/\n\nAI usage note:[\s\S]*/i, "");
  const cleaned = noWarning.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) throw new Error("invalid_json_array");
    parsed = JSON.parse(cleaned.substring(start, end + 1));
  }
  if (!Array.isArray(parsed)) throw new Error("invalid_json_array");
  return parsed;
}
