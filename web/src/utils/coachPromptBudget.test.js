import { describe, expect, it } from "vitest";
import * as L from "./lociAIContext";
import { getLociDayStr } from "./dailyAnchors";
import { getFocusWindows } from "./focusWindows";
import { buildPersonaInstruction } from "./coachPersona";
import { buildProfileContext } from "./coachProfile";
import { buildLociMemoryContext } from "./coachMemory";
import { buildCoachSystemPrompt } from "./coachSystemPrompt";
import { trimHistoryForLLM, historyLimitForMode } from "./coachContextMode";
import { buildSessionSummaryContext, buildPendingSummaryContext, pendingSummaryMessages, SUMMARY_UPDATE_MIN_PENDING } from "./coachSessionSummary";
import { profileToCoachContext } from "./userProfile";

// Prompt-size budgets per Coach mode (#545 C8, C39). Groq's free tier counts
// prompt + max_tokens against 8,000 tokens per minute before it runs anything,
// and answers 413 above that. Live calls on 2026-10-24 measured 4.2–4.4 chars
// per token on these prompts; 4.2 is the low end, so the estimate errs high.
const CHARS_PER_TOKEN = 4.2;
const GROQ_TPM = 8000;
const SUMMARY_TURN_EXTRA_TOKENS = 300; // CoachTab adds this when a summary rewrite is due
const MAX_TOKENS = { full_task: 450, compact_task: 280, emotional: 300, profile_reflection: 300, light: 150 };
const ZAI_MAX_PAYLOAD_CHARS = 12000; // aiCall.js

const NOW = new Date(2026, 9, 21, 10, 0);
const WINDOWS = getFocusWindows({});
const DAY = getLociDayStr(NOW, WINDOWS);
const FIRST = "Sam";
const filler = (lead, n) => (`${lead} ` + "The plan was to keep each step small so it is easy to begin and easy to finish. ".repeat(20)).slice(0, n);

const TITLES = ["Draft the quarterly report outline", "Review pull request for search page", "Email the venue about the workshop", "Prepare slides for Thursday sync", "Fix the invoice export bug", "Read chapter 4 of the design book", "Book dentist appointment", "Plan grocery list for the week", "Update the onboarding checklist", "Sketch logo ideas for the side project", "Reply to the landlord about repairs", "Write tests for the date parser", "Clean up the shared drive folders", "Call the bank about the card", "Outline the blog post on habits", "Renew the library books", "Refactor the settings page", "Prepare the budget spreadsheet", "Repot the fern", "Draft the team retro notes"];

function fixture(large) {
  let id = 0;
  const task = (title, horizonLevel, extra = {}) => {
    id += 1;
    return { uuid: `t${String(id).padStart(4, "0")}-aaaa-bbbb`, title, horizonLevel, priority: ["P1", "P2", "P3"][id % 3], category: id % 2 ? "Work" : "Personal", timeEstimateMinutes: [25, 45, 60, 30][id % 4], orderIndex: id, lastUpdated: NOW.getTime() - id * 600000, ...extra };
  };
  const tasks = [];
  for (let i = 0; i < (large ? 20 : 6); i++) {
    tasks.push(task(TITLES[i], "today", i === 0 ? { isNowFocus: true, subSteps: [{ text: "List the sections", done: true }, { text: "Pull last quarter numbers", done: false }] } : {}));
  }
  for (let i = 0; i < (large ? 3 : 2); i++) tasks.push(task(`Send weekly update ${i + 1}`, "today", { isCompleted: true, dateCompletedString: DAY }));
  for (let i = 0; i < (large ? 8 : 4); i++) tasks.push(task(`Week: ${TITLES[(i + 5) % 20]}`, "week"));
  for (let i = 0; i < (large ? 6 : 3); i++) tasks.push(task(`Month: ${TITLES[(i + 9) % 20]}`, "month"));
  const config = {
    coachProfileNote: filler("I work best in the morning.", large ? 480 : 200),
    coachPersonaNote: large ? filler("Be direct.", 280) : "",
    deadlineLabel: "Workshop launch", deadlineDate: "2026-11-02", deadlineAction: "finish the slides",
    dailyAnchors: [{ text: "One thing at a time" }, { text: "Start before you feel ready" }],
    coachMemory: {
      pinnedFacts: Array.from({ length: large ? 15 : 5 }, (_, i) => ({ text: filler(`Fact ${i + 1}: prefers 25-minute blocks.`, large ? 180 : 80) })),
      recentObservations: Array.from({ length: large ? 30 : 6 }, (_, i) => ({ text: filler(`Note ${i + 1}: slow start after meetings.`, large ? 180 : 90), lociDayStr: DAY })),
    },
  };
  const brainDump = Array.from({ length: large ? 10 : 4 }, (_, i) => ({ text: `Thought ${i + 1}: try a new notes app`, createdAt: NOW.getTime() - i * 3600000 }));
  const contributions = Array.from({ length: 8 }, (_, i) => ({ dateString: L.getLocalDateString(new Date(NOW.getTime() - i * 86400000)), count: (i * 3) % 5 }));
  const summary = { sessionSummary: filler("Current objective: start the report outline.", large ? 1200 : 600) };
  return { tasks, config, brainDump, contributions, summary };
}

// The same inputs CoachTab.jsx passes, with 10 earlier messages of 250 chars.
function buildRequest(mode, { large = false, summaryTurn = false, carried = 0 } = {}) {
  const { tasks, config, brainDump, contributions, summary } = fixture(large);
  const userText = "What should I work on next today?";
  const history = Array.from({ length: 10 + carried }, (_, i) => ({ isUser: i % 2 === 0, text: filler(`Message ${i + 1}.`, 250) }));
  history.push({ isUser: true, text: userText });
  const rawWindowStart = Math.max(0, history.length - historyLimitForMode(mode, false));
  // A summary turn has SUMMARY_UPDATE_MIN_PENDING messages waiting.
  const pending = summaryTurn ? pendingSummaryMessages(history, rawWindowStart, rawWindowStart - SUMMARY_UPDATE_MIN_PENDING) : [];
  const system = buildCoachSystemPrompt(mode, {
    lociCoreInstruction: L.buildLociCoreInstruction({ firstName: FIRST }),
    mentorName: "Loci AI Coach", firstName: FIRST, userName: FIRST,
    challengeLabel: "Breaking Initiation Freeze",
    profileContext: buildProfileContext(config),
    memoryContext: buildLociMemoryContext(config.coachMemory),
    memorySectionEnabled: true,
    personaInstruction: buildPersonaInstruction(config, FIRST),
    taskContext: L.buildLociTaskContext(tasks, NOW, WINDOWS),
    todaySnapshotContext: L.buildLociTodaySnapshotContext(tasks, { dayStr: DAY, mentionText: userText }),
    focusSessionContext: "",
    nowFocusContext: L.buildLociNowFocusContext(tasks),
    dayMapContext: L.buildLociDayMapContext(tasks, DAY),
    remindersContext: L.buildLociRemindersContext(tasks, NOW),
    anchorContext: L.buildLociAnchorsContext(config.dailyAnchors),
    checkinContext: [L.buildLociCheckinContext(config, tasks, DAY), L.buildLociClosingContext(config, DAY)].filter(Boolean).join("\n\n"),
    pendingCheckinContext: "",
    deadlineContext: L.buildLociDeadlineContext(config, NOW),
    brainDumpContext: L.buildLociBrainDumpContext(brainDump),
    velocityContext: L.buildLociVelocityContext(contributions, NOW),
    recentlyParkedContext: L.buildLociRecentlyParkedContext(tasks, NOW),
    recentlyCompletedContext: L.buildLociRecentlyCompletedContext(tasks, NOW),
    categoryFilterContext: "",
    rescueHandoffContext: "",
    isEarlyConversation: false,
    nowLabel: "Wed, Oct 21, 2026, 10:00 AM UTC", timeOfDay: "morning",
    todayActiveCount: 6,
    profileBlock: profileToCoachContext({ totalTasks: 120, totalCompleted: 70, completionRate: 0.58, dominantHorizon: "week", avgEstimateMinutes: 40, avgCompletionsPerActiveDay: 3, bestCompletionDay: "Tuesday", brainDumpPending: brainDump.length, priorityMix: { P1: 0.3 } }),
    lastCoachPlan: mode === "compact_task" ? { recommendedTaskTitle: TITLES[0], horizon: "today", nextStep: "List the sections", reason: "It unblocks the slides" } : null,
    currentFocusTitle: TITLES[0],
    sessionSummaryContext: mode === "light" ? "" : buildSessionSummaryContext(summary),
    pendingSummaryContext: buildPendingSummaryContext(pending),
  });
  // carried: unsummarized messages kept in the history while the rewrite waits.
  const messages = carried ? history.slice(rawWindowStart - carried) : trimHistoryForLLM(history, mode, false);
  const chars = system.length + messages.reduce((n, m) => n + m.text.length, 0);
  const maxTokens = MAX_TOKENS[mode] + (summaryTurn ? SUMMARY_TURN_EXTRA_TOKENS : 0);
  return { system, chars, groqTokens: Math.ceil(chars / CHARS_PER_TOKEN) + maxTokens };
}

describe("Coach prompt budgets (#545 C8)", () => {
  // System-prompt chars on the typical fixture. A change that grows a prompt
  // past its line has to make room elsewhere or update the budget on purpose.
  const SYSTEM_CHARS = { full_task: 26000, compact_task: 17500, emotional: 19500, profile_reflection: 14500, light: 8000 };
  for (const [mode, max] of Object.entries(SYSTEM_CHARS)) {
    it(`${mode} system prompt stays within ${max} chars (typical plan)`, () => {
      expect(buildRequest(mode).system.length).toBeLessThanOrEqual(max);
    });
  }

  it("a typical full_task turn fits Groq's free tier with 5% headroom", () => {
    expect(buildRequest("full_task").groqTokens).toBeLessThanOrEqual(GROQ_TPM * 0.95);
  });

  it("a typical full_task turn carrying the most messages a deferred rewrite leaves out still fits with 5% headroom", () => {
    expect(buildRequest("full_task", { carried: SUMMARY_UPDATE_MIN_PENDING - 1 }).groqTokens).toBeLessThanOrEqual(GROQ_TPM * 0.95);
  });

  it("a typical full_task summary-rewrite turn still fits Groq's free tier", () => {
    expect(buildRequest("full_task", { summaryTurn: true }).groqTokens).toBeLessThanOrEqual(GROQ_TPM);
  });

  it("every smaller mode fits Groq's free tier on a large plan", () => {
    for (const mode of ["compact_task", "emotional", "profile_reflection", "light"]) {
      expect(buildRequest(mode, { large: true, summaryTurn: true }).groqTokens, mode).toBeLessThanOrEqual(GROQ_TPM);
    }
  });

  // #545 C9: Z.ai's 12k-char guard leaves it able to serve light only; for
  // the other modes callZai refuses locally (zai_too_large), no request sent.
  it("light fits Z.ai's payload guard; full_task cannot", () => {
    expect(buildRequest("light").chars).toBeLessThanOrEqual(ZAI_MAX_PAYLOAD_CHARS);
    expect(buildRequest("full_task").chars).toBeGreaterThan(ZAI_MAX_PAYLOAD_CHARS);
  });
});
