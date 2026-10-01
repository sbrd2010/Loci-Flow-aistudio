// Coach's brief (Q51, 62a–g): one AI review, run only on "Brief me". It
// always reads Today + 7 days + 30 days, sends summary numbers and up to 10
// task titles, and gets back five short groups of facts, each with at most
// one action per line. Only the latest brief is kept (config.coachBrief).
//
// Nothing here changes data on its own: an action is a button the user taps
// (Q50), and every move has an Undo.
import { reviewFacts } from "./coachReview";
import { weekSummary } from "./focusLedger";
import { sliceContributions, getDateRangeDays } from "./insightsContext";
import { isActiveLociTask } from "./lociAIContext";
import { isOnToday } from "./deferral";
import { getLociDayStr } from "./focusWindows";
import { taskSteps } from "./taskSteps";

export const BRIEF_MOVE_TARGETS = ["week", "month", "quarter"];
const MAX_TASKS = 10;
const LINE_MAX = 220;

const estimateOf = (t) => (Number(t?.timeEstimateMinutes) > 0 ? Number(t.timeEstimateMinutes) : null);
const DAY_MS = 86400000;

// The tasks the brief may name, in a fixed order: Today's open tasks first,
// then the biggest and the oldest elsewhere. Labelled T1…T10 so the model
// refers to them by id, never by a title it might misspell.
export function briefTaskRefs(tasks = [], { now = new Date(), windows } = {}) {
  const todayStr = getLociDayStr(now, windows);
  const open = tasks.filter(isActiveLociTask);
  const today = open.filter(t => isOnToday(t, todayStr)).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const rest = open.filter(t => !isOnToday(t, todayStr))
    .sort((a, b) => (estimateOf(b) || 0) - (estimateOf(a) || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  return [...today, ...rest].slice(0, MAX_TASKS).map((t, i) => ({ id: `T${i + 1}`, task: t }));
}

/**
 * Everything the brief sends, as plain numbers and up to 10 titles.
 * `focusRaw` null means the ledger couldn't be read; focus is then "unknown"
 * rather than zero.
 */
export function buildBriefInput({ tasks = [], contributions = [], config = {}, focusRaw = null, now = new Date(), windows, frontNameOf = (id) => id || "no front" }) {
  const period = (key) => {
    const f = reviewFacts({ tasks, contributions, config, focusRaw, period: key, now, windows, frontNameOf });
    return {
      focusedMinutes: f.focusedMinutes,
      completed: f.completed,
      daysWithTick: `${f.daysWithTick} of ${f.dayCount}`,
      byFront: f.byFront ? f.byFront.slice(0, 4).map(x => `${x.name}: ${x.minutes}m`) : "unknown",
    };
  };
  // The 7 days before the last 7, for "compared with the previous period".
  const prev14 = focusRaw ? weekSummary(focusRaw, tasks, now, windows, 14) : null;
  const last7 = focusRaw ? weekSummary(focusRaw, tasks, now, windows, 7) : null;
  const ticks14 = sliceContributions(contributions, getDateRangeDays("30d", now).slice(-14));
  const facts30 = reviewFacts({ tasks, contributions, config, focusRaw, period: "30d", now, windows, frontNameOf });
  const refs = briefTaskRefs(tasks, { now, windows });
  const todayStr = getLociDayStr(now, windows);
  return {
    refs,
    data: {
      today: period("today"),
      last7: period("7d"),
      previous7: {
        focusedMinutes: prev14 && last7 ? prev14.totalMinutes - last7.totalMinutes : null,
        completed: ticks14.slice(0, 7).reduce((n, d) => n + d.count, 0),
      },
      last30: { ...period("30d"), bestWeekday: facts30.weekday.bestDay || "none yet" },
      byCategory: facts30.byCategory.slice(0, 6).map(c => `${c.name}: ${c.done} done in 30 days, ${c.open} open`),
      openNow: Object.fromEntries(facts30.openNow.byHorizon.map(h => [h.id, h.count])),
      plannedTodayMinutes: facts30.openNow.plannedTodayMin,
      leftTodayMinutes: facts30.openNow.leftMin,
      tasks: refs.map(({ id, task }) => ({
        id,
        title: String(task.title || "").slice(0, 120),
        horizon: isOnToday(task, todayStr) ? "today" : (task.horizonLevel || "later"),
        estimateMinutes: estimateOf(task),
        priority: task.priority || null,
        front: task.frontId ? frontNameOf(task.frontId) : null,
        category: task.category || null,
        firstStep: taskSteps(task).find(st => st && !st.done && st.text)?.text || null,
        ageDays: task.createdAt ? Math.floor((now.getTime() - Number(task.createdAt)) / DAY_MS) : null,
      })),
    },
  };
}

export const BRIEF_SYSTEM_PROMPT = `You write "Coach's brief" for a focus app. You get summary numbers for today, the last 7 days, the 7 days before them, and the last 30 days, plus up to 10 open tasks labelled T1–T10.

Reply with ONE JSON object and nothing else:
{
  "howItWent": [string, ...],        // 1–2 facts looking back, compared with the previous period
  "patterns": [string, ...],         // 0–2 facts: best days, fronts or categories with no progress
  "tooMuch": { "line": string, "items": [{ "task": "T#", "to": "week"|"month"|"quarter" }] },  // only if planned today > left today; up to 3 tasks that could wait
  "estimates": [{ "task": "T#", "fact": string, "action": "split"|"week"|"month"|"quarter" }],  // 0–2: a task too big for one sitting, or a long goal sitting on Today
  "next": { "task": "T#", "line": string }   // the one task to start with: why, and its first step if known
}

Rules:
- Facts first. Short sentences with the numbers. No advice sentences, no encouragement, no emoji, no exclamation marks, no markdown.
- Name tasks only by their T# id in "task" fields. In text you may write a task's title exactly as given.
- Write durations like 1h27m or 45m. Say "unknown" never; leave a group out instead.
- Leave out any group that has nothing true to say (use [] or omit the key).`;

const clean = (s) => String(s || "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().slice(0, LINE_MAX);
const lines = (v, max) => (Array.isArray(v) ? v : []).map(clean).filter(Boolean).slice(0, max);

// The model's reply → the stored brief. Anything that doesn't check out (a
// task id it wasn't given, a move target that isn't a horizon) is dropped,
// never guessed. Returns null when nothing usable is left.
export function parseBrief(text, refs, at = Date.now()) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const byId = new Map(refs.map(r => [r.id, r.task]));
  const ref = (id) => {
    const t = byId.get(String(id || "").trim().toUpperCase());
    return t ? { uuid: t.uuid, title: String(t.title || "").slice(0, 200) } : null;
  };
  const brief = { at, howItWent: lines(obj.howItWent, 2), patterns: lines(obj.patterns, 2) };
  const tooMuchItems = (Array.isArray(obj.tooMuch?.items) ? obj.tooMuch.items : [])
    .map(i => ({ ...ref(i?.task), to: i?.to }))
    .filter(i => i.uuid && BRIEF_MOVE_TARGETS.includes(i.to))
    .slice(0, 3);
  if (tooMuchItems.length) brief.tooMuch = { line: clean(obj.tooMuch.line), items: tooMuchItems };
  const estimates = (Array.isArray(obj.estimates) ? obj.estimates : [])
    .map(e => ({ ...ref(e?.task), fact: clean(e?.fact), action: e?.action }))
    .filter(e => e.uuid && e.fact && (e.action === "split" || BRIEF_MOVE_TARGETS.includes(e.action)))
    .slice(0, 2);
  if (estimates.length) brief.estimates = estimates;
  const next = ref(obj.next?.task);
  if (next) brief.next = { ...next, line: clean(obj.next.line) };
  const has = brief.howItWent.length || brief.patterns.length || brief.tooMuch || brief.estimates || brief.next;
  return has ? brief : null;
}

// Move a task to another horizon, at the bottom of it. `before` is what Undo
// needs; `appliedLastUpdated` lets Undo refuse once the task changed again.
export function moveTaskToHorizon(tasks, uuid, to, now = Date.now()) {
  const task = tasks.find(t => t.uuid === uuid && !t.isDeleted && !t.isCompleted);
  if (!task || !BRIEF_MOVE_TARGETS.includes(to) || task.horizonLevel === to) return null;
  const bottom = tasks
    .filter(t => t.horizonLevel === to && !t.isDeleted && t.uuid !== uuid)
    .reduce((m, t) => Math.max(m, Number(t.orderIndex) || 0), -1) + 1;
  const before = { horizonLevel: task.horizonLevel, orderIndex: task.orderIndex ?? null, deferredUntil: task.deferredUntil ?? null, isNowFocus: !!task.isNowFocus };
  return {
    tasks: tasks.map(t => (t.uuid === uuid ? { ...t, horizonLevel: to, orderIndex: bottom, deferredUntil: null, isNowFocus: false, lastUpdated: now } : t)),
    before,
    appliedLastUpdated: now,
  };
}

export function undoMoveTask(tasks, uuid, { before, appliedLastUpdated }, now = Date.now()) {
  const task = tasks.find(t => t.uuid === uuid && !t.isDeleted);
  if (!task || task.lastUpdated !== appliedLastUpdated) return null;
  const otherPinned = tasks.some(t => t.isNowFocus && t.uuid !== uuid && !t.isDeleted && !t.isCompleted);
  const { isNowFocus, ...place } = before;
  return tasks.map(t => (t.uuid === uuid ? { ...t, ...place, ...(isNowFocus && !otherPinned ? { isNowFocus: true } : {}), lastUpdated: now } : t));
}

// The brief as plain text, sent with the first Chat message after "Ask about
// this" (62h).
export function briefToText(brief) {
  if (!brief) return "";
  const out = [];
  if (brief.howItWent?.length) out.push(`HOW IT WENT: ${brief.howItWent.join(" ")}`);
  if (brief.patterns?.length) out.push(`PATTERNS: ${brief.patterns.join(" ")}`);
  if (brief.tooMuch) out.push(`TOO MUCH PLANNED: ${brief.tooMuch.line} Could wait: ${brief.tooMuch.items.map(i => `"${i.title}" → ${i.to}`).join(", ")}`);
  if (brief.estimates?.length) out.push(`ESTIMATES: ${brief.estimates.map(e => `"${e.title}" · ${e.fact} (${e.action})`).join("; ")}`);
  if (brief.next) out.push(`NEXT: "${brief.next.title}". ${brief.next.line}`);
  return out.join("\n");
}
