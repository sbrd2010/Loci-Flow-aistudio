// Coach Actions — generalizes the [[CHECKIN_IN:N]] tag pattern (see
// coachCheckin.js) for the AI Coach's "Hands" tier: explicit, user-requested
// task mutations. Each tag is invisible (stripped from the reply), but unlike
// CHECKIN_IN the coach is instructed to narrate the action in its visible text.
//
// [[SET_NOW_FOCUS:<title>]] - pin a task as Now Focus (unpinning any other)
// [[COMPLETE_TASK:<title>]] - mark a task complete (+100 XP, +1 contribution)

import { buildToggleCompletedTasks } from "./taskOps";
import { isActiveLociTask } from "./lociAIContext";

const ACTION_TAG_RE = /\s*\[\[(SET_NOW_FOCUS|COMPLETE_TASK):\s*([^\]]+?)\s*\]\]/gi;

// Strips all recognized coach action tags from an AI reply. Returns
// { cleanText, actions } where actions is an ordered list of
// { type: "SET_NOW_FOCUS"|"COMPLETE_TASK", title }.
export function parseCoachActionTags(text = "") {
  const actions = [];
  const cleanText = text.replace(ACTION_TAG_RE, (_match, type, title) => {
    actions.push({ type: type.toUpperCase(), title: title.trim() });
    return "";
  }).trim();
  return { cleanText, actions };
}

function normalizeTitle(str = "") {
  return String(str).toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

// Fuzzy-matches a tag's title against the user's active tasks: an exact match
// first, then a single unambiguous substring match in either direction.
// Returns null if nothing matches or more than one task matches equally well.
export function findTaskByTitle(tasks = [], rawTitle = "") {
  const target = normalizeTitle(rawTitle);
  if (!target) return null;
  const active = (tasks || []).filter(isActiveLociTask);

  const exact = active.find(t => normalizeTitle(t.title) === target);
  if (exact) return exact;

  const partial = active.filter(t => {
    const norm = normalizeTitle(t.title);
    return norm.includes(target) || target.includes(norm);
  });
  return partial.length === 1 ? partial[0] : null;
}

// Pins the given task as Now Focus, unpinning any other — mirrors
// TodayTab's handlePinTask.
export function buildSetNowFocusTasks(tasks, taskUuid, now = Date.now()) {
  return tasks.map(t => {
    const newFocus = t.uuid === taskUuid;
    if (t.isNowFocus === newFocus) return t;
    return { ...t, isNowFocus: newFocus, lastUpdated: now };
  });
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
// `matched` flag (and the matched `task`) for each entry.
export function applyCoachActions(payload, actions, { lociDateStr, localDateStr } = {}) {
  let nextPayload = payload;
  const results = [];

  for (const action of actions) {
    const task = findTaskByTitle(nextPayload.tasks, action.title);
    if (!task) {
      results.push({ ...action, matched: false });
      continue;
    }
    if (action.type === "SET_NOW_FOCUS") {
      nextPayload = { ...nextPayload, tasks: buildSetNowFocusTasks(nextPayload.tasks, task.uuid) };
    } else if (action.type === "COMPLETE_TASK") {
      nextPayload = buildCompleteTaskPayload(nextPayload, task, lociDateStr, localDateStr);
    }
    results.push({ ...action, matched: true, task });
  }

  return { payload: nextPayload, results };
}
