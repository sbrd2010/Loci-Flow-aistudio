// Second pass of the Coach evaluation (#594): a judge model grades each reply of a
// coach-eval run against its answer key and the house rules, for what a regexp
// cannot see (tone, support, staying in lane). Usage (from web/):
//
//   npm run coach:judge -- --run coach-eval-out/base-ollama-playbook --judge gemini
//
// The final verdict of a reply is "fail" if the run's hard checks failed, else the
// judge's. Read a sample of the judged replies by hand: the judge can be wrong too.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { send } from "./eval-http.js";
import { EVAL_PROVIDERS, evalRequestBody, judgeMessages, parseJudge } from "../src/utils/coachEval.js";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split(/\s*--/).filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/);
  return [k, v.join(" ") || true];
}));
const run = args.run;
if (typeof run !== "string" || !existsSync(join(run, "results.jsonl"))) throw new Error("--run <coach-eval output dir> is required");
const judgeName = args.judge || "gemini";
const judge = EVAL_PROVIDERS[judgeName];
const out = join(run, `judged-${judgeName}.jsonl`);
const results = readFileSync(join(run, "results.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error);
const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(j => j.judge !== "unjudged").map(j => `${j.id}#${j.sample}`) : []);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

for (const r of results) {
  if (done.has(`${r.id}#${r.sample}`)) continue;
  await sleep(judge.gapMs || 4000);
  let res = send(judge, evalRequestBody(judgeName, judgeMessages(r), 400, args.model), run);
  if (res.code === 429) {
    if (/per day|daily|RPD/i.test(res.raw)) { console.error(`${judgeName}: daily limit reached; re-run later to resume.`); break; }
    await sleep(Math.min((res.retryAfter || 30) + 3, 120) * 1000);
    res = send(judge, evalRequestBody(judgeName, judgeMessages(r), 400, args.model), run);
  }
  if (res.code === 401 || res.code === 403) { console.error(`${judgeName} refused the key (${res.code}); stopping.`); break; }
  const j = parseJudge(res.json?.choices?.[0]?.message?.content || "");
  const rec = { id: r.id, c: r.c, sample: r.sample, hard: r.verdict, judge: j.verdict, reason: j.reason, final: r.verdict === "fail" ? "fail" : j.verdict };
  appendFileSync(out, `${JSON.stringify(rec)}\n`);
  console.log(`${r.id}#${r.sample} hard:${r.verdict} judge:${j.verdict} ${j.reason}`);
}

// One row per category: final pass / defect / fail / unjudged.
const judged = readFileSync(out, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const latest = new Map(judged.map(j => [`${j.id}#${j.sample}`, j]));
const by = new Map();
for (const j of latest.values()) {
  const row = by.get(j.c) || { pass: 0, defect: 0, fail: 0, unjudged: 0 };
  row[j.final] = (row[j.final] || 0) + 1;
  by.set(j.c, row);
}
const lines = ["| Category | Pass | Defect | Fail | Unjudged |", "|---|---|---|---|---|"];
for (const [c, row] of by) lines.push(`| ${c} | ${row.pass} | ${row.defect} | ${row.fail} | ${row.unjudged} |`);
const fails = [...latest.values()].filter(j => j.final === "fail" || j.final === "defect")
  .map(j => { const r = results.find(x => x.id === j.id && x.sample === j.sample); return `- **${j.final}** ${j.id}#${j.sample} "${r?.text}": ${j.reason}\n  > ${String(r?.visible || "").replace(/\n+/g, " ").slice(0, 300)}`; });
writeFileSync(join(run, `judged-${judgeName}.md`), [`# Judged by ${judgeName}`, "", ...lines, "", "## Fails and defects", "", ...fails, ""].join("\n"));
console.log(`\n${lines.join("\n")}\n\nReport: ${join(run, `judged-${judgeName}.md`)}`);
