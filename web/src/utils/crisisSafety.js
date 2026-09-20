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
// no check.
//
// The patterns are deliberately unchanged from the ones Rescue has always used.
// Widening what counts as a crisis is a design decision, not a refactor:
// coachContextMode.js carries a slightly broader variant for choosing a reply
// *mode*, where a false positive costs nothing — here it would answer someone
// frustrated with a task as though they were in danger.
export const CRISIS_RE = /\b(suicid(?:e|al)|kill(?:ing)? myself|want(?:s|ed)? to die|don['’]?t want to (?:exist|be here|live)|end(?:ing)? (?:it all|my life)|self[-\s]?harm|hurt(?:ing)? myself|might hurt myself|better off (?:dead|without me)|i feel unsafe|done with life)\b/i;
export const MEDICAL_RISK_RE = /\b(can['’]?t breathe|chest (?:pain|tight\w*)|heart\w*.{0,15}racing|faint(?:ing)?|passed out|overdose|medical emergency)\b/i;

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
