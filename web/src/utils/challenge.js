// "What helps you most" (#656): one table, read the same way by Settings,
// Coach and Ask AI. The choice only shapes what Coach and Ask AI suggest;
// nothing else in Loci reads it, and the subtitles say so honestly.

export const CHALLENGES = [
  {
    value: "overplanner",
    label: "Help me decide what to work on",
    sub: "Coach and Ask AI help you narrow things down to the one that matters now.",
    coach: "over-plans; needs one clear thing to start now",
    description: "over-plans and researches but rarely starts (needs forced simplicity and an execution nudge)",
  },
  {
    value: "initiation",
    label: "Help me just start",
    sub: "Coach and Ask AI suggest tiny first steps and break tasks down.",
    coach: "freezes at the start; needs tiny first steps",
    description: "freezes before starting despite knowing what to do (needs scaffolding, micro-starts, and low-threshold first steps)",
  },
  {
    value: "momentum",
    label: "Keep me moving forward",
    sub: "Coach and Ask AI suggest quick, finishable tasks that build on what you've done.",
    coach: "needs quick wins to keep moving",
    description: "needs a quick win to get rolling (needs quick, finishable tasks and visible forward movement)",
  },
  {
    value: "overwhelmed",
    label: "Help me recover and catch up",
    sub: "Coach and Ask AI keep it gentle and shame-free, with one clear next step.",
    coach: "behind and overwhelmed; needs a gentle reset",
    description: "feels overwhelmed and guilty about backlog (needs reassurance, recovery framing, and one clear next action)",
  },
];

// Values older versions saved. Read as the choice Settings has always shown
// for them; stored data is never rewritten.
const LEGACY = { starting: "initiation", focusing: "momentum", execution: "overplanner", tracking: "overwhelmed" };

// The current value for whatever is stored, or null when nothing was chosen
// (a skipped question, a new account, or something unknown).
export function normalizeChallenge(stored) {
  const value = LEGACY[stored] || stored;
  return CHALLENGES.some(c => c.value === value) ? value : null;
}

// The sentence Ask AI gets, or null: then it gets no challenge line at all
// rather than a guess.
export function challengeDescription(stored) {
  const value = normalizeChallenge(stored);
  return value ? CHALLENGES.find(c => c.value === value).description : null;
}

// Coach's shorter line for the same choice, or null. Coach's full-task turn
// sits right at Groq's free-tier limit (coachPromptBudget.test.js), so it
// gets ~45 characters rather than Ask AI's ~120 (#656 loopcheck).
export function challengeCoachLine(stored) {
  const value = normalizeChallenge(stored);
  return value ? CHALLENGES.find(c => c.value === value).coach : null;
}
