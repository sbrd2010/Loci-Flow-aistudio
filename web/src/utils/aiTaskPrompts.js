// The four places where an AI writes tasks or steps for the user (#603): Split a
// task, Today's break-down, Add task's "Ask AI" and Mind Box's "Organize with AI".
// Each builder returns the callAI request its screen sends, so the screen and the
// live evaluation (web/scripts/task-ai-eval.js) ask exactly the same thing.
// Moved here unchanged from SplitTaskSheet.jsx, TodayTab.jsx, AddTaskDialog.jsx and
// MindBoxTab.jsx; aiTaskPrompts.test.js pins the text. The live evaluation's
// findings changed the budgets and added AS_MEANT, the stand-alone Split steps
// and the date rule in Ask AI.

import { MAX_STEP_MINUTES, STEP_MINUTE_OPTIONS } from "./splitTask";
import { thoughtText } from "./thoughts";
import { plainThought } from "./thoughtFormat";

// From the live evaluation (#603): vague titles got invented details. A rule that a
// capitalised first word is a verb didn't stop "Chase the refund" becoming the bank
// Chase in Split and Organize, so it isn't here.
const AS_MEANT = 'Read the task as the user meant it (an emoji is decoration). Never add people, companies, products or facts that aren\'t in it; if it\'s vague, make the first step finding out what it means.';

// Without "low" effort, gpt-oss spent the whole 200-350 tokens reasoning and most
// replies were cut off and retried. 800 keeps Z.ai (its limit) in the chain.
const STEP_BUDGET = { maxTokens: 800, reasoningEffort: "low" };

// Split a task: 2-4 steps of 45 minutes or less.
export function buildSplitRequest(task) {
  const original = Number(task.timeEstimateMinutes) || 0;
  return {
    systemPrompt: "You split tasks into concrete steps. Respond ONLY with a valid JSON array, no markdown.",
    messages: [{
      role: "user",
      content: `Split this task into 2-4 concrete steps, each ${MAX_STEP_MINUTES} minutes or less, together about ${original || 60} minutes.\n\nTask: "${task.title}"\n\nEach step becomes its own task in the list, so name what it is for: "Call the dentist about the crown", not "Make the call". ${AS_MEANT}\n\nReturn ONLY a JSON array like [{"text":"Collect the latest figures","minutes":30}]. Each text under 12 words. minutes is one of ${STEP_MINUTE_OPTIONS.join(", ")}.`,
    }],
    ...STEP_BUDGET,
  };
}

// Today's break-down: 3-5 micro-steps under 5 minutes each.
export function buildBreakdownRequest(task) {
  return {
    systemPrompt: "You are a productivity coach. Respond ONLY with a valid JSON array of strings, no markdown, no explanation.",
    messages: [{
      role: "user",
      content: `Break this task into 3–5 tiny, concrete micro-steps that each take under 5 minutes and feel easy to start.\n\nTask: "${task.title}"\nConcrete step: "${task.concreteStep || ""}"\nTime estimate: ${task.timeEstimateMinutes || 25} minutes\n\nReturn ONLY a JSON array of short strings (each under 12 words). Example: ["Open the document", "Write one sentence", "Save the file"]`
    }],
    ...STEP_BUDGET
  };
}

function challengeLabelFor(challengeType) {
  return challengeType === "overplanner"  ? "over-plans and researches but rarely starts (needs forced simplicity and an execution nudge)" :
    challengeType === "overwhelmed"  ? "feels overwhelmed and guilty about backlog (needs reassurance, recovery framing, and one clear next action)" :
    challengeType === "initiation"   ? "freezes before starting despite knowing what to do (needs scaffolding, micro-starts, and low-threshold first steps)" :
    challengeType === "momentum"     ? "needs a quick win to get rolling (needs P4 fast-finish tasks and visible forward movement)" :
    challengeType === "starting"     ? "struggles to start tasks (task initiation block)" :
    challengeType === "focusing"     ? "gets distracted mid-task (focus protection)" :
    challengeType === "tracking"     ? "has trouble tracking progress and staying accountable (needs visible checkpoints)" :
    "overthinks and delays finishing (perfectionism/action paralysis)";
}

// Add task, "Ask AI": a rough idea becomes a structured task.
export function buildAskAIRequest({ title, challengeType, tasks = [], profile = null }) {
  const challengeLabel = challengeLabelFor(challengeType);
  const existingTasks = (tasks || []).filter(t => !t.isDeleted && !t.isCompleted).slice(0, 8)
    .map(t => `[${t.priority}] ${t.title}`).join(", ") || "none yet";
  const profileNote = profile && profile.totalTasks >= 5
    ? `\nUser's task patterns: completion rate ${Math.round(profile.completionRate * 100)}%, dominant horizon "${profile.dominantHorizon}", avg estimate ${profile.avgEstimateMinutes}min. Use these to inform your horizon, priority, and estimate suggestions.`
    : "";
  const prompt = `You are an expert productivity coach specialising in focus, momentum, and execution support. The user typed this rough task idea: "${title.trim()}".

Transform it into a well-structured, focus-friendly task. The user's core challenge: ${challengeLabel}.${profileNote}

TASK DESIGN RULES:
- Title must be specific and outcome-oriented (not vague verbs like "work on" or "think about")
- Keep every date, deadline, amount, name and place from the idea in the title
- ${AS_MEANT}
- microStep is the DOOR-HANDLE move — the single physical action that takes under 2 minutes and removes the initiation barrier
- Priority should account for the user's challenge: if they struggle to start, lean P3/P4 to reduce pressure
- Time estimate should be honest — tasks often take 1.5x expected time
- horizonLevel: "today" only if deadline is today or extremely urgent; "week" for most tasks; "month"/"quarter" for longer-term goals
- Never use the word "ADHD" in your response
- Their current tasks for context: ${existingTasks}
- subSteps: extract 2-4 key points or sub-tasks from the original input that would be lost in the shortened title. Use [] if the input is short or the title already captures everything.

Respond with ONLY valid JSON (no markdown, no code blocks), exactly this structure:
{"title":"<specific outcome-oriented title, max 60 chars>","microStep":"<single door-handle action, max 60 chars>","priority":"P2","estimateMinutes":25,"horizonLevel":"week","subSteps":[{"text":"key point 1"},{"text":"key point 2"}]}

priority options: P1 (urgent+must do today), P2 (important this week), P3 (normal queue), P4 (easy quick-win, under 15 min)
estimateMinutes options: 15, 25, 45, 60, 120, 240, 360
horizonLevel options: "today", "week" (default), "month", "quarter", "halfyear"`;
  return {
    systemPrompt: "You are a productivity coach. Respond ONLY with valid JSON, no markdown.",
    messages: [{ role: "user", content: prompt }],
    ...STEP_BUDGET
  };
}

// Mind Box, "Organize with AI": raw thoughts become atomic tasks.
export function buildOrganizeRequest({ items, profile = null }) {
  const profileNote = profile && profile.totalTasks >= 5
    ? `\nUser context: completion rate ${Math.round(profile.completionRate * 100)}%, dominant horizon "${profile.dominantHorizon}", avg estimate ${profile.avgEstimateMinutes}min. Weight horizon suggestions toward their patterns.`
    : "";
  // Include each item's stable ID so AI can return sourceId for safe brain-dump clearing
  const prompt = `Here are raw thoughts from a brain dump:
${items.map((item, i) => `${i + 1}. [id:${item.id}] ${plainThought(thoughtText(item))}`).join("\n")}

Turn these into clear, atomic, actionable tasks. For each numbered thought, decide:
- ONE task — a single small action with nothing else worth keeping
- ONE task with subSteps and/or sourceSummary — a single action that carries extra details worth preserving
- MULTIPLE tasks sharing the same sourceId — when a thought mixes several distinct, unrelated actions, OR is one big/messy item covering more ground than a single 10-45 min task. Split it into separate atomic tasks instead of one vague catch-all
- ONE practical next-step task — only for pure venting/emotional overwhelm with no concrete action in it. Turn it into a single small, low-shame, concrete next step

Hard rules:
- Never merge unrelated thoughts into one task, and never write a vague catch-all title like "Handle admin" or "Sort things out"
- Titles are action-style and specific (max 60 chars) — keep the concrete subject from the text: company, person, amount, place, deadline
- Every task has a concreteStep: the single easiest physical/digital first action (max 60 chars), e.g. "Email Priya at Acme re: June 20 deadline", not "Follow up"
- Preserve every concrete detail — names, dates, deadlines, companies, amounts, links, places, people, constraints, decision criteria. Never invent details that aren't in the original text. Anything that doesn't fit in the title/concreteStep goes in subSteps (2-7 short bullet points) and/or sourceSummary (1-2 sentences). Don't drop it
- Prefer 10-45 minute tasks; if a thought is too big for one, split it rather than writing one vague multi-hour task
- ${AS_MEANT}

For each task, return:
- sourceId: the id from the [id:...] tag of the thought it came from. Every task split from the same thought shares that sourceId
- title, concreteStep: as above
- subSteps: 2-7 {"text": "..."} items preserving details that don't fit above. [] if nothing else to preserve
- sourceSummary: optional 1-2 sentence summary of context/details from the thought that don't fit elsewhere. "" if not needed
- splitReason: only when this is one of several tasks from the same thought — a short phrase (max 40 chars), e.g. "Recruiter follow-up". Omit otherwise
- horizonLevel: "today" (due/urgent today), "week" (default, most items), "month" or "quarter" (career/job-search pipeline, concrete future plans), "office" (current job/lab/company work), "halfyear" (vague long-term ideas with no real timeline)
- priority: "P1" (urgent), "P2" (important), "P3" (normal), "P4" (quick, <15 min)
- category: "Career" (job search, CV, applications, networking, career growth), "Work" (current job/lab/company tasks), "Health" (medicine, diet, walking, doctor, body/health admin), "Personal" (household, family, travel, errands, life admin)
- timeEstimateMinutes: realistic estimate for concreteStep — one of 15, 25, 45, 60, 120, 240, 360; prefer 15-45${profileNote}

Rules: default horizonLevel to "week" unless clearly urgent or work-related. Never use the word "ADHD".

Return ONLY a JSON array, no markdown. Example showing a thought split into two tasks, each with preserved details:
[{"sourceId":"abc1","title":"Email Priya at Acme re June 20 deadline","horizonLevel":"week","priority":"P2","category":"Work","timeEstimateMinutes":25,"concreteStep":"Open email, write 3 sentences, hit send","subSteps":[{"text":"Mention the June 20 sprint deadline explicitly"},{"text":"Ask for the updated spec doc link"},{"text":"CC manager on the thread"}],"sourceSummary":"Priya at Acme needs a reply before their June 20 sprint planning; she asked about the API contract.","splitReason":"Recruiter follow-up"},{"sourceId":"abc1","title":"Update project tracker for Acme sprint","horizonLevel":"week","priority":"P3","category":"Work","timeEstimateMinutes":15,"concreteStep":"Open Notion, mark Acme block as 'waiting on response'","subSteps":[{"text":"Link the email thread in the tracker"},{"text":"Set a follow-up flag for June 19"}],"sourceSummary":"","splitReason":"Tracker update"}]`;
  return {
    systemPrompt: "You are a productivity coach. Respond ONLY with a valid JSON array, no markdown. Preserve every concrete detail from the input — never compress or summarize away names, dates, deadlines, amounts, or other specifics to save space.",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4000,
    reasoningEffort: "low"
  };
}
