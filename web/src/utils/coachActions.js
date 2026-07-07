// Coach Actions — generalizes the [[CHECKIN_IN:N]] tag pattern (see
// coachCheckin.js) for the AI Coach's "Hands" tier: explicit, user-requested
// task mutations. Each tag is invisible (stripped from the reply), but unlike
// CHECKIN_IN the coach is instructed to narrate the action in its visible text.
//
// [[SET_NOW_FOCUS:<title>]] - pin a task as Now Focus (unpinning any other)
// [[COMPLETE_TASK:<title>]] - mark a task complete (+100 XP, +1 contribution)
// [[ADD_TASK:<title>]]      - create a new Today task (P3, 25min default)
// [[PARK_TASK:<title>]]     - park a task (mirrors Bad Day Reset's per-task patch)
// [[START_FOCUS:<title>]] or [[START_FOCUS:<title>|<minutes>]] - pin a task as
//                            Now Focus so a focus session can start. The
//                            optional "|<minutes>" suffix (used for
//                            body-double sessions with a stated duration,
//                            clamped 5-20) is a one-off session length carried
//                            on the result for the timer launcher — it never
//                            overwrites the task's own time estimate.
//
// The system prompt tells the AI these tags are "explicit-request-only", but
// that's advisory — applyCoachActions() additionally requires (via
// matchesUserIntent) that the user's own last message contains language
// clearly requesting that kind of action before any tag is allowed to mutate.

import { buildToggleCompletedTasks } from "./taskOps";
import { isActiveLociTask } from "./lociAIContext";
import { safeUUID } from "./uuid";
import { normalizeForClassification } from "./coachContextMode";

const ACTION_TAG_RE = /\s*\[\[(SET_NOW_FOCUS|COMPLETE_TASK|ADD_TASK|PARK_TASK|START_FOCUS):\s*((?:[^\]]|\](?!\]))+?)\s*\]\]/gi;

const START_FOCUS_DURATION_RE = /^(.*)\|\s*(\d{1,3})\s*(?:min(?:ute)?s?)?\s*$/i;

// Splits a START_FOCUS tag's raw title on an optional "|<minutes>" duration
// suffix, clamping the minutes to the 5-20 range the BODY-DOUBLE SESSIONS
// prompt instruction promises. Returns durationMinutes: null when no suffix.
function parseStartFocusTitle(rawTitle) {
  const match = START_FOCUS_DURATION_RE.exec(rawTitle);
  if (!match) return { title: rawTitle.trim(), durationMinutes: null };
  return { title: match[1].trim(), durationMinutes: Math.min(20, Math.max(5, parseInt(match[2], 10))) };
}

// Strips all recognized coach action tags from an AI reply. Returns
// { cleanText, actions } where actions is an ordered list of
// { type: "SET_NOW_FOCUS"|"COMPLETE_TASK"|"ADD_TASK"|"PARK_TASK"|"START_FOCUS", title, durationMinutes? }.
export function parseCoachActionTags(text = "") {
  const actions = [];
  const cleanText = text.replace(ACTION_TAG_RE, (_match, type, rawTitle) => {
    const upperType = type.toUpperCase();
    if (upperType === "START_FOCUS") {
      const { title, durationMinutes } = parseStartFocusTitle(rawTitle.trim());
      actions.push(durationMinutes != null ? { type: upperType, title, durationMinutes } : { type: upperType, title });
    } else {
      actions.push({ type: upperType, title: rawTitle.trim() });
    }
    return "";
  }).trim();
  return { cleanText, actions };
}

function normalizeTitle(str = "") {
  return String(str).toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
}

function normalizeStopWords(str = "") {
  return String(str || "").replace(/\b(the|a|an)\b/gi, "").replace(/\s+/g, " ").trim();
}

// Deterministic, code-enforced gating: a coach action tag may only mutate
// state if the user's own last message contains language that clearly
// requests that kind of action. Keeps the AI's "explicit-request-only" rule
// from being the only line of defense against acting on a hallucinated or
// misread request.
// Body-double phrasing never names a specific task ("be my body double",
// "sit with me while I work") — used both as a START_FOCUS intent signal and,
// below, to let such requests fall back to the current Now Focus task.
const BODY_DOUBLE_REF_RE = /\b(body[\s-]?double|sit with me|stay with me|work (?:alongside|next to) me|keep me company while i work)\b/i;

const INTENT_PATTERNS = {
  // "crossed ... off" mirrors coachContextMode.js's EXPLICIT_ACTION_RE
  // completion synonyms — see live-testing round 3.
  COMPLETE_TASK: /\b(done|finish(ed|ing)?|complet(e|ed|ing)|wrapped? up|knocked out|crossed\s+.{1,50}\boff\b)\b/i,
  // "set"/"swap" and "make X my focus" mirror the phrasings coachContextMode.js's
  // EXPLICIT_ACTION_RE now routes to full_task — without a matching intent
  // pattern here, the model could emit a SET_NOW_FOCUS tag for these that
  // this gate then blocks, while its visible narration ("switched your
  // focus...") still shows since messageSeemsActionLike would also be false.
  // The "make X my focus" branch excludes a preceding question word (what/
  // how/why/would/could/should) within a short lookbehind window, so an
  // analysis question like "what would make the report my focus easier?"
  // doesn't register as an imperative SET_NOW_FOCUS request.
  SET_NOW_FOCUS: /\b(focus on|switch.*focus|(?<!\b(?:what|how|why|would|could|should)\b.{0,20})(?:set|swap)\s+(?:my\s+|the\s+)?focus\s+(?:to|on)|(?<!\b(?:what|how|why|would|could|should)\b.{0,20})make\s+.{1,40}\s+my focus\b|prioriti[sz]e|now focus|pin( this| that)? task|pin\b|focus.*now)\b/i,
  // Second alternative covers body-double requests ("sit with me while I
  // work", "be my body double") — they ask for a focus session just as
  // clearly as "start a timer" does, without using start/begin/kick-off
  // wording. "dive into"/"jump into"/"time to work on" mirror
  // coachContextMode.js's EXPLICIT_ACTION_RE synonyms — see live-testing round 3.
  START_FOCUS: new RegExp(`\\b(start|begin|kick off|let'?s (start|go)).*(focus|timer|session|working)\\b|dive into|jump into|time to work on|${BODY_DOUBLE_REF_RE.source}`, "i"),
  // don['’]?t (not don'?t) so a curly/smart apostrophe (common on mobile
  // keyboards) still matches — coachContextMode.js's EXPLICIT_ACTION_RE
  // already accepts both forms for this same phrase. "jot/note down" and
  // "need to remember to" mirror the same file's synonyms — live-testing round 3.
  ADD_TASK: /\b(add( a| an)? task|create a task|new task|remind me (to|that|i)|don['’]?t forget|add .+ to (my |the )?(today'?s?(\s+(list|tasks?))?|list|tasks?)\b|put .+ (on|in) (my |the )?(today'?s?(\s+(list|tasks?))?|list|tasks?)\b|jot(?:ted)? down|note(?:d)? down|need to remember (?:to|that))/i,
  // "postpone"/"put off" mirror coachContextMode.js's EXPLICIT_ACTION_RE
  // synonyms — see live-testing round 3. All three share the same
  // advice-question exclusion PR #340 refined for "skip" alone (modal+I with
  // an optional filler word, "am I free to", "not going to hurt if I") —
  // without it, a bare verb here would let the gate treat the model's
  // answer to "what can I postpone today?"/"what can I put off?" as
  // authorizing an actual park mutation the user never requested.
  PARK_TASK: /\b(park|defer|set aside|shelve|save .* for later|not (today|now|right now)|(?<!\b(?:(?:can|could|would|should|do)\s+i|am\s+i\s+free\s+to|not\s+going\s+to\s+hurt\s+if\s+i)\s+(?:just|maybe|really|actually|honestly)?\s*)(?:skip|postpone|put off))\b/i,
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

// Common English function words that are >=3 characters but carry no
// task-identifying signal — without excluding these, a title like "Reply to
// the important message sitting in your inbox" would count as "mentioned" by
// any message containing "the" or "your" (virtually all of them), letting an
// ambiguous message like "I'm done with the task" falsely corroborate
// completing an unrelated task. See titleMentionedInMessage.
const STOPWORDS_RE = /^(the|and|for|are|but|not|you|all|can|her|his|its|our|out|day|get|has|him|how|man|new|now|old|see|way|who|did|let|put|say|she|too|use|your|this|that|these|those|from|into|than|then|them|they|been|being|have|had|will|would|could|should|may|might|must|off|any|some|more|most|over|under|about|just|with|when|what|which|does|task|tasks)$/i;

// Checks whether `phrase`'s words appear as a contiguous, whole-word run
// inside `message` (both already space-normalized). Unlike a raw substring
// check, this doesn't let a longer word's prefix count as a match — e.g.
// "get out" must not match inside "get output".
function includesWholeWordPhrase(message, phrase) {
  const messageWords = message.split(" ");
  const phraseWords = phrase.split(" ");
  for (let i = 0; i <= messageWords.length - phraseWords.length; i++) {
    if (phraseWords.every((w, j) => messageWords[i + j] === w)) return true;
  }
  return false;
}

// Checks that at least one "significant" word (length >= 3, and not a common
// stopword) from the tag's title appears in the user's message. Titles with
// no words of length >= 3 at all (e.g. "it") are passed through —
// findTaskByTitle's own length guard handles those at resolution time.
function titleMentionedInMessage(title, message) {
  const normalizedTitle = normalizeTitle(title);
  const lengthFiltered = normalizedTitle
    .split(" ")
    .filter(w => w.length >= 3 && !/^pr\d+$/i.test(w));
  if (lengthFiltered.length === 0) return true;
  const significant = lengthFiltered.filter(w => !STOPWORDS_RE.test(w));
  const normMessage = normalizeTitle(message);
  if (significant.length === 0) {
    // Every length->=3 word in this title is itself a common stopword (e.g.
    // "New Task", "Day Off", "Just Do It") — falling back to the title's own
    // (still-generic) words would recreate the exact false-corroboration bug
    // the stopword exclusion exists to close (e.g. "New Task" would match any
    // message mentioning "task"). No single word here reliably identifies
    // this task over any other, so only accept a verbatim, whole-word mention
    // of the whole title — anything else must go through matchesUserIntent's
    // separate pronoun/current-focus corroboration paths instead.
    return includesWholeWordPhrase(normMessage, normalizedTitle);
  }
  return significant.some(w => normMessage.includes(w));
}

// Loosely tests whether the user's message itself uses language associated
// with this action type — the same intent-pattern/negation scan as
// matchesUserIntent, minus the title-check. Used to tell a genuinely
// stale/unrelated blocked action tag (the message doesn't ask for this kind
// of action at all) apart from an ambiguous one (it does, but the tag's
// title didn't match a task) — see buildActionReplyText.
export function messageSeemsActionLike(actionType, message = "") {
  const pattern = INTENT_PATTERNS[actionType];
  if (!pattern) return false;
  // Same shorthand normalization coachContextMode.js applies before deciding
  // whether this message even reaches a mode with COACH ACTIONS instructions
  // — without it, a message like "remind me 2 call the plumber" can reach
  // full_task (via the normalized text) but then have its ADD_TASK tag
  // blocked here (seeing the raw, un-normalized "2" instead of "to").
  const msg = normalizeForClassification(String(message || ""));
  if (actionType === "COMPLETE_TASK" && NON_SPECIFIC_COMPLETION_RE.test(msg)) return false;

  // Scan every match of the intent pattern, not just the first — an earlier
  // match can sit in a negated clause while a later one in the same message
  // is a genuine, unnegated request (e.g. "I'm not done with X, but I
  // finished Y").
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let match;
  while ((match = globalPattern.exec(msg)) !== null) {
    // Look back to the start of the current clause (the last sentence-ending
    // punctuation, or the start of the message) rather than a fixed character
    // window — catches negations like "Don't ... mark it complete" regardless
    // of how many words sit between "don't" and the matched action word.
    const clauseStart = Math.max(
      msg.lastIndexOf(".", match.index - 1),
      msg.lastIndexOf(",", match.index - 1),
      msg.lastIndexOf("!", match.index - 1),
      msg.lastIndexOf("?", match.index - 1),
      msg.lastIndexOf("\n", match.index - 1)
    ) + 1;
    const preceding = msg.slice(clauseStart, match.index);
    if (NEGATION_RE.test(preceding)) continue;
    return true;
  }
  return false;
}

function isClarificationFlow(actionType, lastUserMessage, prevUserMessage, prevAssistantMessage) {
  if (!prevUserMessage || !prevAssistantMessage) return false;
  
  const msg = String(lastUserMessage || "").trim().toLowerCase();
  const prevAssistant = String(prevAssistantMessage || "").trim().toLowerCase();
  
  // Enforce that the current message is a short response
  if (msg.length > 150) return false;

  // Assistant's previous message must be a question/clarification
  const isAssistantQuestion = (prevAssistant.includes("?") || 
                               /\b(which|should|would|choose|separate|one|or|confirm)\b/i.test(prevAssistant)) &&
                              /\b(task|tasks|focus|add|park|done|complete|which|separate|one|or|confirm)\b/i.test(prevAssistant);
  if (!isAssistantQuestion) return false;

  if (actionType === "ADD_TASK") {
    // Clarification for adding: e.g. "2 separate", "one task", "yes", "separate"
    return /\b(separate|one|yes|no|ok|both|neither|2|two|1|single)\b/i.test(msg) || 
           msg.length < 50;
  }

  // For other actions, the user is naming/clarifying the task title in response to a question
  return msg.length < 100;
}

export function matchesUserIntent(actionType, lastUserMessage = "", title = "", chatHistory = [], currentFocusTitle = null) {
  if (!INTENT_PATTERNS[actionType]) return false;

  let prevUserMessage = "";
  let prevAssistantMessage = "";
  
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    if (msg.isUser) {
      if (!prevUserMessage) {
        prevUserMessage = msg.text || "";
      }
    } else {
      if (!prevAssistantMessage) {
        prevAssistantMessage = msg.text || "";
      }
    }
  }

  let hasIntent = false;
  if (messageSeemsActionLike(actionType, lastUserMessage)) {
    hasIntent = true;
  } else if (prevUserMessage && messageSeemsActionLike(actionType, prevUserMessage)) {
    if (isClarificationFlow(actionType, lastUserMessage, prevUserMessage, prevAssistantMessage)) {
      hasIntent = true;
    }
  }
  
  if (!hasIntent) return false;

  // Check if title is mentioned in current user message, previous user message, or previous assistant message
  const titleInCurrent = titleMentionedInMessage(title, String(lastUserMessage || ""));
  const titleInPrevUser = prevUserMessage ? titleMentionedInMessage(title, prevUserMessage) : false;
  const titleInPrevAssistant = prevAssistantMessage ? titleMentionedInMessage(title, prevAssistantMessage) : false;
  const isClarification = isClarificationFlow(actionType, lastUserMessage, prevUserMessage, prevAssistantMessage);
  const isPronounRef = /\b(this task|that task|the task|it|that|this)\b/i.test(String(lastUserMessage || ""));
  const pronounAllowed = isPronounRef && (titleInPrevUser || titleInPrevAssistant || isClarification);

  // Body-double requests ("be my body double") never name a task by
  // definition, so they imply the current Now Focus task just as clearly as
  // saying "now focus" or "current task" would.
  const isCurrentFocusRef = /\b(current focus|now focus|current task)\b/i.test(String(lastUserMessage || "")) ||
    (actionType === "START_FOCUS" && BODY_DOUBLE_REF_RE.test(String(lastUserMessage || "")));
  const isTargetCurrentFocus = currentFocusTitle && (normalizeTitle(title) === normalizeTitle(currentFocusTitle));
  const currentFocusAllowed = isCurrentFocusRef && isTargetCurrentFocus;

  return !!(titleInCurrent || titleInPrevUser || titleInPrevAssistant || pronounAllowed || currentFocusAllowed);
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

  const targetNorm = normalizeStopWords(target);
  const partial = active.filter(t => {
    const norm = normalizeStopWords(normalizeTitle(t.title));
    return norm.includes(targetNorm) || targetNorm.includes(norm);
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

// Generic keyword groups for inferTaskMetadata's category guess — no
// person- or project-specific terms, just the kind of word any user's task
// titles would naturally contain for that category. Checked in this order
// (Health first) so a title like "doctor's report" reads as Health, not Work.
const CATEGORY_KEYWORDS = {
  // "appointment" alone is intentionally not a Health cue — "recruiter
  // appointment" or "client appointment" would wrongly win over the
  // Career/Work cue also in the title. Pairing it with a health-specific
  // word still catches "doctor's/dentist/therapy appointment" (those terms
  // already match on their own) plus generic "medical appointment".
  Health: /\b(doctor|dentist|medical appointment|therapy|therapist|gym|workout|exercise|medication|medicine|blood test|checkup|check-up|clinic|hospital|prescription)\b/i,
  Career: /\b(resume|cv|recruiter|interview|job applications?|linkedin|cover letters?|networking|portfolio|job offers?)\b/i,
  Work: /\b(report|manager|meeting|deadline|client|project|presentation|standup|sprint|colleague|boss|deliverable)\b/i,
};

// Bumps an inferred task to P1 when the title itself signals urgency —
// doesn't change priority for any other keyword group.
const URGENT_KEYWORDS = /\b(urgent|asap|emergency|immediately|right away|critical)\b/i;

// Skips the P1 bump when urgency is explicitly negated ("not urgent",
// "non-urgent", "isn't an emergency") instead of asserted.
const NEGATED_URGENT_RE = /\b(?:not|non-?|isn['’]?t|aren['’]?t|no longer)\s*(?:so\s+|that\s+|very\s+|really\s+|an?\s+)?(?:urgent|asap|emergency|immediate(?:ly)?|critical|right away)\b/i;

// Best-effort category/priority guess for a Coach-added task, used only
// when the title doesn't otherwise specify one. Defaults to AddTaskDialog's
// existing Personal/P3 when nothing matches.
export function inferTaskMetadata(title) {
  const text = String(title || "");
  let category = "Personal";
  for (const [cat, re] of Object.entries(CATEGORY_KEYWORDS)) {
    if (re.test(text)) {
      category = cat;
      break;
    }
  }
  const priority = URGENT_KEYWORDS.test(text) && !NEGATED_URGENT_RE.test(text) ? "P1" : "P3";
  return { category, priority };
}

// Creates a new Today task from a chat-mentioned title — mirrors
// AddTaskDialog's defaults (P3, 25min, "Do first tiny step"), with
// category/priority inferred from the title via inferTaskMetadata.
function buildAddTaskPayload(payload, rawTitle, now = Date.now()) {
  const { tasks = [], config = {} } = payload;
  const title = String(rawTitle).trim().slice(0, 1000);
  if (!title) return payload;
  const orderIndex = tasks.filter(t => t.horizonLevel === "today" && !t.isDeleted).length;
  const { category, priority } = inferTaskMetadata(title);
  const newTask = {
    id: now,
    userId: payload.userId || config.userId || "",
    uuid: safeUUID(),
    title,
    concreteStep: "Do first tiny step",
    horizonLevel: "today",
    priority,
    category,
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
  const currentFocusTitle = (payload.tasks || []).find(t => isActiveLociTask(t) && t.isNowFocus)?.title || null;

  for (const action of actions) {
    if (!matchesUserIntent(action.type, lastUserMessage, action.title, payload.chatHistory || [], currentFocusTitle)) {
      results.push({ ...action, matched: false, blocked: true });
      continue;
    }

    if (action.type === "ADD_TASK") {
      const title = String(action.title || "").trim().slice(0, 1000);
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
    let resultTask = task;
    if (action.type === "SET_NOW_FOCUS" || action.type === "START_FOCUS") {
      nextPayload = { ...nextPayload, tasks: buildSetNowFocusTasks(nextPayload.tasks, task.uuid) };
      // A body-double session's "|<minutes>" duration is a one-off session
      // length, not a correction to the task's own time estimate — it's
      // carried on the result (action.durationMinutes, spread below) for the
      // caller's timer launcher to use directly, never written into the task.
      resultTask = nextPayload.tasks.find(t => t.uuid === task.uuid) || task;
    } else if (action.type === "COMPLETE_TASK") {
      nextPayload = buildCompleteTaskPayload(nextPayload, task, lociDateStr, localDateStr);
    } else if (action.type === "PARK_TASK") {
      nextPayload = { ...nextPayload, tasks: buildParkTaskTasks(nextPayload.tasks, task.uuid) };
    }
    results.push({ ...action, matched: true, task: resultTask });
  }

  return { payload: nextPayload, results };
}

// Per-action-type follow-up question used by buildActionReplyText when a
// blocked tag's title didn't resolve to a task but the user's message itself
// reads as a request for that kind of action (an "ambiguous" blocked action —
// see messageSeemsActionLike).
const CLARIFICATION_NOTES = {
  SET_NOW_FOCUS: `Which task should I focus on? Say: "Start focus on [task name]."`,
  START_FOCUS: `Which task should I focus on? Say: "Start focus on [task name]."`,
  ADD_TASK: "What exact task should I add?",
  COMPLETE_TASK: "Which task should I mark complete?",
  PARK_TASK: "Which task should I park?",
};

// Assembles the AI Coach's visible reply from its own text plus the outcome
// of any action tags. cleanText (the model's own narration) is used as-is
// only when there's nothing else to report: every tag matched (or there were
// none), or the only unmatched tags are stale blocked ones that don't even
// warrant a note (see below). Otherwise — at least one success line or
// failure/clarification note — cleanText is dropped entirely and the reply
// is built from successLines + notes instead, so it never claims success
// right next to a note saying it didn't happen. Within notes:
//  - "blocked" tags (matchesUserIntent failed) only contribute a note when
//    the user's message reads as a request for that action type at all
//    (messageSeemsActionLike) — a stale tag the model carried forward from an
//    earlier turn, with no corresponding ask in this message, is silently
//    dropped rather than triggering a generic "I'll only do that..." note.
//  - failed-but-not-blocked tags (task not found, duplicate ADD_TASK, Evening
//    Guard) always contribute a note, since these reflect a real outcome the
//    user should know about.
export function buildActionReplyText(cleanText, results = [], lastUserMessage = "") {
  const userWantedAction = Object.keys(INTENT_PATTERNS).some(type => messageSeemsActionLike(type, lastUserMessage));
  const successLines = results.filter(r => r.matched).map(r => {
    const title = r.task ? r.task.title : r.title;
    switch (r.type) {
      case "SET_NOW_FOCUS": return `Switched your focus to "${title}".`;
      case "START_FOCUS": return r.durationMinutes != null ? `Started a ${r.durationMinutes}-min focus session on "${title}".` : `Started a focus session on "${title}".`;
      case "COMPLETE_TASK": return `Marked "${title}" complete — +100 XP!`;
      case "ADD_TASK": return `Added "${title}" to your Today list.`;
      case "PARK_TASK": return `Parked "${title}" for later.`;
      default: return null;
    }
  }).filter(Boolean);

  const allUnmatchedAreStaleBlocked = results.every(r => 
    r.matched || (r.blocked && !messageSeemsActionLike(r.type, lastUserMessage))
  );

  if (results.length > 0) {
    if (allUnmatchedAreStaleBlocked) {
      return cleanText;
    }
  } else {
    if (!userWantedAction) {
      return cleanText;
    }
  }

  // Otherwise, we must construct the response purely from successLines and notes.
  const notFound = results.filter(r => !r.matched && !r.blocked && r.type !== "ADD_TASK");
  const addSkipped = results.filter(r => !r.matched && !r.blocked && r.type === "ADD_TASK" && !r.eveningGuardBlocked);
  const eveningGuardBlocked = results.filter(r => r.eveningGuardBlocked);
  const blocked = results.filter(r => r.blocked);

  const notes = [];
  if (notFound.length > 0) {
    notes.push(`I couldn't find ${notFound.map(r => `"${r.title}"`).join(" or ")} in your task list — could you double-check the name?`);
  }
  if (addSkipped.length > 0) {
    notes.push(`Looks like that's already on your list, so I didn't add a duplicate.`);
  }
  if (eveningGuardBlocked.length > 0) {
    notes.push(`Evening Guard is active, so I didn't add that — feel free to add it again tomorrow.`);
  }
  const clarifications = new Set();
  for (const r of blocked) {
    if (CLARIFICATION_NOTES[r.type] && messageSeemsActionLike(r.type, lastUserMessage)) {
      clarifications.add(CLARIFICATION_NOTES[r.type]);
    }
  }
  notes.push(...clarifications);

  if (successLines.length === 0 && notes.length === 0) {
    notes.push("I couldn't save that action yet.");
  }
  return [...successLines, ...notes].join(" ");
}
