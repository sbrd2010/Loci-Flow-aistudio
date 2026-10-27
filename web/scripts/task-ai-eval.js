// Live evaluation of the four AI task-writing paths (#603): Split a task, Today's
// break-down, Add task's "Ask AI" and Mind Box's "Organize with AI". Sends each
// made-up case the way its screen does, reads the reply the way the screen does,
// and grades it. Spends the provider's free allowance, so it never runs in CI.
//
//   npm run task-ai:eval -- --provider ollama --samples 3
//   npm run task-ai:eval -- --provider ollama --only emoji,jargon --paths split
//   npm run task-ai:eval -- --out coach-eval-out/task-ai-p1 --regrade   (no calls)
//
// Keys: as in coach-eval.js (the cloud proxy adds them; locally, an env variable).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { send } from "./eval-http.js";
import { EVAL_PROVIDERS, evalRequestBody, retryBudget } from "../src/utils/coachEval.js";
import { TASK_AI_PATHS, taskAiRequest, parseTaskAiReply, gradeTaskAi } from "../src/utils/taskAiEval.js";
import { TASK_AI_CASES } from "../src/utils/taskAiCases.fixture.js";
import { buildLocalSafetyReply } from "../src/utils/crisisSafety.js";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split(/\s*--/).filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/);
  return [k, v.join(" ") || true];
}));
const provider = args.provider || "ollama";
const p = EVAL_PROVIDERS[provider];
if (!p) throw new Error(`--provider must be one of ${Object.keys(EVAL_PROVIDERS).join(", ")}`);
const samples = Math.max(1, Number(args.samples) || 1);
const only = typeof args.only === "string" ? new Set(args.only.split(",")) : null;
const paths = typeof args.paths === "string" ? args.paths.split(",") : TASK_AI_PATHS;
const outDir = typeof args.out === "string" ? args.out : join("coach-eval-out", `task-ai-${provider}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`);
mkdirSync(outDir, { recursive: true });

// The body the app's relay call sends, with each provider's own settings
// (coachEval.js evalRequestBody) and the reasoning effort the screen asks for.
const body = (req, maxTokens) =>
  evalRequestBody(provider, { system: req.systemPrompt, messages: req.messages }, maxTokens, args.model, req.reasoningEffort || null);

const resultsFile = join(outDir, "results.jsonl");
const done = new Set(existsSync(resultsFile)
  ? readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error).map(r => `${r.id}/${r.path}#${r.sample}`)
  : []);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let lastTokens = 0;
outer: for (const c of args.regrade ? [] : TASK_AI_CASES) {
  if (only && !only.has(c.id)) continue;
  if (c.local) {
    const ok = !!buildLocalSafetyReply(c.title, "Sam");
    console.log(`${c.id} local safety reply: ${ok ? "PASS" : "FAIL"}`);
    appendFileSync(resultsFile, `${JSON.stringify({ id: c.id, path: "local", sample: 1, verdict: ok ? "pass" : "fail", reasons: ok ? [] : ["crisis title reached the model"] })}\n`);
    continue;
  }
  for (const path of paths) {
    const req = taskAiRequest(path, c);
    for (let sample = 1; sample <= samples; sample++) {
      if (done.has(`${c.id}/${path}#${sample}`)) continue;
      if (lastTokens) await sleep(p.tokensPerMinute ? Math.max(15000, Math.ceil((lastTokens / p.tokensPerMinute) * 60000) + 4000) : p.gapMs);
      let r = send(p, body(req, req.maxTokens), outDir);
      if (r.code === 401 || r.code === 403) { console.error(`${provider} refused the key (${r.code}); stopping.`); break outer; }
      if (r.code === 429) {
        if (/per day|daily|TPD|RPD|free-models-per-day/i.test(r.raw)) { console.error(`${provider}: daily limit reached; stopping (re-run later to resume).`); break outer; }
        await sleep(Math.min((r.retryAfter || 30) + 3, 120) * 1000);
        r = send(p, body(req, req.maxTokens), outDir);
      }
      // The app retries a cut-off reply once at a larger budget.
      let retried = false;
      if (r.code === 200 && r.json?.choices?.[0]?.finish_reason === "length") {
        retried = true;
        r = send(p, body(req, retryBudget(req.maxTokens)), outDir);
      }
      const rec = { id: c.id, path, sample, http: r.code, ms: r.ms, retried, title: c.title };
      const choice = r.json?.choices?.[0];
      if (r.code !== 200 || !choice) {
        rec.error = String(r.json?.error?.message || r.raw || "no reply").slice(0, 200);
      } else {
        const raw = typeof choice.message?.content === "string" ? choice.message.content : "";
        const texts = parseTaskAiReply(path, raw);
        Object.assign(rec, { finish: choice.finish_reason, texts, ...(texts ? {} : { raw: raw.slice(0, 4000) }), ...gradeTaskAi(path, texts, c) });
        lastTokens = r.json.usage?.total_tokens || 2000;
      }
      appendFileSync(resultsFile, `${JSON.stringify(rec)}\n`);
      console.log(`${c.id}/${path}#${sample} ${rec.http} ${rec.error ? `ERROR ${rec.error.slice(0, 80)}` : rec.verdict === "pass" ? "PASS" : `FAIL ${rec.reasons.join("; ")}`}`);
    }
  }
}

// The latest record per sample counts (a resumed run appends after an error).
// Replies are graded again here, so a changed grader or case needs no new calls.
const latest = new Map();
for (const r of readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))) latest.set(`${r.id}/${r.path}#${r.sample}`, r);
const cases = new Map(TASK_AI_CASES.map(c => [c.id, c]));
const all = [...latest.values()].map(r => r.error || r.path === "local" ? r : { ...r, ...gradeTaskAi(r.path, r.texts || null, cases.get(r.id)) });
const lines = ["| Path | Pass | Errors |", "|---|---|---|"];
for (const path of ["local", ...TASK_AI_PATHS]) {
  const rs = all.filter(r => r.path === path);
  if (!rs.length) continue;
  const graded = rs.filter(r => !r.error);
  lines.push(`| ${path} | ${graded.filter(r => r.verdict === "pass").length}/${graded.length} | ${rs.length - graded.length} |`);
}
const fails = all.filter(r => r.verdict === "fail").map(r => `- ${r.id}/${r.path}#${r.sample}: ${r.reasons.join("; ")}${r.texts ? ` — ${JSON.stringify(r.texts).slice(0, 200)}` : ""}`);
writeFileSync(join(outDir, "summary.md"), [`# AI task-writing eval: ${provider} (${args.model || p.model})`, "", ...lines, "", "## Failures (read the replies too)", "", ...fails, ""].join("\n"));
console.log(`\n${lines.join("\n")}\n\nReport: ${join(outDir, "summary.md")}`);
