// Live evaluation of the Coach (#594): sends each test question to a provider the
// way Loci's relay would, grades the reply, and writes a report. It spends that
// provider's free allowance, so it never runs in CI. Usage (from web/):
//
//   npm run coach:eval -- --provider ollama --set syllabus --samples 3
//   npm run coach:eval -- --provider groq --only day-1,perf-3
//
// Keys: in a Claude Code cloud session the network proxy adds them, so nothing is
// set. Locally, export the provider's key (OLLAMA_API_KEY, GROQ_API_KEY, …); it is
// handed to curl on stdin, never printed or put on the command line.
// Made-up data only: the questions are asked as the fixture user, never as you.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { send as sendTo } from "./eval-http.js";
import { join } from "node:path";
import { QUESTIONS, buildTurn } from "../src/utils/coachSyllabus.fixture.js";
import { EVAL_PROVIDERS, evalRequestBody, retryBudget, splitReply, gradeReply, summarize, toSpec, parsePlaybook } from "../src/utils/coachEval.js";
import { SCENARIOS, SCENARIO_USERS } from "../src/utils/coachScenarios.fixture.js";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split(/\s*--/).filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/);
  return [k, v.join(" ") || true];
}));
const provider = args.provider || "ollama";
const p = EVAL_PROVIDERS[provider];
if (!p) throw new Error(`--provider must be one of ${Object.keys(EVAL_PROVIDERS).join(", ")}`);
const set = args.set || "syllabus";
const samples = Math.max(1, Number(args.samples) || 1);
// relay: what every tester gets since #591 (full prompt). lean: a key built into the app.
const ownKey = (args.path || "relay") !== "lean";
const only = typeof args.only === "string" ? new Set(args.only.split(",")) : null;
const outDir = typeof args.out === "string" ? args.out : join("coach-eval-out", `${provider}-${set}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`);
mkdirSync(outDir, { recursive: true });

// syllabus: #555's questions. scenarios: #594's bank (other users, follow-ups, safety…).
// playbook: the support scenarios in web/docs. holdout: the unseen paper, run once at
// the end (#555), so it is loaded only when asked for. owner: the owner's own
// phrasings, a private JSON file in coach-eval-out/ (regexps as { source, flags }).
const SETS = {
  syllabus: () => QUESTIONS,
  scenarios: () => SCENARIOS,
  playbook: () => parsePlaybook(readFileSync(new URL("../docs/coach-scenario-playbook.md", import.meta.url), "utf8")),
  holdout: async () => (await import("../src/utils/coachSyllabus.holdout.js")).HOLDOUT,
  // Kept out of the repo: coach-eval-out/ is gitignored.
  owner: () => JSON.parse(readFileSync(new URL("./owner-questions.json", import.meta.url), "utf8")),
};
if (!SETS[set]) throw new Error(`--set must be one of ${Object.keys(SETS).join(", ")}`);
const bank = await SETS[set]();
const turns = [];
for (const q of bank) {
  if (only && !only.has(q.id)) continue;
  const u = SCENARIO_USERS[q.user || "sam"];
  // A user with no past conversation sends this as their first message.
  const asked = q.history || !u.history ? q : { ...q, history: u.history };
  const t = buildTurn(asked, { ownKey, fixture: u.make(), ...(u.now ? { now: u.now } : {}), ...(u.windows ? { windows: u.windows } : {}) });
  if (t.local || t.card !== undefined) continue; // answered on the device or by the app, not a model
  turns.push({ id: q.id, c: q.c, text: q.text, mode: t.mode, system: t.system, messages: t.messages, maxTokens: t.maxTokens,
    key: q.key || null,
    expect: { must: (q.expect?.must || []).map(toSpec), mustNot: (q.expect?.mustNot || []).map(toSpec), tags: (q.expect?.tags || []).map(toSpec), noTags: (q.expect?.noTags || []).map(toSpec), maxWords: q.expect?.maxWords || null } });
}

const resultsFile = join(outDir, "results.jsonl");
const done = new Set(existsSync(resultsFile)
  ? readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error).map(r => `${r.id}#${r.sample}`)
  : []);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const send = (body) => sendTo(p, body, outDir);

let lastTokens = 0;
const all = [];
outer: for (const t of turns) {
  for (let sample = 1; sample <= samples; sample++) {
    if (done.has(`${t.id}#${sample}`)) continue;
    if (lastTokens) await sleep(p.tokensPerMinute ? Math.max(15000, Math.ceil((lastTokens / p.tokensPerMinute) * 60000) + 4000) : p.gapMs);
    let r = send(evalRequestBody(provider, t, t.maxTokens, args.model));
    if (r.code === 401 || r.code === 403) { console.error(`${provider} refused the key (${r.code}); stopping.`); break outer; }
    if (r.code === 429) {
      if (/per day|daily|TPD|RPD|free-models-per-day/i.test(r.raw)) { console.error(`${provider}: daily limit reached; stopping (re-run later to resume).`); break outer; }
      await sleep(Math.min((r.retryAfter || 30) + 3, 120) * 1000);
      r = send(evalRequestBody(provider, t, t.maxTokens, args.model));
    }
    let retried = false;
    if (r.code === 200 && r.json?.choices?.[0]?.finish_reason === "length") {
      retried = true;
      r = send(evalRequestBody(provider, t, retryBudget(t.maxTokens), args.model));
    }
    const history = t.messages.slice(0, -1).map(m => ({ role: m.role, content: String(m.content).slice(0, 400) }));
    const rec = { id: t.id, c: t.c, text: t.text, mode: t.mode, sample, http: r.code, ms: r.ms, retried, ...(t.key ? { key: t.key } : {}), ...(history.length ? { history } : {}) };
    const choice = r.json?.choices?.[0];
    if (r.code !== 200 || !choice) {
      rec.error = String(r.json?.error?.message || r.raw || "no reply").slice(0, 200);
    } else {
      const content = typeof choice.message?.content === "string" ? choice.message.content : "";
      const { visible, tags } = splitReply(content);
      Object.assign(rec, { model: r.json.model, finish: choice.finish_reason, visible, tags, ...gradeReply(t.expect, { visible, tags }) });
      lastTokens = r.json.usage?.total_tokens || 6000;
    }
    appendFileSync(resultsFile, `${JSON.stringify(rec)}\n`);
    all.push(rec);
    console.log(`${t.id}#${sample} ${rec.http} ${rec.error ? `ERROR ${rec.error.slice(0, 80)}` : rec.verdict === "pass" ? "PASS" : `FAIL ${rec.reasons.join("; ")}`}`);
  }
}

// A resumed run appends a retry after its error: the latest record per sample counts.
const everything = [...new Map(readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).map(r => [`${r.id}#${r.sample}`, r])).values()];
const failures = everything.filter(r => r.error || r.verdict === "fail")
  .map(r => `- **${r.id}#${r.sample}** "${r.text}": ${r.error ? `error: ${r.error}` : `${r.reasons.join("; ")}\n  > ${String(r.visible).replace(/\n+/g, " ").slice(0, 400)}`}`);
writeFileSync(join(outDir, "summary.md"), [`# Coach eval: ${provider} (${args.model || p.model}), set ${set}, ${ownKey ? "full" : "lean"} prompt`, "", summarize(everything), "", "## Failures and errors (auto-graded; read the replies too)", "", ...failures, ""].join("\n"));
console.log(`\n${summarize(everything)}\n\nReport: ${join(outDir, "summary.md")}`);
