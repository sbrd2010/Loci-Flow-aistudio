import { describe, expect, it } from "vitest";
import fs from "fs";
import { evalRequestBody, retryBudget, splitReply, gradeReply, summarize, toSpec, parsePlaybook, judgeMessages, parseJudge } from "./coachEval";

const turn = { system: "S", messages: [{ role: "assistant", content: "Hi!" }, { role: "user", content: "What next?" }] };

describe("evalRequestBody: shaped as Loci's relay sends it", () => {
  it("keeps reasoning_effort for gpt-oss on Ollama and Groq", () => {
    expect(evalRequestBody("ollama", turn, 450)).toMatchObject({ model: "gpt-oss:120b", reasoning_effort: "low", max_tokens: 450 });
    expect(evalRequestBody("groq", turn, 150)).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "low" });
  });
  it("opens Gemini's conversation with the user and sends no reasoning field", () => {
    const body = evalRequestBody("gemini", turn, 300);
    expect(body.messages.map(m => m.role)).toEqual(["system", "user"]);
    expect(body).not.toHaveProperty("reasoning_effort");
  });
  it("gives OpenRouter a reasoning object only for a gpt-oss model", () => {
    expect(evalRequestBody("openrouter", turn, 300)).not.toHaveProperty("reasoning");
    expect(evalRequestBody("openrouter", turn, 300, "openai/gpt-oss-120b:free").reasoning).toEqual({ effort: "low" });
  });
  it("switches Nemotron's thinking off on NVIDIA, as the relay does", () => {
    expect(evalRequestBody("nvidia", turn, 300).chat_template_kwargs).toEqual({ enable_thinking: false });
  });
  it("retries a cut-off reply at the app's larger budget", () => {
    expect(retryBudget(150)).toBe(1000);
    expect(retryBudget(3000)).toBe(4000);
  });
});

describe("gradeReply", () => {
  it("separates the visible reply from hidden tags and the THINK block", () => {
    expect(splitReply("[[THINK: plan]] Want me to park it? [[PARK_TASK:Report]]")).toEqual({ visible: "Want me to park it?", tags: ["[[PARK_TASK:Report]]"] });
  });
  it("fails an empty reply, shown reasoning and a claimed change with no button", () => {
    expect(gradeReply({}, { visible: "" }).reasons).toContain("empty reply");
    // Only a tag: the app shows the offer line itself (#562).
    expect(gradeReply({}, { visible: "", tags: ["[[START_FOCUS:Draft the slides|25]]"] }).verdict).toBe("pass");
    expect(gradeReply({}, { visible: "<think>hmm</think> Do the slides." }).reasons).toContain("reasoning shown");
    expect(gradeReply({}, { visible: "Got it, I'll rename it to Fix export." }).reasons).toContain("claims a change it did not make");
    expect(gradeReply({}, { visible: "Want me to park it?", tags: ["[[PARK_TASK:Report]]"] }).verdict).toBe("pass");
  });
  it("applies the question's own expectations, including through JSON", () => {
    const expectSpec = JSON.parse(JSON.stringify({ must: [toSpec(/tuesday/i)], mustNot: [toSpec(/Paris/)], maxWords: 5 }));
    expect(gradeReply(expectSpec, { visible: "Tuesday is your best day." }).verdict).toBe("pass");
    expect(gradeReply(expectSpec, { visible: "Paris, of course, is the capital city." }).reasons).toEqual(["missing /tuesday/", "forbidden /Paris/", "7 words > 5"]);
  });
});

describe("summarize", () => {
  it("counts passes per competence and keeps errors apart", () => {
    const out = summarize([{ c: "day", verdict: "pass" }, { c: "day", verdict: "fail" }, { c: "lane", error: "timeout" }]);
    expect(out).toContain("| day | 1/2 | 0 |");
    expect(out).toContain("| lane | 0/0 | 1 |");
    expect(out).toContain("**1/2** (50%)");
  });
});

describe("parsePlaybook", () => {
  it("reads every scenario of the support playbook, with its answer key", () => {
    const md = fs.readFileSync(new URL("../../docs/coach-scenario-playbook.md", import.meta.url), "utf-8");
    const all = parsePlaybook(md);
    expect(all.length).toBeGreaterThanOrEqual(120);
    expect(new Set(all.map(q => q.id)).size).toBe(all.length);
    expect(all[0]).toMatchObject({ id: "pb-001", c: "comfort", text: "Comfort me. I feel like I'm failing." });
    expect(all[0].key).toContain("Let's choose one small task.");
  });
});

describe("the judge", () => {
  it("shows the judge the message, the answer key and the reply", () => {
    const { system, messages } = judgeMessages({ text: "Comfort me", key: "Stay with the feeling.", visible: "Let's pick a task." });
    expect(system).toContain('"verdict"');
    expect(messages[0].content).toContain("Answer key: Stay with the feeling.");
    expect(messages[0].content).toContain("Coach reply: Let's pick a task.");
  });
  it("shows the judge the conversation before the message", () => {
    const { messages } = judgeMessages({ text: "the second one", visible: "The report outline.", history: [{ role: "assistant", content: "1. Invoice 2. Report outline" }] });
    expect(messages[0].content).toContain("Conversation before:\nCoach: 1. Invoice 2. Report outline");
  });
  it("reads its one line of JSON, and anything else as unjudged", () => {
    expect(parseJudge('Sure: {"verdict":"fail","reason":"pushes a task"}')).toEqual({ verdict: "fail", reason: "pushes a task" });
    expect(parseJudge('{"verdict":"great"}').verdict).toBe("unjudged");
    expect(parseJudge("I think it passes").verdict).toBe("unjudged");
  });
});
