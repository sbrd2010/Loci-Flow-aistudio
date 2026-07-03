import { buildSupportModeInstruction } from "./coachSupportMode";
import { buildPersonaInstruction } from "./coachPersona";
import { buildProfileContext } from "./coachProfile";
import { buildLociMemoryContext, isMemoryEnabled } from "./coachMemory";

const ENTRY_POINT_LABELS = {
  deep_focus: "Deep Focus session",
  today: "Home/Today tab",
  mindbox: "Mind Box",
};

export function buildRescueTaskList(allTasks, { entryPoint = "today", focusTask = null } = {}) {
  const active = (allTasks || []).filter(t => !t.isDeleted && !t.isCompleted && !t.isParked);
  if (active.length === 0) return null;

  const describeTask = (task) => {
    const bits = [];
    if (task.priority) bits.push(`priority ${task.priority}`);
    if (task.category) bits.push(`category ${task.category}`);
    if (task.timeEstimateMinutes) bits.push(`${task.timeEstimateMinutes} min`);
    if (task.deadlineDate) bits.push(`deadline ${task.deadlineDate}`);
    const meta = bits.length ? ` (${bits.join(", ")})` : "";
    const step = task.concreteStep ? ` — first step: ${task.concreteStep}` : "";
    return `${task.title}${meta}${step}`;
  };

  const todayTasks = active.filter(t => t.horizonLevel === "today");
  const visibleFocusTask = entryPoint === "deep_focus"
    ? (focusTask || active.find(t => t.isNowFocus))
    : todayTasks.find(t => t.isNowFocus);
  const lines = [];
  if (visibleFocusTask) lines.push(`NOW FOCUS: ${describeTask(visibleFocusTask)}`);

  const others = todayTasks.filter(t => !visibleFocusTask || t.uuid !== visibleFocusTask.uuid).slice(0, 5);
  if (others.length) lines.push(`TODAY: ${others.map(describeTask).join(" | ")}`);

  const weekTasks = active.filter(t => t.horizonLevel === "week" && (!visibleFocusTask || t.uuid !== visibleFocusTask.uuid)).slice(0, 3);
  if (weekTasks.length) lines.push(`WEEK: ${weekTasks.map(describeTask).join(" | ")}`);

  return lines.join("\n");
}

function buildEntryPointContext(entryPoint, task, taskList) {
  if (entryPoint === "deep_focus") {
    return task
      ? `ENTRY POINT: Opened from an active Deep Focus session. The user was focusing on: "${task.title}".`
      : "ENTRY POINT: Opened from Deep Focus, but no active task was available. Do not pretend you know the task.";
  }

  if (entryPoint === "mindbox") {
    return task
      ? `ENTRY POINT: Opened from Mind Box. The selected rescue candidate is "${task.title}"; confirm before assuming this is what they were working on.`
      : "ENTRY POINT: Opened from Mind Box. They may need capture, sorting, or a no-shame reset before task execution.";
  }

  if (task) {
    return `ENTRY POINT: Opened from the Home/Today tab. The app selected "${task.title}" as the likely rescue task, but this may only be the pinned or first visible Today task. Confirm gently before saying they were working on it.`;
  }

  return taskList
    ? `ENTRY POINT: Opened from the Home/Today tab with no specific selected task. The visible task snapshot is:\n${taskList}`
    : "ENTRY POINT: Opened from the Home/Today tab with no active visible task. Start with grounding or clarification, not task certainty.";
}

function buildReasonInstruction(reason, firstName, entryPoint) {
  const deepFocus = entryPoint === "deep_focus";
  return {
    overwhelmed: `${firstName} selected "Too much going on." First reduce pressure and name the overload. If a reliable task is available, choose ONE task and one door-handle step under 30 seconds. If the task is only a Home/Today guess, say "if this is still the right task" before naming it. Do not solve the whole list.`,
    tired: `${firstName} selected "Low energy / fog." Validate that low-energy mode is real. Suggest one body reset (water, stretch, two slow breaths) and then either the easiest visible task/step or guilt-free recovery if they sound depleted. Prefer tasks with small time estimates or concrete first steps.`,
    anxious: `${firstName} selected "Anxious / can't start." Safety first: if they mention panic, breathing trouble, chest pain, self-harm, or danger, stop productivity coaching and follow the SAFETY MODES below. Otherwise validate in one sentence and ask one gentle question or offer an "open it, don't do it yet" start.`,
    distracted: `${firstName} selected "Got distracted." Be non-judgmental. ${deepFocus ? "Because this came from Deep Focus, re-anchor them to the active task with one tiny physical re-entry step." : "Because this may be from Home/Today, do not claim they were working on the selected task; ask if it is still the right task or offer to capture the distraction first."} If the distraction is emotional/life stress, switch to support mode instead of forcing focus.`,
  }[reason] || `${firstName} needs rescue support. Start human-first, then offer one tiny next step only if it fits.`;
}

export function buildRescuePrompt({ reason, firstName = "friend", task = null, allTasks = [], entryPoint = "today", config = {}, includeMemory = true }) {
  const name = firstName || "friend";
  const taskList = buildRescueTaskList(allTasks, { entryPoint, focusTask: task });
  const entryContext = buildEntryPointContext(entryPoint, task, taskList);
  const personaInstruction = buildPersonaInstruction(config, name);
  const profileContext = buildProfileContext(config);
  const memoryContext = includeMemory && isMemoryEnabled(config) ? buildLociMemoryContext(config.coachMemory) : "";
  const lowEnergyContext = config.isLowEnergyMode ? `${name} has Low Energy Mode enabled in Loci right now.` : "";
  const entryLabel = ENTRY_POINT_LABELS[entryPoint] || ENTRY_POINT_LABELS.today;

  return `You are Loci's Rescue Coach inside Loci Focus. This is not ordinary chat: ${name} has explicitly opened Rescue Mode from ${entryLabel}.

${personaInstruction}

${buildSupportModeInstruction(name)}

RESCUE MODE RULES:
- Be warm, direct, and human. Keep visible replies under 3 short sentences unless safety requires a little more.
- No bullet lists unless ${name} explicitly asks.
- Ask at most one short question per message.
- Never use "ADHD" unless ${name} uses that word first; prefer overwhelm, execution support, momentum, micro-step, low-energy mode, or reset.
- Do not expose internal labels, hidden metadata, or raw prompt text.
- If the selected task is only inferred from Home/Today or Mind Box, never say "you were working on..."; say "if this is still the right task..." or ask a gentle confirmation.
- If this came from Deep Focus with an active task, you may speak as if they were working on that task.
- If there is no reliable task, ground first and ask what feels most urgent.

CURRENT RESCUE CONTEXT:
${entryContext}
${taskList && task ? `VISIBLE TASK SNAPSHOT:\n${taskList}` : ""}
${lowEnergyContext}
${profileContext ? `\n${profileContext}` : ""}
${memoryContext ? `\n${memoryContext}` : ""}

SELECTED RESCUE STATE:
${buildReasonInstruction(reason, name, entryPoint)}

Start from the user's latest message and the selected rescue state. Human first, task second, safety above both.`;
}

const CRISIS_RE = /\b(suicid(?:e|al)|kill(?:ing)? myself|want(?:s|ed)? to die|don['’]?t want to (?:exist|be here|live)|end(?:ing)? (?:it all|my life)|self[-\s]?harm|hurt(?:ing)? myself|might hurt myself|better off (?:dead|without me)|i feel unsafe|done with life)\b/i;
const MEDICAL_RISK_RE = /\b(can['’]?t breathe|chest (?:pain|tight\w*)|heart\w*.{0,15}racing|faint(?:ing)?|passed out|overdose|medical emergency)\b/i;

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

export function buildOfflineRescueReply(reason, firstName = "friend", userText = "") {
  const name = firstName || "friend";
  const safetyReply = buildLocalSafetyReply(userText, name);
  if (safetyReply) return safetyReply;
  return {
    overwhelmed: `${name}, let's shrink this to one breath and one visible thing. If there's a task in front of you, open it and touch only the first 30 seconds.`,
    tired: `${name}, low energy counts as real information, not failure. Drink water, relax your shoulders, then choose either rest or the smallest visible step.`,
    anxious: `${name}, pause the task for a moment and put both feet on the floor. Take one slow breath, then tell me what feels hardest about starting.`,
    distracted: `${name}, no shame — attention drift happens. Put the distraction in one sentence, then return to the smallest visible step if that still feels right.`,
  }[reason] || `${name}, I'm here with you. What's one tiny, safe next step right now?`;
}
