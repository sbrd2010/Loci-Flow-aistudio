import { callAI, getAIKeys, hasAIKey, extractJsonArray } from "./aiCall";

// Suggested steps for a task (52c). They are offered, never added: the sheet
// lists them under SUGGESTED and each one goes in only when tapped.
//
// Resolves to { steps: string[] }, or { error: "no-key" | "failed" }.
export async function suggestSteps(task, existing = []) {
  if (!hasAIKey()) return { error: "no-key" };
  const { groqKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const have = existing.map(s => s.text).filter(Boolean);
  try {
    const raw = await callAI({
      groqKey, geminiKey, cerebrasKey, zaiKey,
      systemPrompt: "You are a productivity coach. Respond ONLY with a valid JSON array of strings, no markdown, no explanation.",
      messages: [{
        role: "user",
        content: `Break this task into 3–5 tiny, concrete micro-steps that each take under 5 minutes and feel easy to start.\n\nTask: "${task.title}"\nTime estimate: ${task.timeEstimateMinutes || 25} minutes\n${have.length ? `Steps it already has (don't repeat them): ${have.map(s => `"${s}"`).join(", ")}\n` : ""}\nReturn ONLY a JSON array of short strings (each under 12 words). Example: ["Open the document", "Write one sentence", "Save the file"]`,
      }],
      maxTokens: 200,
    });
    // Not a step the task has, and not one this answer already gave.
    const seen = new Set(have.map(s => s.trim().toLowerCase()));
    const steps = extractJsonArray(raw)
      .filter(s => typeof s === "string" && s.trim())
      .map(s => s.trim().slice(0, 300))
      .filter(s => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
    return steps.length ? { steps } : { error: "failed" };
  } catch {
    return { error: "failed" };
  }
}
