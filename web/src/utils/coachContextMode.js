// Deterministic (non-AI) classifier that decides how much system-prompt
// context a Coach chat message actually needs. Today's full prompt
// (~17,400 chars) is sent for every message regardless of content, which
// burns token-per-minute budget on tiny messages like "Hi" and contributes
// to provider rate-limit errors after only 1-2 messages. This routes each
// message to the smallest prompt that still serves it well — see
// coachSystemPrompt.js for what each mode actually includes.
//
// Priority order matters: crisis/panic safety signals are checked first so
// they always win over any other word in the same message, then a profile/
// memory question, then task/check-in/reminder intent (so action requests
// never get short-changed), then general emotional-support language,
// falling back to "light" for anything else (greetings, small talk, simple
// factual questions).

const CRISIS_RE = /\b(suicid(?:e|al)|kill(?:ing)? myself|want(?:s|ed)? to die|don'?t want to (?:exist|be here|live)|end(?:ing)? (?:it all|my life)|self[-\s]?harm|hurt(?:ing)? myself|might hurt myself|better off (?:dead|without me)|i feel unsafe|can'?t do this anymore)\b/i;

const PANIC_RE = /\b(panic(?:king)?|can'?t breathe|chest (?:pain|tight\w*)|heart\w*.{0,15}racing|hyperventilat\w*)\b/i;

const PROFILE_RE = /\b(what do you know about me|what do you remember about me|what have you learned about me|tell me my pattern|why am i like this|tell me about myself)\b/i;

// Reminder/check-in phrasing routes to full_task so the COACH ACTIONS
// block's [[CHECKIN_IN:N]] instruction is present — light/emotional/
// profile_reflection prompts don't carry the full action-tag protocol. A
// standalone "later" is deliberately NOT enough on its own (too broad —
// would catch "talk later"/"okay later" and push casual sign-offs into the
// full prompt); "later" only counts paired with a reminder/check-in verb.
const REMINDER_VERB_RE = /\b(remind me|check in|follow up|circle back|ask me again|ping me)\b/i;
const TIME_SIGNAL_RE = /\b(later|in \d+\s*min\w*|at \d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow(?: morning)?)\b/i;
const STANDALONE_TIME_RE = /\b(in \d+\s*min\w*|tomorrow morning)\b/i;

function isCheckinRequest(text) {
  return (REMINDER_VERB_RE.test(text) && TIME_SIGNAL_RE.test(text)) || STANDALONE_TIME_RE.test(text);
}

const TASK_RE = /\b(plan(?:ning)? (?:my|the|today)|prioriti[sz]e|deadline|schedule|agenda|now focus|set now focus|pin now focus|what should i do|what do i have to do|what are my tasks|what should i work on|help me choose|next step|add (?:this |that )?task|add (?:it )?to (?:my|the|today'?s) list|add\b.{1,50}\bto (?:my|the) list|create (?:a )?task|capture this|put (?:this|it) in (?:my|the) tasks|mark\b.{1,50}\bdone\b|mark (?:it |this )?done|completed|finished|complete this|i('m| am) done with|delete (?:this|that) task|undo|park (?:this|that)|defer (?:this|that)|move (?:this|it) to (?:today|week|month|quarter|6 months|work)|start (?:a )?timer|start (?:a )?focus|focus session|overdue|(?:what'?s|what is|anything) due|due (?:today|tomorrow|this week|date)|tasks?|my list|on my list|parked|what did i park|should i start|which task should i start)\b/i;

const EMOTIONAL_RE = /\b(comfort me|i feel (?:terrible|awful|horrible|useless|down|bad|sad|low|hopeless)|i hate this|i failed|i wasted (?:the|my) day|i('m| am) overwhelmed|too many things|don'?t know where to start|don'?t push (?:tasks|me)|i('m| am) stuck|can'?t (?:start|focus)|i('m| am) stressed|i('m| am) anxious|fight with|my family is stressing me|i need rest|i just want to (?:play games|rest)|i did it|small win|i('m| am) frustrated|i can'?t work)\b/i;

/**
 * Classifies a Coach chat message into the smallest context mode that
 * still serves it well: "light", "emotional", "full_task", or
 * "profile_reflection".
 */
export function classifyContextMode(message) {
  const text = String(message || "");

  if (CRISIS_RE.test(text) || PANIC_RE.test(text)) return "emotional";
  if (PROFILE_RE.test(text)) return "profile_reflection";
  if (isCheckinRequest(text) || TASK_RE.test(text)) return "full_task";
  if (EMOTIONAL_RE.test(text)) return "emotional";
  return "light";
}

const REFERENCE_RE = /\b(what did you mean|how do i do that|tell me more|which one|what was the first option|why\??|can you explain that|explain that|elaborate|clarify)\b/i;

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
