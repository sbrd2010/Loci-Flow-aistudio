// The crisis / medical-risk short-circuit.
//
// This is a property of EVERY free-text path that reaches the AI provider, not
// of one screen. It lived inside rescueCoachPrompt.js, where only Rescue could
// reach it — so Coach, which is the same kind of box talking to the same
// provider, had nothing but prompt instructions telling the model how to
// answer. That is a weaker guarantee in two ways: it depends on the model
// complying, and it depends on the request completing at all. These provider
// keys rate-limit hard; a 429 would have turned a crisis message into an error.
//
// Answering here means the text never leaves the device and the reply is
// certain. Mind Box capture is local and never reaches a provider, so it needs
// no check; its "Organize with AI" step, Add task's "Ask AI", Split a task and
// Today's break-down do send typed text, so each calls this first.
//
// The patterns are deliberately unchanged from the ones Rescue has always used.
// Widening what counts as a crisis is a design decision, not a refactor:
// coachContextMode.js carries a slightly broader variant for choosing a reply
// *mode*, where a false positive costs nothing — here it would answer someone
// frustrated with a task as though they were in danger.
// Widened with the owner's OK (#594): the live baseline answered "I don't think I
// can keep going like this anymore" (playbook 063, rated Crisis) as a productivity
// block. Each added phrase needs its crisis cue ("like this", "anymore", "to live",
// "forever") so frustration with a task still reaches the Coach; see the tests.
// Typos and slang count too (owner's OK, #594): someone in distress types fast, and
// "i just wnat to die" or "sucide" must not depend on a model catching it.
const WANT_TO = "(?:(?:want|wnat|wamt)(?:s|ed)? to|wann?a)";
export const CRISIS_RE = new RegExp([
  `\\b(su(?:ic|c|is)i?d(?:e|al)|kil+(?:ing)? my ?self|${WANT_TO} die|d(?:o)?n['’]?t ${WANT_TO} (?:exist|be here|live)|end(?:ing)? (?:it all|my life)|self[-\\s]?harm|hurt(?:ing)? my ?self|might hurt my ?self|better off (?:dead|without me)|i feel unsafe|done with life)\\b`,
  "\\b(?:can['’]?t|cannot|can not|don['’]?t think i can|not sure i can) (?:keep going|go on|carry on) (?:like this|anymore|any more|much longer)\\b",
  "\\bno (?:reason|point) (?:to|in) (?:live|living|go on|going on|be(?:ing)? (?:here|alive))\\b(?! with\\b)",
  "\\b(?:no|lost (?:the|my|all)) (?:desire|will|wish) to live\\b(?! (?:in|with|like|near|abroad|there)\\b)",
  "\\bdon['’]?t want to wake up(?! (?:early|at|before|for|so|in time|to|tomorrow)\\b)",
  "\\b(?:is(?:n['’]?t| not)|not) worth living\\b|\\bwish i (?:was|were)n['’]?t (?:alive|here|born)\\b|\\bwish i (?:was|were) (?:dead|never born)\\b",
  "\\bi (?:want to|wish i could|just want to) disappear (?:forever|for good)\\b",
].join("|"), "i");
export const MEDICAL_RISK_RE = /\b(can['’]?t breathe|chest (?:pain|(?:feels |is |feeling |gets )?tight\w*)|heart\w*.{0,15}racing|faint(?:ing)?|passed out|overdose|medical emergency)\b/i;

// What the model sees in place of such a turn: that something private was said
// and answered here, but not what. Silence would let the next reply carry on
// as if nothing had happened.
export const PRIVATE_USER_TURN = "(I shared something private. It was answered on my device and not shown to you.)";
export const PRIVATE_REPLY_TURN = "(A safety reply was given on the user's device.)";

const CRISIS_TAIL = "this sounds serious and you should not be alone with it.";
const MEDICAL_TAIL = "that could be urgent.";

// The messages of `history` that Coach answered locally on a crisis or medical
// message: that user message and the canned reply under it. They were kept off
// the provider when sent, so they stay off it when the history is replayed to
// the model or folded into the conversation summary. A reply is matched by its
// fixed wording, not the name before it, which the user can change later.
export function localSafetyTurns(history = []) {
  const turns = new Set();
  history.forEach((m, i) => {
    const next = history[i + 1];
    if (!m?.isUser || !next || next.isUser) return;
    if (!CRISIS_RE.test(m.text || "") && !MEDICAL_RISK_RE.test(m.text || "")) return;
    const reply = String(next.text || "");
    if (!reply.includes(CRISIS_TAIL) && !reply.includes(MEDICAL_TAIL)) return;
    turns.add(m);
    turns.add(next);
  });
  return turns;
}

// Returns the reply to give locally, or null to carry on to the provider.
export function buildLocalSafetyReply(userText = "", firstName = "friend") {
  const name = firstName || "friend";
  const text = String(userText || "");
  if (CRISIS_RE.test(text)) {
    return `${name}, this sounds serious and you should not be alone with it. If you might hurt yourself or are in immediate danger, contact emergency services now; otherwise reach a trusted person or a local crisis line right now, and stay with me while you do.`;
  }
  if (MEDICAL_RISK_RE.test(text)) {
    return `${name}, that could be urgent. Please stop focusing on tasks and seek medical help now, especially if you have chest pain, trouble breathing, fainting, or symptoms that feel dangerous.`;
  }
  return null;
}
