import { frontsFromConfig, frontDaysLeft, frontProgress, LEGACY_DEADLINE_FRONT_ID } from "./fronts";
import { lociDayWindow, weekSummary, formatMinutes } from "./focusLedger";
import { sliceContributions } from "./insightsContext";
import { getFocusWindows } from "./focusWindows";
import { thoughtText, newestThoughtsFirst } from "./thoughts";

// Fact cards (#555): the Coach chat answers a plain factual question about the
// user's own data from the app, with no AI call. The numbers cannot be misquoted,
// cost no tokens, and come back at once. Each card fires only for a question that
// is clearly that kind (a topic word plus a question cue) and never for advice,
// a vent or a command ("park the groceries task"); anything else goes on to the
// Coach as before.
//
//   detectFactIntent(text)            -> null, or { kind, ...what to read }
//   buildFactCard(intent, data)       -> the reply text
//   data: { tasks, config, brainDump, contributions, focusRaw, now, unconfirmed }
//         (focusRaw only for intents that set needsFocus; null = could not be read)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LIST_MAX = 10;
const TITLE_MAX = 80;

const norm = (text) => String(text || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clip = (text) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
};
const parseDay = (dayStr) => {
  const [y, m, d] = String(dayStr).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dayLabel = (dayStr) => `${DAY_NAMES[parseDay(dayStr).getDay()]} ${parseDay(dayStr).getDate()}`;
const dayMonth = (dayStr) => `${parseDay(dayStr).getDate()} ${MONTHS[parseDay(dayStr).getMonth()]}`;

// ---- when a message is a plain question about the user's own data ----

const QUESTION_START = /^(?:(?:please|pls|ok|okay|so|and|hey|can you|could you)\s+)*(?:what|what's|whats|which|who|when|how|is|are|am|do|does|did|have|has|any|anything|list|show|tell me|give me|check|total|number of)\b/;
const isQuestion = (t) => /\?\s*$/.test(t) || QUESTION_START.test(t);
const IMPERATIVE = /^(?:(?:please|pls|ok|okay|and)\s+)*(?:add|put|move|park|defer|mark|start|set|schedule|remind|delete|remove|clear|create|rename|change|make|pin|switch|finish|complete|plan|help|capture|dump|note|remember|forget)\b/;
// Asking what to do, or venting, is for the Coach, not for a list of facts.
const ADVICE = /\b(?:should i|could i|would i|can i|will i|why|how come|how do i|how can i|what do i do|what can i do|help me|stressed|stressing|overwhelm\w*|anxious|worried|scared|panick\w*|freaking|i can't|i cannot)\b/;

const KNOWN_RE = /\bwhat\b[^?.!]{0,25}\byou\b[^?.!]{0,20}\b(?:know|remember(?:ed)?|learn(?:ed|t)?|saved?|stored?|noted?|have)\b[^?.!]{0,15}\b(?:about|on) me\b/;
const PARKED_TOPIC = /\b(?:parked|parking lot|set aside|on hold|shelved|put aside)\b/;
const MINDBOX_TOPIC = /\b(?:mind ?box|brain ?dump)\b/;
const FOCUS_TOPIC = /\b(?:focus(?:ed|ing)?|deep work|pomodoros?)\b/;
const FOCUS_QUANTITY = /\b(?:how (?:long|many|much|often)|total|hours?|minutes?|sessions?|times|which day|what day|busiest|most|highest|longest|best day|enough|lately|recently)\b/;
const FOCUS_NOT_STATS = /\bhow long (?:is|are|does|do|will|would|can)\b|\bfocus (?:task|on|mode)\b|\bmy (?:current )?focus\b|\bnow focus\b/;
const COMPARE_CUE = /\b(?:than|vs\.?|versus|compared (?:to|with)|better|worse|improv\w*)\b/;
const COMPARE_REF = /\b(?:last|previous|prior|past) (?:week|month)\b|\b(?:week|month) before\b/;
const DEADLINE_WORD = /\b(?:due(?! to)|deadlines?|overdue)\b/;
const DEADLINE_TIME = /\bdays? (?:left|remaining|to go|until|till|before)\b|\bhow (?:long|many days) (?:until|till|before|to go|left)\b|\bhow soon\b/;
const LATE = /\b(?:anything|what's|what is|which|something|are any|is any)\s+(?:\w+\s+){0,2}late\b/;
const URGENT_FRONT = /\bmost urgent\b|\burgent (?:front|deadline)s?\b|\bwhich front\b/;

// The front a message names, if any: its whole name, or all of its longer words.
function namedFront(text, fronts) {
  for (const front of fronts) {
    const name = norm(front.name);
    if (!name) continue;
    if (text.includes(name)) return front;
    const words = name.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    if (words.length > 0 && words.every((w) => text.includes(w))) return front;
  }
  return null;
}

function periodOf(t) {
  if (/\btoday\b/.test(t)) return { scope: "today" };
  if (/\byesterday\b/.test(t)) return { scope: "yesterday" };
  const days = /\bmonth\b|\b30 days\b/.test(t) ? 30 : 7;
  const offset = /\b(?:last|previous|prior) (?:week|month)\b|\b(?:week|month) before\b/.test(t) ? 1 : 0;
  return { scope: "period", days, offset };
}

export function detectFactIntent(message, { config = {} } = {}) {
  const t = norm(message);
  if (!t || t.length > 200) return null;
  if (IMPERATIVE.test(t) || ADVICE.test(t) || !isQuestion(t)) return null;

  if (KNOWN_RE.test(t)) return { kind: "known" };
  if (PARKED_TOPIC.test(t)) return { kind: "parked" };
  if (MINDBOX_TOPIC.test(t)) return { kind: "mindbox" };

  if (COMPARE_CUE.test(t) && COMPARE_REF.test(t)) {
    const span = /\bmonth\b/.test(t) ? 30 : 7;
    return { kind: "compare", days: span, needsFocus: true, focusDays: span * 2 };
  }

  if (FOCUS_TOPIC.test(t) && FOCUS_QUANTITY.test(t) && !FOCUS_NOT_STATS.test(t)) {
    const period = periodOf(t);
    const focusDays = period.scope === "period" ? period.days * (period.offset + 1) : 7;
    return { kind: "focus", period, needsFocus: true, focusDays };
  }

  const fronts = frontsFromConfig(config);
  const front = namedFront(t, fronts);
  const generic = DEADLINE_WORD.test(t) || LATE.test(t) || URGENT_FRONT.test(t);
  const timed = DEADLINE_TIME.test(t) && (front || /\b(?:deadline|front|key|launch)\b/.test(t));
  if (generic || timed) {
    return { kind: "deadlines", frontId: front ? front.id : null, overdueOnly: /\boverdue\b|\blate\b/.test(t) && !/\bdue\b/.test(t), mostUrgent: URGENT_FRONT.test(t) };
  }
  return null;
}

// ---- the cards ----

const SYNC_TEXT = "This device hasn't finished syncing yet, so I won't guess at your data. Try again in a moment.";

function deadlinesCard(intent, { tasks, config, now }) {
  const dated = frontsFromConfig(config)
    .map((front) => ({ front, left: frontDaysLeft(front, now) }))
    .filter((x) => x.left !== null)
    .sort((a, b) => a.left - b.left);
  if (dated.length === 0) {
    return "None of your fronts has a deadline set, and tasks don't have due dates of their own, so nothing is due. You can set a deadline on a front in Roadmap.";
  }
  const when = (left) => (left < 0 ? `${plural(-left, "day")} overdue` : left === 0 ? "due today" : `in ${plural(left, "day")}`);
  const line = ({ front, left }) => {
    const { done, total } = frontProgress(tasks, front.id);
    const tags = [front.id === LEGACY_DEADLINE_FRONT_ID ? "your key deadline" : null].filter(Boolean);
    const progress = total > 0 ? ` ${done} of ${plural(total, "task")} done.` : "";
    const next = front.nextMove ? ` Next move: ${clip(front.nextMove)}.` : "";
    return `- **${clip(front.name)}**${tags.length ? ` (${tags.join(", ")})` : ""}: ${when(left)} (${dayMonth(front.dueAt)}).${progress}${next}`;
  };

  if (intent.frontId) {
    const hit = dated.find((x) => x.front.id === intent.frontId);
    if (hit) return line(hit).replace(/^- /, "");
  }
  if (intent.mostUrgent) return `Most urgent:\n${line(dated[0])}`;
  if (intent.overdueOnly) {
    const late = dated.filter((x) => x.left < 0);
    if (late.length === 0) return `Nothing is overdue.\nNext up:\n${line(dated[0])}`;
    return `Overdue:\n${late.map(line).join("\n")}`;
  }
  const shown = dated.slice(0, 4);
  const more = dated.length > shown.length ? `\n- … and ${dated.length - shown.length} more with later dates.` : "";
  return `Your deadlines, soonest first:\n${shown.map(line).join("\n")}${more}\n\nTasks don't have due dates of their own; deadlines belong to fronts.`;
}

function parkedCard({ tasks }) {
  const parked = (tasks || []).filter((t) => t && t.isParked && !t.isDeleted && !t.isCompleted);
  if (parked.length === 0) return "You have no parked tasks.";
  const shown = parked.slice(0, LIST_MAX).map((t) => `- ${clip(t.title)}`).join("\n");
  const more = parked.length > LIST_MAX ? `\n- … and ${parked.length - LIST_MAX} more.` : "";
  return `You have ${plural(parked.length, "parked task")}:\n${shown}${more}`;
}

function mindboxCard({ brainDump }) {
  const items = newestThoughtsFirst(brainDump || []).map((item) => clip(thoughtText(item))).filter(Boolean);
  if (items.length === 0) return "Your Mind Box is empty.";
  const shown = items.slice(0, 12).map((x) => `- ${x}`).join("\n");
  const more = items.length > 12 ? `\n- … and ${items.length - 12} more.` : "";
  return `Your Mind Box has ${plural(items.length, "thought")}, newest first:\n${shown}${more}`;
}

function knownCard({ config }) {
  const memory = config.coachMemory || {};
  const facts = (memory.pinnedFacts || []).map((f) => `- ${clip(f.text)}`);
  const notes = (memory.recentObservations || []).slice(-10).map((o) => `- ${o.lociDayStr ? `[${o.lociDayStr}] ` : ""}${clip(o.text)}`);
  const profile = String(config.coachProfileNote || "").trim();
  const off = config.coachMemoryEnabled === false;
  if (facts.length === 0 && notes.length === 0 && !profile) {
    return off ? "Coach memory is switched off, so I'm not keeping anything about you." : "I haven't saved anything about you yet. Tell me \"remember that…\" and I will.";
  }
  const parts = ["Here's what I have on file for you:"];
  if (facts.length) parts.push(`**Saved facts**\n${facts.join("\n")}`);
  if (notes.length) parts.push(`**Recent notes**\n${notes.join("\n")}`);
  if (profile) parts.push(`**Your Coach Profile note**\n- ${clip(profile)}`);
  if (off) parts.push("Coach memory is switched off, so nothing new is being saved.");
  parts.push("You can edit or delete any of it in Settings › Coach › Coach memory.");
  return parts.join("\n\n");
}

const NO_FOCUS_LOG = "I couldn't read your focus log just now, so I won't guess. Try again in a moment.";

function focusBlock(focusRaw, tasks, now, windows, span, shift) {
  const f = weekSummary(focusRaw, tasks, now, windows, span * (shift + 1));
  const perDay = shift ? f.perDay.slice(0, span) : f.perDay;
  const minutes = perDay.reduce((n, d) => n + d.minutes, 0);
  const sessions = perDay.reduce((n, d) => n + d.moves, 0);
  const daysWith = perDay.filter((d) => d.moves > 0).length;
  const best = perDay.reduce((top, d) => (d.minutes > (top?.minutes || 0) ? d : top), null);
  return { perDay, minutes, sessions, daysWith, best };
}

function focusCard(intent, { tasks, config, focusRaw, now }) {
  if (!focusRaw) return NO_FOCUS_LOG;
  const windows = getFocusWindows(config);
  const { period } = intent;
  if (period.scope !== "period") {
    const block = focusBlock(focusRaw, tasks, now, windows, 7, 0);
    const day = block.perDay[period.scope === "today" ? 6 : 5];
    if (!day || day.minutes === 0) return `No focus time is logged for ${period.scope}.`;
    return `Focus ${period.scope}: ${formatMinutes(day.minutes)} in ${plural(day.moves, "session")}.`;
  }
  const { days, offset } = period;
  const block = focusBlock(focusRaw, tasks, now, windows, days, offset);
  const first = block.perDay[0]?.date;
  const last = block.perDay[block.perDay.length - 1]?.date;
  const what = offset ? `the ${days} days before the last ${days} days` : `the last ${days} days`;
  const range = first && last ? ` (${dayMonth(first)} to ${dayMonth(last)})` : "";
  if (block.minutes === 0) return `No focus sessions are logged in ${what}${range}.`;
  const byDay = days === 7
    ? `\nBy day: ${block.perDay.filter((d) => d.minutes > 0).map((d) => `${dayLabel(d.date)} ${formatMinutes(d.minutes)}`).join(", ")}.`
    : "";
  const busiest = block.best ? `\nBusiest day: ${dayLabel(block.best.date)} (${formatMinutes(block.best.minutes)}).` : "";
  return `Focus in ${what}${range}: **${formatMinutes(block.minutes)}** in ${plural(block.sessions, "session")} on ${plural(block.daysWith, "day")}.${busiest}${byDay}`;
}

function compareCard(intent, { tasks, config, contributions, focusRaw, now }) {
  const windows = getFocusWindows(config);
  const span = intent.days;
  const all = lociDayWindow(span * 2, now, windows); // oldest first
  const sum = (list) => list.reduce((n, d) => n + d.count, 0);
  const before = sum(sliceContributions(contributions, all.slice(0, span)));
  const nowCount = sum(sliceContributions(contributions, all.slice(span)));
  const diff = nowCount - before;
  const verdict = diff === 0 ? "the same" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"}`;
  const name = `${span} days`;
  const lines = [`Tasks finished: **${nowCount}** in the last ${name}, **${before}** in the ${name} before (${verdict}).`];
  if (focusRaw) {
    const f = weekSummary(focusRaw, tasks, now, windows, span * 2);
    const prev = f.perDay.slice(0, span).reduce((n, d) => n + d.minutes, 0);
    const cur = f.perDay.slice(span).reduce((n, d) => n + d.minutes, 0);
    lines.push(`Focus time: **${formatMinutes(cur)}** vs **${formatMinutes(prev)}** the ${name} before.`);
  } else {
    lines.push("I couldn't read your focus log just now, so that part is left out.");
  }
  return lines.join("\n");
}

export function buildFactCard(intent, data) {
  if (!intent) return null;
  const now = data.now || new Date();
  const d = { ...data, now, tasks: data.tasks || [], config: data.config || {}, contributions: data.contributions || [] };
  // Cloud data may still be the cached copy: do not state it as fact.
  if (d.unconfirmed) return SYNC_TEXT;
  switch (intent.kind) {
    case "deadlines": return deadlinesCard(intent, d);
    case "parked": return parkedCard(d);
    case "mindbox": return mindboxCard(d);
    case "known": return knownCard(d);
    case "focus": return focusCard(intent, d);
    case "compare": return compareCard(intent, d);
    default: return null;
  }
}

export function answerFromData(message, data) {
  const intent = detectFactIntent(message, { config: data?.config });
  return intent ? { kind: intent.kind, text: buildFactCard(intent, data) } : null;
}
