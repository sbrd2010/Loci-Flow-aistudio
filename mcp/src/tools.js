import { z } from "zod";
import { readUserRecord } from "./firebase.js";
import { buildOverview } from "./overview.js";
import { buildDayMap, buildMindBox, buildPlan, buildSettings, buildStuck, buildToday, buildWeek } from "./pages.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// `parts` are the children of sync/{uid} a tool needs; nothing else is fetched.
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
      "The user's Day map: focus windows and breaks, the saved route (each open Today task with start, end and duration, fixed-time and event flags), open tasks with no saved start, " +
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
    name: "get_week", title: "Recent days", parts: ["tasks", "config", "contributions"], build: buildWeek,
    inputSchema: { days: z.number().int().min(1).max(60).optional().describe("How many days back, ending today. Default 14.") },
    description:
      "Day by day for the last N days: the app's completion count, the tasks completed that day, and the user's Close-the-day record (done, moved to tomorrow, planned, dropped, focus minutes, their note, first thing for tomorrow).",
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
];

export const TOOL_NAMES = TOOLS.map(t => t.name);

export function registerTools(server, env, deps) {
  for (const { name, title, description, parts, build, inputSchema } of TOOLS) {
    const run = async (args) => {
      try {
        const record = await readUserRecord(env, deps.uid, deps, parts);
        const out = build(record, deps.now ?? Date.now(), env.LOCI_TIMEZONE, args);
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
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
