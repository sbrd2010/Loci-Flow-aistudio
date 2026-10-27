// Test support for the AI task-writing evaluation (#603). Nothing in the app
// imports this file; web/scripts/task-ai-eval.js and taskAiEval.test.js do.
//
// Each path's reply is read the way its screen reads it, so "fallback" here means
// the user saw the same failure: Split falls back to writing steps by hand, the
// break-down shows an error, Ask AI says "fill in manually", Organize finds nothing.

import { extractJsonArray } from "./jsonArray";
import { normalizeAiOrganizeSuggestions } from "./taskOps";
import { buildSplitRequest, buildBreakdownRequest, buildAskAIRequest, buildOrganizeRequest } from "./aiTaskPrompts";
import { STEP_MINUTE_OPTIONS, splitStepRange } from "./splitTask";

export const TASK_AI_PATHS = ["split", "breakdown", "askAI", "organize"];

// The request each screen would send for one test case.
export function taskAiRequest(path, c) {
  const task = { title: c.title, concreteStep: c.concreteStep || "", timeEstimateMinutes: c.minutes || 0 };
  if (path === "split") return buildSplitRequest(task);
  if (path === "breakdown") return buildBreakdownRequest(task);
  if (path === "askAI") return buildAskAIRequest({ title: c.title, challengeType: "initiation", tasks: [] });
  return buildOrganizeRequest({ items: [{ id: "t1", text: c.title }] });
}

// The texts the user would see, or null when the screen would fall back.
export function parseTaskAiReply(path, raw, minutes) {
  try {
    if (path === "split") {
      const match = String(raw).replace(/```json|```/g, "").match(/\[[\s\S]*\]/);
      const parsed = JSON.parse(match ? match[0] : raw);
      const good = (Array.isArray(parsed) ? parsed : []).filter(s => s && typeof s.text === "string" && s.text.trim())
        .map(s => ({ text: s.text.trim(), minutes: STEP_MINUTE_OPTIONS.includes(Number(s.minutes)) ? Number(s.minutes) : 25 }));
      const { min, max } = splitStepRange(minutes);
      return good.length >= min && good.length <= max ? good.map(s => s.text) : null;
    }
    if (path === "breakdown") {
      const steps = extractJsonArray(raw).filter(s => typeof s === "string" && s.trim()).slice(0, 5);
      return steps.length ? steps.map(s => s.trim()) : null;
    }
    if (path === "askAI") {
      const cleaned = String(raw).replace(/```json|```/g, "").trim();
      let parsed;
      try { parsed = JSON.parse(cleaned); } catch { const m = cleaned.match(/\{[\s\S]*\}/); if (!m) return null; parsed = JSON.parse(m[0]); }
      const subs = Array.isArray(parsed.subSteps) ? parsed.subSteps.filter(s => s && s.text).map(s => s.text) : [];
      return [parsed.title, parsed.microStep, ...subs].filter(x => typeof x === "string" && x.trim());
    }
    const valid = normalizeAiOrganizeSuggestions(extractJsonArray(raw), [{ id: "t1", text: "" }]);
    if (!valid.length) return null;
    return valid.flatMap(t => [t.title, t.concreteStep, ...(t.subSteps || []).map(s => s.text || s), t.sourceSummary]).filter(x => typeof x === "string" && x.trim());
  } catch { return null; }
}

const STOP = new Set(["the", "and", "for", "out", "with", "from", "that", "this", "your", "about", "before", "after", "into", "what", "when", "then", "them", "they", "have", "will", "should", "due", "deadline"]);
const words = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(w => !STOP.has(w));

// "pass" or "fail" with reasons for one parsed reply.
//   grounded: at least one text shares a word (3+ letters) with the title; for
//     Split every step must, as each step becomes its own task in the list.
//   keep (Ask AI and Organize, which rewrite the title): every pattern appears.
//   mustNot (all paths): no pattern appears.
export function gradeTaskAi(path, texts, c) {
  if (!texts) return { verdict: "fail", reasons: ["fallback: the screen shows no AI result"] };
  const reasons = [];
  // Models write narrow and no-break spaces and hyphens ("May\u202f28").
  const plain = texts.map(t => String(t).replace(/[\u00a0\u202f]/g, " ").replace(/\u2011/g, "-"));
  const all = plain.join(" \n ");
  const titleWords = new Set(words(c.title));
  const grounded = (t) => words(t).some(w => titleWords.has(w));
  if (!grounded(all)) reasons.push("not grounded in the title");
  else if (path === "split" && !plain.every(grounded)) reasons.push("a step doesn't name the task");
  if (path === "askAI" || path === "organize") {
    for (const re of c.keep || []) if (!re.test(all)) reasons.push(`dropped /${re.source}/`);
  }
  for (const re of c.mustNot || []) if (re.test(all)) reasons.push(`invented /${re.source}/`);
  return { verdict: reasons.length ? "fail" : "pass", reasons };
}
