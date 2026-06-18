const CRISIS_RE = /\b(suicid(?:e|al)|kill(?:ing)? myself|want(?:s|ed)? to die|don'?t want to (?:exist|be here|live)|end(?:ing)? (?:it all|my life)|self[-\s]?harm|hurt(?:ing)? myself|might hurt myself|better off (?:dead|without me)|i feel unsafe|can'?t do this anymore|done with life)\b/i;

const PANIC_RE = /\b(panic(?:king)?|can'?t breathe|chest (?:pain|tight\w*)|heart\w*.{0,15}racing|hyperventilat\w*)\b/i;

const PROFILE_RE = /\b(what do you know about me|what do you remember about me|what have you learned about me|tell me my pattern|why am i like this|tell me about myself)\b/i;

const REMINDER_VERB_RE = /\b(remind me|check in|follow up|circle back|ask me again|ping me)\b/i;
const TIME_SIGNAL_RE = /\b(later|in \d+\s*min\w*|at \d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow(?: morning)?)\b/i;
const STANDALONE_TIME_RE = /\b(in \d+\s*min\w*|tomorrow morning)\b/i;

function isCheckinRequest(text) {
  return (REMINDER_VERB_RE.test(text) && TIME_SIGNAL_RE.test(text)) || STANDALONE_TIME_RE.test(text);
}

const TASK_RE = /\b(plan(?:ning)? (?:my|the|today)|prioriti[sz]e|deadline|schedule|agenda|now focus|set now focus|pin now focus|what should i do|what do i have to do|what are my tasks|what should i work on|help me choose|next step|add (?:this |that )?task|add (?:it )?to (?:my|the|today'?s) list|add\b.{1,50}\bto (?:my|the) list|create (?:a )?task|capture this|put (?:this|it) in (?:my|the) tasks|mark\b.{1,50}\bdone\b|mark (?:it |this )?done|completed|finished|complete this|i('m| am) done with (?:this|that|it)?\s*task|i('m| am) done with .{1,50}\btask|delete (?:this|that) task|undo|park (?:this|that)|defer (?:this|that)|move (?:this|it) to (?:today|week|month|quarter|6 months|work)|start (?:a )?timer|start (?:a )?focus|focus session|overdue|(?:what'?s|what is|anything) due|due (?:today|tomorrow|this week|date)|tasks?|my list|on my list|parked|what did i park|should i start|which task should i start)\b/i;

const EMOTIONAL_RE = /\b(comfort me|i feel (?:terrible|awful|horrible|useless|down|bad|sad|low|hopeless)|i hate this|i failed|i wasted (?:the|my) day|i('m| am) overwhelmed|too many things|don'?t know where to start|don'?t push (?:tasks|me)|i('m| am) stuck|can'?t (?:start|focus)|i('m| am) stressed|i('m| am) anxious|fight with|my family is stressing me|i need rest|i just want to (?:play games|rest)|i did it|small win|i('m| am) frustrated|i can'?t work|done with everything)\b/i;

const FRESH_SCAN_RE = /\b(scan (everything|all|my list|all my tasks|my whole list) again|re-plan|look at (everything|all my tasks) again|fresh scan|full scan|check all my tasks|review my whole list|re-plan from my full list|look at all my tasks|scan all my tasks)\b/i;

const COMPACT_FOLLOWUP_RE = /\b(key point|one sentence|10-minute version|make it smaller|shorter|how do i start|make this easier|concrete steps|what should i do next|set that|do next|tell me more|what did you mean|how do i do that|which one|why\??|explain that|elaborate|clarify)\b/i;

const EXPLICIT_ACTION_RE = /\b(add (?:this|that)?\s*task|add\b.{1,50}\bto (?:my |the )?(?:today'?s?\s+)?list|add\b.{1,50}\bto (?:today|week|month|quarter|work)|create (?:a )?task|capture this|put (?:this|it) in (?:my|the)?\s*tasks|mark\b.*\bdone|mark (?:it|this)? done|done with (?:this|that|it)?\s*task|done with .{1,50}\btask|complete this|delete (?:this|that) task|park (?:this|that|it|task)\b|park\s+.{1,50}\btask|defer (?:this|that|it|task)\b|defer\s+.{1,50}\btask|move (?:this|it) to|start (?:a )?timer|start (?:a )?focus|focus session)\b/i;

/**
 * Classifies a Coach chat message into the smallest context mode that
 * still serves it well: "light", "emotional", "full_task", "compact_task", or
 * "profile_reflection".
 */
export function classifyContextMode(message, { lastFullTaskTime = 0, hasLastPlan = false } = {}) {
  const text = String(message || "");

  if (CRISIS_RE.test(text) || PANIC_RE.test(text)) return "emotional";
  if (PROFILE_RE.test(text)) return "profile_reflection";

  // Check full-task pacing (10 minutes)
  const isPaced = lastFullTaskTime > 0 && (Date.now() - lastFullTaskTime < 10 * 60 * 1000);
  const isFreshScanRequested = FRESH_SCAN_RE.test(text);

  // 1. Explicit task action mutations take priority over emotional support
  if (EXPLICIT_ACTION_RE.test(text)) {
    if (isPaced && hasLastPlan && !isFreshScanRequested) {
      return "compact_task";
    }
    return "full_task";
  }

  // 2. Emotional distress takes priority over general task planning or follow-ups
  if (EMOTIONAL_RE.test(text)) return "emotional";

  // 3. General task queries and check-in requests
  if (isCheckinRequest(text) || TASK_RE.test(text)) {
    if (isPaced && hasLastPlan && !isFreshScanRequested) {
      return "compact_task";
    }
    return "full_task";
  }

  // 4. Compact follow-up requests
  if (isPaced && hasLastPlan && !isFreshScanRequested && COMPACT_FOLLOWUP_RE.test(text)) {
    return "compact_task";
  }

  return "light";
}

const REFERENCE_RE = /\b(what did you mean|how do i do that|tell me more|which one|what was the first option|why\??|can you explain that|explain that|elaborate|clarify|key point|one sentence|10-minute version|make it smaller|shorter|how do i start|make this easier|concrete steps|what should i do next|set that|do next)\b/i;

export function needsConversationContext(message) {
  const text = String(message || "");
  return REFERENCE_RE.test(text);
}

export function trimHistoryForDb(history, userText, maxDbHistory = 20) {
  const withUser = [...(history || []), { text: userText, isUser: true }];
  return withUser.length > maxDbHistory ? withUser.slice(withUser.length - maxDbHistory) : withUser;
}

export function trimHistoryForLLM(withUser, contextMode, isReference) {
  const historyLimit = (contextMode === "light" && !isReference) ? 3 : 10;
  return (withUser || []).length > historyLimit ? withUser.slice(withUser.length - historyLimit) : withUser;
}
