const CRISIS_RE = /\b(suicid(?:e|al)|kill(?:ing)? myself|want(?:s|ed)? to die|don['’]?t want to (?:exist|be here|live)|end(?:ing)? (?:it all|my life)|self[-\s]?harm|hurt(?:ing)? myself|might hurt myself|better off (?:dead|without me)|i feel unsafe|can['’]?t do this anymore|done with life)\b/i;

const PANIC_RE = /\b(panic(?:king)?|can['’]?t breathe|chest (?:pain|tight\w*)|heart\w*.{0,15}racing|hyperventilat\w*)\b/i;

const PROFILE_RE = /\b(what do you know about me|what do you remember about me|what have you learned about me|tell me my pattern|why am i like this|tell me about myself)\b/i;

const REMINDER_VERB_RE = /\b(remind me|check in|follow up|circle back|ask me again|ping me)\b/i;
const TIME_SIGNAL_RE = /\b(later|in \d+\s*min\w*|at \d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow(?: morning)?)\b/i;
const STANDALONE_TIME_RE = /\b(in \d+\s*min\w*|tomorrow morning)\b/i;

const BROAD_TASK_QUERY_RE = /\b(what are my tasks|what['’]?s due|what is due|anything due|due date|what['’]?s my deadline|what is my deadline|show my tasks|what do i have today|what tasks do i have|list my tasks|my task list|show my list|what['’]?s on my list|what do i need to do today|check (?:my |the )?(?:today['’]?s|this week['’]?s?|week) (?:focus|horizon)|check (?:this|my) week horizon|check today['’]?s focus|today['’]?s?\s+focus|what['’]?s?\s+my\s+focus\b|my\s+focus\s+for\s+today|today['’]?s?\s+priorit(?:y|ies)|(?:what are|tell me|show me|check|what about) my(?:\s+(?:this\s+|(?:\d+|six)\s+)?(?:career|work|health|personal|month|quarter)s?['’]?s?(?:\s*(?:and|&|\/|,)\s*(?:this\s+|(?:\d+|six)\s+)?(?:career|work|health|personal|month|quarter)s?['’]?s?){0,2})?\s*priorit(?:y|ies)|what should be my priority|which priority should i focus on|can['’]?t you check|check my week|(?:what['’]?s|what is|anything)\s+(?:actually |really )?(?:urgent|pressing|critical|important)\b|(?:what['’]?s|what is)(?: next)? on my plate(?: today)?|(?:what['’]?s|what is) in my brain dump|check my brain dump|what do i even do|what['’]?s there to do|what to do (?:right now|today|now)\b)\b/i;

// Real users type messy — texting shorthand, dropped apostrophes, common
// abbreviations — and every regex above only recognizes clean English
// phrasing. Rather than hand-tuning every regex for every possible typo
// (a losing battle), normalize a small set of very common, low-risk
// shorthand tokens to their canonical form before classification. This never
// touches the message actually sent to the LLM or stored in chat history —
// it only affects which context mode the classifier picks.
const SHORTHAND_MAP = [
  [/\bwut\b/gi, "what"],
  [/\bwat\b/gi, "what"],
  [/\bshud\b/gi, "should"],
  [/\brn\b/gi, "right now"],
  [/\bu\b/gi, "you"],
  [/\bur\b/gi, "your"],
  [/\br\b/gi, "are"],
  [/\b2\b/gi, "to"],
  [/\b4\b/gi, "for"],
  [/\bb4\b/gi, "before"],
  [/\bdis\b/gi, "this"],
  [/\bdat\b/gi, "that"],
  [/\bkno\b/gi, "know"],
  [/\bsumthing\b/gi, "something"],
  [/\bsumthin\b/gi, "something"],
  [/\bgimme\b/gi, "give me"],
  [/\bwanna\b/gi, "want to"],
  [/\bgonna\b/gi, "going to"],
  [/\bgotta\b/gi, "got to"],
  [/\bidk\b/gi, "i do not know"],
  [/\bive\b/gi, "i have"],
  // Dropped-apostrophe "im" (extremely common when typing fast) doesn't match
  // any of this file's many "i(['’]m| am) ..." patterns (overwhelmed, stuck,
  // stressed, anxious, frustrated, etc.) — normalize it to "i am" so those
  // patterns work exactly as they already do for "i'm"/"i am".
  [/\bim\b/gi, "i am"],
  [/\btodos\b/gi, "tasks"],
  [/\btodo\b/gi, "task"],
];

function normalizeForClassification(text) {
  return SHORTHAND_MAP.reduce((acc, [re, replacement]) => acc.replace(re, replacement), text);
}

function isCheckinRequest(text) {
  return (REMINDER_VERB_RE.test(text) && TIME_SIGNAL_RE.test(text)) || STANDALONE_TIME_RE.test(text);
}

const TASK_RE = /\b(plan(?:ning)? (?:my|the|today)|prioriti[sz]e|deadline|schedule|agenda|now focus|set now focus|pin now focus|what should i do|what do i have to do|what are my tasks|what should i work on|help me choose|next step|add (?:this |that )?task|add (?:it )?to (?:my|the|today['’]?s) list|add\b.{1,50}\bto (?:my|the) list|create (?:a )?task|capture this|put (?:this|it) in (?:my|the) tasks|mark\b.{1,50}\bdone\b|mark (?:it |this )?done|completed|finished|complete this|i(['’]m| am) done with (?:this|that|it)?\s*task|i(['’]m| am) done with .{1,50}\btask|(?:done with|finished)\s+(?!life\b|everything\b)[a-z0-9\s'’\"_-]{2,50}|delete (?:this|that) task|undo|park (?:this|that)|defer (?:this|that)|(?:park|defer)\s+(?!life\b|everything\b)[a-z0-9\s'’\"_-]{2,50}|move (?:this|it) to (?:today|week|month|quarter|6 months|work)|start (?:a )?timer|start (?:a\s+|current\s+|now\s+)?focus|focus session|overdue|(?:what['’]?s|what is|anything) due|due (?:today|tomorrow|this week|date)|tasks?|my list|on my list|parked|what did i park|should i start|which task should i start)\b/i;

const EMOTIONAL_RE = /\b(comfort me|i feel (?:terrible|awful|horrible|useless|down|bad|sad|low|hopeless)|i feel like .{0,20}\bfailure\b|i hate this|i failed|i(?:['’]ve| have)? wasted (?:the|my)(?:\s+\w+){0,2}\s+day|i(['’]m| am) overwhelmed|too many things|don['’]?t know where to start|don['’]?t push (?:tasks|me)|i(['’]m| am) stuck|can['’]?t (?:start|focus)|i(['’]m| am) stressed|i(['’]m| am) anxious|fight with|my family is stressing me|i need rest|i just want to (?:play games|rest)|i did it|small win|i(['’]m| am) frustrated|i can['’]?t work|done with everything)\b/i;

const FRESH_SCAN_RE = /\b(scan (everything|all|my list|all my tasks|my whole list) again|re-plan|look at (everything|all my tasks) again|fresh scan|full scan|check all my tasks|review my whole list|re-plan from my full list|look at all my tasks|scan all my tasks)\b/i;

const COMPACT_FOLLOWUP_RE = /\b(key point|one sentence|10[-\s]?min(?:ute)?s?\s*version|make it smaller|shorter|how do i start|make this easier|concrete steps|turn (?:that|this|it) into .{0,30}steps|what should i do next|set that|do next|tell me more|what did you mean|how do i do that|which one|why\??|explain that|elaborate|clarify)\b/i;

const EXPLICIT_ACTION_RE = /\b(add (?:this|that)?\s*task|add\b.{1,50}\bto (?:my |the )?(?:today['’]?s?\s+)?list|add\b.{1,50}\bto (?:today|week|month|quarter|work)|create (?:a )?task|capture this|put (?:this|it) in (?:my|the)?\s*tasks|mark\b.*\bdone|mark (?:it|this)? done|done with (?:this|that|it)?\s*task|done with .{1,50}\btask|(?:done with|finished)\s+(?!life\b|everything\b)[a-z0-9\s'’\"_-]{2,50}|complete this|delete (?:this|that) task|park (?:this|that|it|task)\b|park\s+.{1,50}\btask|defer (?:this|that|it|task)\b|defer\s+.{1,50}\btask|(?:park|defer)\s+(?!life\b|everything\b)[a-z0-9\s'’\"_-]{2,50}|move (?:this|it) to|start (?:a )?timer|start (?:a\s+|current\s+|now\s+)?focus|focus session|(?:switch|set|swap)\s+(?:my\s+|the\s+)?focus\s+(?:to|on)|make\s+.{1,40}\s+my focus\b|remind me (?:to|that|i)\b|don['’]?t forget\b)\b/i;

// Body-double session requests ("be my body double", "sit with me while I
// work", "stay with me") read as task/focus requests even when they don't
// use "start"/"focus"/"timer" wording — route them to full_task so the
// coach has task context to confirm and the COACH ACTIONS block to start a
// session via START_FOCUS.
const BODY_DOUBLE_RE = /\b(body[\s-]?double|sit with me|stay with me|work (?:alongside|next to) me|keep me company while i work)\b/i;

// Fear/distress phrasing ("I'm scared, stay with me") can overlap with
// BODY_DOUBLE_RE's "stay with me" wording but is emotional support, not a
// work-session request — route it to "emotional" instead of "full_task".
const FEAR_DISTRESS_RE = /\b(i(['’]m| am) (?:scared|afraid|terrified|frightened)|don['’]?t leave me)\b/i;

const TASK_ASK_RE = /\b(what should i (?:actually |really |just |honestly )?(?:do|work on|start|focus on)|which (?:one|task) shall i focus|shall i focus|help me (?:choose|pick|prioritize|plan)|choose a task|pick a task|pick one (?:thing|task)|next step|prioritize my|plan my|plan today)\b/i;

// Low-energy asks need the full visible task list with estimates so the
// coach can prefer the smallest task per the PRIORITY QUESTIONS rule — the
// compact_task prompt doesn't carry that context, so these always route to
// full_task even on the paced/compact-follow-up path.
const LOW_ENERGY_RE = /\b(low energy|no energy|low on energy|out of energy|exhausted|burnt out|burned out|running on empty|drained|too tired)\b/i;

// Category-filtered ("which work task should I do first?") or
// horizon-filtered ("what should I focus on this month?") priority questions
// need the PRIORITY QUESTIONS framework and {Category} tags that only the
// full_task prompt carries — never compact these, even on the paced path.
const PRIORITY_FILTER_RE = /\bwhich\s+(?:career|work|health|personal)\s+task\b|\b(?:career|work|health|personal)\s+(?:task|priorit\w*)\s+(?:should|to)\b|\bfocus on this\s+(?:month|quarter|week)\b|\b(?:focus on|priorit\w*)\b[^.?!]{0,30}\bfor\s+(?:my\s+)?(?:career|work|health|personal)\b/i;

/**
 * Classifies a Coach chat message into the smallest context mode that
 * still serves it well: "light", "emotional", "full_task", "compact_task", or
 * "profile_reflection".
 */
export function classifyContextMode(message, { lastFullTaskTime = 0, hasLastPlan = false } = {}) {
  const text = normalizeForClassification(String(message || ""));

  if (CRISIS_RE.test(text) || PANIC_RE.test(text)) return "emotional";
  if (PROFILE_RE.test(text)) return "profile_reflection";

  // Check full-task pacing (10 minutes)
  const isPaced = lastFullTaskTime > 0 && (Date.now() - lastFullTaskTime < 10 * 60 * 1000);
  const isFreshScanRequested = FRESH_SCAN_RE.test(text);
  const isBroadQuery = BROAD_TASK_QUERY_RE.test(text);
  const isCheckin = isCheckinRequest(text);
  const isLowEnergy = LOW_ENERGY_RE.test(text);
  const isPriorityFiltered = PRIORITY_FILTER_RE.test(text);

  // Define target reference keyword checker for explicit mutations
  const TARGET_REF_RE = /\b(this|that|it|this task|that task|current task|current focus|now focus|the plan|next step)\b/i;
  const isTargetedMutation = TARGET_REF_RE.test(text);

  // 1. Explicit task action mutations take priority over emotional support
  if (EXPLICIT_ACTION_RE.test(text)) {
    // Body-double/priority-filter/low-energy phrasing can co-occur with
    // explicit-mutation wording (e.g. "start a timer for this, which work
    // task should I do first") — don't compact those away from the prompt
    // blocks they specifically need.
    if (isPaced && hasLastPlan && !isFreshScanRequested && !isBroadQuery && !isCheckin && isTargetedMutation &&
        !isLowEnergy && !isPriorityFiltered && !BODY_DOUBLE_RE.test(text)) {
      return "compact_task";
    }
    return "full_task";
  }

  // 2. Emotional distress takes priority over general task planning, follow-ups,
  // and body-double requests — "I'm overwhelmed, stay with me" is distress
  // first, not a session to start.
  if (EMOTIONAL_RE.test(text)) {
    if (TASK_ASK_RE.test(text)) {
      return "full_task";
    }
    return "emotional";
  }

  // Body-double sessions always need the full visible task list (to confirm
  // the task) and the BODY-DOUBLE SESSIONS prompt instructions, which only
  // exist in full_task mode — never compact this one. But fear/distress
  // phrasing ("I'm scared, stay with me") is emotional support, not a
  // session to start.
  if (BODY_DOUBLE_RE.test(text)) {
    if (FEAR_DISTRESS_RE.test(text)) return "emotional";
    return "full_task";
  }

  // Broad task/deadline queries, standalone fresh-scan requests, and
  // category/horizon-filtered priority questions route to full_task
  if (isBroadQuery || isFreshScanRequested || isPriorityFiltered) return "full_task";

  // 3. General task queries and check-in requests
  if (isCheckin || TASK_RE.test(text) || TASK_ASK_RE.test(text)) {
    if (isPaced && hasLastPlan && !isFreshScanRequested && !isBroadQuery && !isCheckin && !isLowEnergy) {
      return "compact_task";
    }
    return "full_task";
  }

  // 4. Compact follow-up requests
  if (isPaced && hasLastPlan && !isFreshScanRequested && !isCheckin && COMPACT_FOLLOWUP_RE.test(text)) {
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
