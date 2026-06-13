// Coach Actions — generalizes the [[CHECKIN_IN:N]] tag pattern (see
// coachCheckin.js) for the AI Coach's "Hands" tier: explicit, user-requested
// task mutations. Each tag is invisible (stripped from the reply), but unlike
// CHECKIN_IN the coach is instructed to narrate the action in its visible text.
//
// [[SET_NOW_FOCUS:<title>]] - pin a task as Now Focus (unpinning any other)
// [[COMPLETE_TASK:<title>]] - mark a task complete (+100 XP, +1 contribution)
// [[ADD_TASK:<title>]]      - create a new Today task (P3, 25min default)
// [[PARK_TASK:<title>]]     - park a task (mirrors Bad Day Reset's per-task patch)
// [[START_FOCUS:<title>]]   - pin a task as Now Focus so a focus session can start
//
// The system prompt tells the AI these tags are "explicit-request-only", but
// that's advisory — applyCoachActions() additionally requires (via
// matchesUserIntent) that the user's own last message contains language
// clearly requesting that kind of action before any tag is allowed to mutate.

import { buildToggleCompletedTasks } from "./taskOps";
import { isActiveLociTask } from "./lociAIContext";
import { safeUUID } from "./uuid";

const ACTION_TAG_RE = /\s*\[\[(SET_NOW_FOCUS|COMPLETE_TASK|ADD_TASK|PARK_TASK|START_FOCUS):\s*((?:[^\]]|\](?!\]))+?)\s*\]\]/gi;

// Strips all recognized coach action tags from an AI reply. Returns
// { cleanText, actions } where actions is an ordered list of
// { type: "SET_NOW_FOCUS"|"COMPLETE_TASK"|"ADD_TASK"|"PARK_TASK"|"START_FOCUS", title }.
export function parseCoachActionTags(text = "") {
  const actions = [];
  const cleanText = text.replace(ACTION_TAG_RE, (_match, type, title) => {
    actions.push({ type: type.toUpperCase(), title: title.trim() });
    return "";
  }).trim();
  return { cleanText, actions };
}

function normalizeTitle(str = "") {
  return String(str).toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
}

// Deterministic, code-enforced gating: a coach action tag may only mutate
// state if the user's own last message contains language that clearly
// requests that kind of action. Keeps the AI's "explicit-request-only" rule
// from being the only line of defense against acting on a hallucinated or
// misread request.
const INTENT_PATTERNS = {
  COMPLETE_TASK: /\b(done|finish(ed|ing)?|complet(e|ed|ing)|wrapped? up|knocked out)\b/i,
  SET_NOW_FOCUS: /\b(focus on|switch.*focus|prioriti[sz]e|now focus)\b/i,
  START_FOCUS: /\b(start|begin|kick off|let'?s (start|go)).*(focus|timer|session|working)\b/i,
  ADD_TASK: /\b(add( a| an)? task|create a task|new task|remind me (to|that|i)|don'?t forget|add .+ to (my |the )?(today'?s? )?(list|tasks?)\b|put .+ (on|in) (my |the )?(today'?s? )?(list|tasks?)\b)/i,
  PARK_TASK: /\b(park|defer|set aside|shelve|save .* for later|not (today|now|right now)|skip)\b/i,
};

// Catches negated phrasing ("I'm not done", "don't park it") immediately
// before an intent match, so e.g. "not done" doesn't register as COMPLETE_TASK.
const NEGATION_RE = /\b(not|never|cannot|no longer)\b|n't/i;

// Catches "done"/"finished" used generically ("I'm done for today") or as
// part of a question about past completions ("what have I done today?"),
// neither of which names a specific task to complete.
const NON_SPECIFIC_COMPLETION_RE = /\b(done|finished?)\s+for\s+(today|now|the day)\b|\b(what|anything)\b.*\b(done|finish(ed)?)\b/i;

// Action types whose tag title must be corroborated by the user's own
// message (via titleMentionedInMessage) — guards against the AI emitting a
// tag for a different task than the one the user just named (for ADD_TASK,
// a different new task than the one the user just described).
const TITLE_CHECK_TYPES = new Set(["SET_NOW_FOCUS", "START_FOCUS", "COMPLETE_TASK", "PARK_TASK", "ADD_TASK"]);

// Checks that at least one "significant" word (length >= 4) from the tag's
// title appears in the user's message. Titles with no significant words
// (e.g. "it") are passed through — findTaskByTitle's own length guard
// handles those.
function titleMentionedInMessage(title, message) {
  const words = normalizeTitle(title).split(" ").filter(w => w.length >= 4);
  if (words.length === 0) return true;
  const normMessage = normalizeTitle(message);
  return words.some(w => normMessage.includes(w));
}

export function matchesUserIntent(actionType, lastUserMessage = "", title = "") {
  const pattern = INTENT_PATTERNS[actionType];
  if (!pattern) return false;
  const message = String(lastUserMessage || "");
  if (actionType === "COMPLETE_TASK" && NON_SPECIFIC_COMPLETION_RE.test(message)) return false;
  const match = pattern.exec(message);
  if (!match) return false;
  // Look back to the start of the current clause (the last sentence-ending
  // punctuation, or the start of the message) rather than a fixed character
  // window — catches negations like "Don't ... mark it complete" regardless
  // of how many words sit between "don't" and the matched action word.
  const clauseStart = Math.max(
    message.lastIndexOf(".", match.index - 1),
    message.lastIndexOf(",", match.index - 1),
    message.lastIndexOf("!", match.index - 1),
    message.lastIndexOf("?", match.index - 1),
    message.lastIndexOf("\n", match.index - 1)
  ) + 1;
  const preceding = message.slice(clauseStart, match.index);
  if (NEGATION_RE.test(preceding)) return false;
  if (TITLE_CHECK_TYPES.has(actionType) && !titleMentionedInMessage(title, message)) return false;
  return true;
}

// Exact-title-only match against active tasks — used to detect "obvious"
// ADD_TASK duplicates without the substring fuzziness of findTaskByTitle.
function findExactActiveTask(tasks, rawTitle) {
  const target = normalizeTitle(rawTitle);
  if (!target) return null;
  return (tasks || []).find(t => isActiveLociTask(t) && normalizeTitle(t.title) === target) || null;
}

// Fuzzy-matches a tag's title against the user's active tasks: an exact match
// first, then a single unambiguous substring match in either direction.
// Returns null if nothing matches or more than one task matches equally well.
export function findTaskByTitle(tasks = [], rawTitle = "") {
  const target = normalizeTitle(rawTitle);
  if (!target) return null;
  const active = (tasks || []).filter(isActiveLociTask);

  const exact = active.filter(t => normalizeTitle(t.title) === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  // Below this length, substring matching is too loose to be meaningful (e.g. a
  // tag title of "it" would substring-match almost any task) — require an exact
  // title match for short fragments instead.
  if (target.length < 4) return null;

  const partial = active.filter(t => {
    const norm = normalizeTitle(t.title);
    return norm.includes(target) || target.includes(norm);
  });
  return partial.length === 1 ? partial[0] : null;
}

// Pins the given task as Now Focus, unpinning any other — mirrors
// TodayTab's handlePinTask. Used for both SET_NOW_FOCUS and START_FOCUS.
export function buildSetNowFocusTasks(tasks, taskUuid, now = Date.now()) {
  return tasks.map(t => {
    const newFocus = t.uuid === taskUuid;
    if (t.isNowFocus === newFocus) return t;
    return { ...t, isNowFocus: newFocus, lastUpdated: now };
  });
}

// Parks the given task, unpinning it if it was the Now Focus — mirrors
// MindBoxTab's Bad Day Reset per-task patch.
export function buildParkTaskTasks(tasks, taskUuid, now = Date.now()) {
  return tasks.map(t =>
    t.uuid === taskUuid ? { ...t, isParked: true, isNowFocus: false, lastUpdated: now } : t
  );
}

// Creates a new Today task from a chat-mentioned title — mirrors
// AddTaskDialog's defaults (P3, 25min, "Do first tiny step").
function buildAddTaskPayload(payload, rawTitle, now = Date.now()) {
  const { tasks = [], config = {} } = payload;
  const title = String(rawTitle).trim().slice(0, 300);
  if (!title) return payload;
  const orderIndex = tasks.filter(t => t.horizonLevel === "today" && !t.isDeleted).length;
  const newTask = {
    id: now,
    userId: payload.userId || config.userId || "",
    uuid: safeUUID(),
    title,
    concreteStep: "Do first tiny step",
    horizonLevel: "today",
    priority: "P3",
    category: "Personal",
    timeEstimateMinutes: 25,
    deadlineTimestamp: null,
    reminderAt: null,
    isCompleted: false,
    isParked: false,
    isNowFocus: false,
    orderIndex,
    dateCompletedString: null,
    isDeleted: false,
    lastUpdated: now,
  };
  return { ...payload, tasks: [...tasks, newTask] };
}

// Marks a task complete and applies the same +100 XP / +1 contribution
// bookkeeping as TodayTab's handleToggleComplete.
function buildCompleteTaskPayload(payload, task, lociDateStr, localDateStr) {
  const { tasks = [], config = {}, contributions = [] } = payload;
  const nextContributions = [...contributions];
  const idx = nextContributions.findIndex(c => c.dateString === localDateStr);
  const uid = payload.userId || config.userId || "";
  if (idx === -1) {
    nextContributions.push({ compositeKey: `${uid}_${localDateStr}`, userId: uid, dateString: localDateStr, count: 1, lastUpdated: Date.now() });
  } else {
    nextContributions[idx] = { ...nextContributions[idx], count: nextContributions[idx].count + 1, lastUpdated: Date.now() };
  }
  return {
    ...payload,
    tasks: buildToggleCompletedTasks(tasks, task.uuid, true, lociDateStr),
    config: { ...config, totalXp: (Number(config.totalXp) || 0) + 100, lastUpdated: Date.now() },
    contributions: nextContributions,
  };
}

// Applies parsed coach action tags in order, threading the payload through
// each step so e.g. "complete X, then focus on Y" composes correctly.
// Returns { payload, results } where results mirrors `actions` with a
// `matched` flag (and the matched `task`, where applicable) for each entry.
export function applyCoachActions(payload, actions, { lociDateStr, localDateStr, lastUserMessage = "", now = Date.now() } = {}) {
  let nextPayload = payload;
  const results = [];

  for (const action of actions) {
    if (!matchesUserIntent(action.type, lastUserMessage, action.title)) {
      results.push({ ...action, matched: false, blocked: true });
      continue;
    }

    if (action.type === "ADD_TASK") {
      const title = String(action.title || "").trim().slice(0, 300);
      if (!title || findExactActiveTask(nextPayload.tasks, title)) {
        results.push({ ...action, matched: false });
        continue;
      }
      // Mirrors AddTaskDialog's Evening Guard block: no new tasks at/after 8 PM.
      if (nextPayload.config?.eveningGuardWindowActive && new Date(now).getHours() >= 20) {
        results.push({ ...action, matched: false, eveningGuardBlocked: true });
        continue;
      }
      nextPayload = buildAddTaskPayload(nextPayload, title, now);
      results.push({ ...action, matched: true });
      continue;
    }

    const task = findTaskByTitle(nextPayload.tasks, action.title);
    if (!task) {
      results.push({ ...action, matched: false });
      continue;
    }
    if (action.type === "SET_NOW_FOCUS" || action.type === "START_FOCUS") {
      nextPayload = { ...nextPayload, tasks: buildSetNowFocusTasks(nextPayload.tasks, task.uuid) };
    } else if (action.type === "COMPLETE_TASK") {
      nextPayload = buildCompleteTaskPayload(nextPayload, task, lociDateStr, localDateStr);
    } else if (action.type === "PARK_TASK") {
      nextPayload = { ...nextPayload, tasks: buildParkTaskTasks(nextPayload.tasks, task.uuid) };
    }
    results.push({ ...action, matched: true, task });
  }

  return { payload: nextPayload, results };
}
