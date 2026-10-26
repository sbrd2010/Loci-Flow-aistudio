// Test support for the Coach's live evaluation (#594): how each provider is asked,
// and how a reply is graded. Nothing in the app imports this file; the runner in
// web/scripts/coach-eval.js and coachEval.test.js do.
//
// Requests are shaped the way Loci's relay shapes them (forModel and friends in
// ai-proxy/src/index.js), so a run measures the models as testers meet them.

import { withoutChangeClaims } from "./coachActions";

const isGptOss = (model) => /(^|\/)gpt-oss/i.test(model);

// gapMs: wait between calls. tokensPerMinute: pace by the last call's size instead.
export const EVAL_PROVIDERS = {
  ollama: { url: "https://ollama.com/v1/chat/completions", model: "gpt-oss:120b", keyEnv: "OLLAMA_API_KEY", gapMs: 2000 },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", model: "openai/gpt-oss-120b", keyEnv: "GROQ_API_KEY", tokensPerMinute: 8000 },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-3.5-flash-lite", keyEnv: "GEMINI_API_KEY", gapMs: 5000, userFirst: true },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: "openrouter/free", keyEnv: "OPENROUTER_API_KEY", gapMs: 4000, reasoningObject: true },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/chat/completions", model: "nvidia/nemotron-3.5-lightning-30b-a3b", keyEnv: "NVIDIA_API_KEY", gapMs: 2000, noThinking: true },
};

// The request body the relay would send for this turn.
export function evalRequestBody(name, { system, messages }, maxTokens, model) {
  const p = EVAL_PROVIDERS[name];
  if (!p) throw new Error(`unknown provider ${name}`);
  const m = model || p.model;
  let msgs = messages;
  if (p.userFirst) {
    const first = msgs.findIndex(x => x.role === "user");
    msgs = first < 0 ? msgs : msgs.slice(first);
  }
  const body = { model: m, messages: [{ role: "system", content: system }, ...msgs], max_tokens: maxTokens, temperature: 0.4, top_p: 0.9 };
  if (isGptOss(m)) {
    if (p.reasoningObject) body.reasoning = { effort: "low" };
    else body.reasoning_effort = "low";
  }
  if (p.noThinking && /nemotron/i.test(m)) body.chat_template_kwargs = { enable_thinking: false };
  return body;
}

// The app retries a cut-off reply once at a larger budget (aiCall.js).
export const retryBudget = (maxTokens) => Math.min(Math.max(maxTokens * 2, 1000), 4000);

// What the user would see, and the hidden tags, from a raw reply.
export function splitReply(content = "") {
  const text = String(content || "").replace(/\s*\[\[THINK:[\s\S]*?\]\]/gi, "").trim();
  const tags = text.match(/\[\[[A-Z_]+[^\]]*\]\]/g) || [];
  const visible = text.replace(/\s*\[\[[A-Z_]+[^\]]*\]\]/g, "").trim();
  return { visible, tags };
}

// Regexps travel through JSON as { source, flags }.
export const toSpec = (re) => (re instanceof RegExp ? { source: re.source, flags: re.flags } : re);
const fromSpec = (s) => (s instanceof RegExp ? s : new RegExp(s.source, s.flags));

// A reply's verdict: "pass" or "fail" with reasons. Checks every reply for the
// things no answer may do (empty, leaked reasoning, a change claimed with no
// button behind it), then the question's own expectations.
export function gradeReply(expect = {}, { visible = "", tags = [] } = {}) {
  const reasons = [];
  if (!visible) reasons.push("empty reply");
  if (/<\/?think>|\[\[THINK/i.test(visible)) reasons.push("reasoning shown");
  if (visible && tags.length === 0 && withoutChangeClaims(visible) !== visible) reasons.push("claims a change it did not make");
  for (const s of expect.must || []) if (!fromSpec(s).test(visible)) reasons.push(`missing /${s.source || s}/`);
  for (const s of expect.mustNot || []) if (fromSpec(s).test(visible)) reasons.push(`forbidden /${s.source || s}/`);
  for (const s of expect.tags || []) if (!tags.some(t => fromSpec(s).test(t))) reasons.push(`no tag /${s.source || s}/`);
  for (const s of expect.noTags || []) if (tags.some(t => fromSpec(s).test(t))) reasons.push(`unwanted tag /${s.source || s}/`);
  const words = visible.split(/\s+/).filter(Boolean).length;
  if (expect.maxWords && words > expect.maxWords) reasons.push(`${words} words > ${expect.maxWords}`);
  return { verdict: reasons.length ? "fail" : "pass", reasons };
}

// One line per competence: passes / graded samples, and the error count.
export function summarize(results) {
  const by = new Map();
  for (const r of results) {
    const row = by.get(r.c) || { pass: 0, graded: 0, errors: 0 };
    if (r.error) row.errors += 1;
    else { row.graded += 1; if (r.verdict === "pass") row.pass += 1; }
    by.set(r.c, row);
  }
  const lines = ["| Competence | Pass | Errors |", "|---|---|---|"];
  let pass = 0, graded = 0, errors = 0;
  for (const [c, row] of by) {
    lines.push(`| ${c} | ${row.pass}/${row.graded} | ${row.errors} |`);
    pass += row.pass; graded += row.graded; errors += row.errors;
  }
  lines.push(`| **All** | **${pass}/${graded}** (${graded ? Math.round((100 * pass) / graded) : 0}%) | ${errors} |`);
  return lines.join("\n");
}
