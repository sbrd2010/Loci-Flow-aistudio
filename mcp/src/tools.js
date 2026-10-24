import { z } from "zod";
import { getAccessToken, readFocusEvents, readUserRecord } from "./firebase.js";
import { buildOverview } from "./overview.js";
import { buildCoachBrief, buildCoachReview, buildDayMap, buildFocusHistory, buildMindBox, buildPlan, buildSettings, buildStuck, buildToday, buildWeek } from "./pages.js";
import { REVIEW_GUIDE } from "./guide.js";
import { addDays, dateString, wallClock } from "./time.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// `parts` are the children of sync/{uid} a tool needs; nothing else is fetched.
// `ledgerDays` (days back, from the arguments) makes the tool also read the focus log.
const TOOLS = [
  {
    name: "get_overview", title: "Loci overview", parts: ["tasks", "config", "contributions"], build: buildOverview,
    description:
      "A short snapshot of the user's Loci plan right now: today's calendar date in their zone (and lociDay, the date their day counts as, which is still yesterday in the small hours if their day runs past midnight), " +
      "their fronts (named pieces of work) with deadlines and days left, open task counts per horizon, today's list (pinned task first, then the user's order) with estimates and total planned minutes, " +
      "task deadlines that are overdue / due today / coming in 14 days (a task with no date of its own takes its front's: viaFront), and tasks completed per day over the last 7 days. " +
      "Start here, then use the page tools for detail.",
  },
  {
    name: "get_today", title: "Today page", parts: ["tasks", "config"], build: buildToday,
    description:
      "Everything on the user's Today page, with whole task records: the open list (pinned task first, then their order), tasks moved to tomorrow, tasks completed today, " +
      "ALL parked tasks (any horizon, with how long they have been parked), the pinned focus task, the Minimum Day they confirmed, and whether they closed the day.",
  },
  {
    name: "get_day_map", title: "Day map page", parts: ["tasks", "config"], build: buildDayMap,
    description:
      "The user's Day map: focus windows and breaks, the route laid out as the page shows it right now (each open Today task with start, end and duration, a task that reaches a break continues after it, fixed-time and event flags), open tasks with no place in the route, " +
      "and whether the plan fits: open minutes vs remaining and total focus time, where the route ends vs the day's end, and the stops that won't fit.",
  },
  {
    name: "get_plan", title: "Plan page", parts: ["tasks", "config"], build: buildPlan,
    inputSchema: { horizon: z.string().optional().describe("Only this horizon's tasks, by id (week, month, quarter, halfyear, office, or a custom id). Omit for all horizons and the fronts.") },
    description:
      "The user's Plan page: every horizon (week, month, quarter, 6 months, and any they added, plus Work · older) with its period, days left, review record and its open tasks as whole records; " +
      "and the fronts with their dates, status, next move, progress and which tasks belong to them. Includes tasks completed in the last 14 days.",
  },
  {
    name: "get_mind_box", title: "Mind Box page", parts: ["brainDump"], build: buildMindBox,
    description: "The user's Mind Box: every thought as they wrote it, newest first, with when it was written and how many days ago.",
  },
  {
    name: "get_week", title: "Recent days", parts: ["tasks", "config", "contributions"], build: buildWeek, ledgerDays: (args) => args.days ?? 14, ledgerOptional: true,
    inputSchema: { days: z.number().int().min(1).max(60).optional().describe("How many days back, ending on the Loci day. Default 14.") },
    description:
      "Day by day for the last N days: the app's completion count, the tasks completed that day, the focus minutes and sessions logged, and the user's Close-the-day record (done, moved to tomorrow, planned, dropped, focus minutes, their note, first thing for tomorrow).",
  },
  {
    name: "get_stuck", title: "What looks stuck", parts: ["tasks", "config"], build: buildStuck,
    inputSchema: {
      staleDays: z.number().int().min(1).max(365).optional().describe("Days without an edit before a Today / This-week task counts as untouched. Default 7."),
      parkedDays: z.number().int().min(1).max(365).optional().describe("Days parked before a parked task is listed. Default 7."),
    },
    description:
      "Facts that often mean a plan is stuck, as ages not verdicts: overdue tasks, long-parked tasks, Today / This-week tasks not edited for a while, and open Today tasks with no next step or no time estimate.",
  },
  {
    name: "get_settings", title: "Planning settings", parts: ["config"], build: buildSettings,
    description: "The settings that shape the user's plan: day start and end, focus windows, challenge type, pomodoro length, evening guard, goal-days mode, break name and key-deadline settings. Never names, notes, anchors or display options.",
  },
  {
    name: "get_focus_history", title: "Focus log", parts: ["tasks", "config"], build: buildFocusHistory, ledgerDays: (args) => args.days ?? 14,
    inputSchema: { days: z.number().int().min(1).max(60).optional().describe("How many Loci days back, ending today. Default 14.") },
    description:
      "The user's focus log for the last N days: every focus session with when it started, its minutes, planned minutes, its outcome (done, ended by the user, or expired), why it ended, and the task, category, priority and front it was on; minutes per day and per front.",
  },
  {
    name: "get_coach_review", title: "Coach review", parts: ["tasks", "config", "contributions"], build: buildCoachReview, ledgerDays: (args) => ({ today: 1, "7d": 7, "30d": 30 })[args.period ?? "7d"],
    inputSchema: { period: z.enum(["today", "7d", "30d"]).optional().describe("The period. Default 7d.") },
    description:
      "The facts on the user's Coach > Review page, computed with the app's own code: minutes focused and ticks day by day, minutes per front, completed and open work by category, pace, best weekday, what is open now by horizon, and whether today's planned minutes exceed the focus time left.",
  },
  {
    name: "get_coach_brief", title: "Coach brief", parts: ["config"], build: buildCoachBrief,
    description: "The latest Brief the user's Coach wrote for them (how it went, patterns, what was too much, estimates, what to do next), as text and as saved. Only the latest is kept and it can be out of date; it may name the user's tasks.",
  },
  {
    name: "get_review_guide", title: "How to review a Loci plan", parts: [], build: () => REVIEW_GUIDE,
    description: "How Loci plans (horizons, fronts, Today, Minimum Day, focus windows, the Day map) and how to review a plan against that. Read this before judging a plan.",
  },
];

export const TOOL_NAMES = TOOLS.map(t => t.name);

export function registerTools(server, env, deps) {
  for (const { name, title, description, parts, build, inputSchema, ledgerDays, ledgerOptional } of TOOLS) {
    const run = async (args) => {
      try {
        const now = deps.now ?? Date.now();
        let record = null;
        let focusRaw = null;
        let logFailed = false;
        if (parts.length || ledgerDays) {
          // One token for both reads, so they do not each ask Google for one.
          await getAccessToken(env.FIREBASE_SERVICE_ACCOUNT, deps);
          const since = ledgerDays ? addDays(dateString(wallClock(now, env.LOCI_TIMEZONE)), -(ledgerDays(args) + 1)) : null;
          const readLog = () => readFocusEvents(env, deps.uid, since, deps);
          [record, focusRaw] = await Promise.all([
            parts.length ? readUserRecord(env, deps.uid, deps, parts) : null,
            // A tool that is about the log must fail when it cannot be read; one that only adds to its answer can go without.
            ledgerDays ? (ledgerOptional ? readLog().catch((err) => { console.error(`${name}: focus log unavailable:`, err instanceof Error ? err.message : "unknown"); logFailed = true; return null; }) : readLog()) : null,
          ]);
          // An empty log reads back as nothing at all; that is different from one we could not read.
          if (ledgerDays && focusRaw == null && !logFailed) focusRaw = {};
        }
        const out = build(record, now, env.LOCI_TIMEZONE, logFailed ? { ...args, focusUnavailable: true } : args, focusRaw);
        return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] };
      } catch (err) {
        // Log the reason (status only, never data); tell the model something it can relay.
        console.error(`${name} failed:`, err instanceof Error ? err.message : "unknown");
        return { isError: true, content: [{ type: "text", text: "Could not read the Loci plan just now. Try again in a moment." }] };
      }
    };
    server.registerTool(
      name,
      { title, description, annotations: READ_ONLY, ...(inputSchema ? { inputSchema } : {}) },
      inputSchema ? (args) => run(args ?? {}) : () => run({}),
    );
  }
}
