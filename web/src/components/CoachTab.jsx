import React, { useState, useEffect, useRef } from "react";
import { track } from "../firebase";
import { callAI, getAIKeys } from "../utils/aiCall";
import ConfirmDialog from "./ConfirmDialog";
import { profileToCoachContext } from "../utils/userProfile";
import { buildLociCoreInstruction, buildLociTaskContext, buildLociAnchorsContext, buildLociCheckinContext, buildLociFocusSessionContext, buildLociNowFocusContext, buildLociDeadlineContext, buildLociDayMapContext, buildLociBrainDumpContext, buildLociVelocityContext, buildLociRemindersContext, buildLociLowEnergyContext, buildLociRecentlyParkedContext, getLocalDateString, isActiveLociTask } from "../utils/lociAIContext";
import { getTodayCheckedIds, getLociDayStr } from "../utils/dailyAnchors";
import { getFocusWindows } from "../utils/focusWindows";
import { requestNotifPermission } from "../utils/focusNotifications";
import { scheduleCoachCheckin, cancelCoachCheckin } from "../utils/reminders";
import { parseCheckinTag, pickCheckinNote, buildCoachCheckin, isCheckinDue, buildCheckinResumeMessage } from "../utils/coachCheckin";
import { parseCoachActionTags, applyCoachActions, buildActionReplyText } from "../utils/coachActions";
import { isPendingCoachNudgeStale, shouldDeliverPendingCoachNudge } from "../utils/coachNudge";
import { buildPersonaInstruction } from "../utils/coachPersona";
import { addPinnedFact, addRecentObservation, buildLociMemoryContext, forgetFromMemory, isMemoryEnabled, parseMemoryTags } from "../utils/coachMemory";

export default function CoachTab({ payload, savePayload, saveSubPath, saveSubPaths, saveConfigPatch, userProfile, focusTimer = {}, isSyncingFromCache = false, syncWarning = null }) {
  const { tasks = [], config = {}, brainDump = [], contributions = [] } = payload;
  const { groqKey, geminiKey } = getAIKeys();
  const hasAnyKey = !!(groqKey || geminiKey);

  // True until RTDB has actually delivered a snapshot for this session — true
  // while rendering from cache, but ALSO once the 15s offline warning fires
  // (useSync clears isSyncingFromCache then even with no RTDB response yet, so
  // config.coachMemory may still be stale localStorage data at that point).
  const cloudSyncUnconfirmed = isSyncingFromCache || syncWarning === "offline";

  const [confirmDialog, setConfirmDialog] = useState(null);

  // -- AI Mentor Chat --------------------------------------------------------
  const challengeLabel =
    config.challengeType === "overplanner"  ? "Turning Plans into Action" :
    config.challengeType === "overwhelmed"  ? "Recovery and Backlog Relief" :
    config.challengeType === "initiation"   ? "Breaking Initiation Freeze" :
    config.challengeType === "momentum"     ? "Building Momentum with Quick Wins" :
    config.challengeType === "starting"     ? "Overcoming Inertia" :
    config.challengeType === "focusing"     ? "Protecting Focus Sessions" :
    config.challengeType === "tracking"     ? "Time Awareness" :
    "Action over Perfectionism";

  const firstName = (config.userName || "").split(" ")[0] || "friend";
  const defaultWelcome = [{
    text: `Hey ${firstName}! I'm ${config.mentorName || "your AI coach"} — good to have you here. Before I dive into your tasks, tell me: what's going on for you today? Are you trying to get started, feeling stuck, or just need to think something through?`,
    isUser: false
  }];

  const chatHistory = (payload.chatHistory && payload.chatHistory.length > 0)
    ? payload.chatHistory
    : defaultWelcome;

  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);
  const chatInputRef = useRef(null);
  const prevHistoryLenRef = useRef(chatHistory.length);
  const prevChatLoadingRef = useRef(chatLoading);

  useEffect(() => {
    // Only scroll when a new message is added — not on tab switch / initial mount
    if (chatHistory.length > prevHistoryLenRef.current || chatLoading) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevHistoryLenRef.current = chatHistory.length;
  }, [chatHistory, chatLoading]);

  useEffect(() => {
    // Restore focus to the chat input once the AI reply finishes, so the
    // user can keep typing without re-clicking the textarea.
    if (prevChatLoadingRef.current && !chatLoading) {
      chatInputRef.current?.focus();
    }
    prevChatLoadingRef.current = chatLoading;
  }, [chatLoading]);

  // Resume a "Coach Check-In" the user asked for earlier — on mount (came
  // back to this tab) and every minute while it stays open (sitting here
  // when the time arrives).
  const chatHistoryRef = useRef(chatHistory);
  chatHistoryRef.current = chatHistory;
  const configRef = useRef(config);
  configRef.current = config;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const contributionsRef = useRef(contributions);
  contributionsRef.current = contributions;
  // Live (non-stale) read of cloudSyncUnconfirmed for the mount-time effects
  // below — their saveConfigPatch calls run inside a closure (the checkDue
  // interval) or a one-time []-deps effect, neither of which re-captures
  // cloudSyncUnconfirmed as it changes after mount.
  const cloudSyncUnconfirmedRef = useRef(cloudSyncUnconfirmed);
  cloudSyncUnconfirmedRef.current = cloudSyncUnconfirmed;

  // Coach tab unmounts on tab switch (see App.jsx), so an in-flight AI reply
  // can resolve after the user has navigated to Settings and changed
  // coachMemory/coachMemoryEnabled there. configRef would then be frozen on a
  // stale config — guard writing NEW memory entries with this so a late
  // reply doesn't add memory based on a stale opt-out/config snapshot. A
  // [[FORGET: ...]] is exempt from this guard: the user explicitly asked to
  // delete something, and applying it late (even against a slightly stale
  // memory snapshot) is strictly better than silently dropping it and
  // re-injecting the "forgotten" entry into every future prompt. (The final
  // config save below stays unconditional so other patches, like a coach
  // check-in, are never lost.)
  const isMountedRef = useRef(true);
  useEffect(() => {
    // Reset on setup, not just cleanup — under StrictMode's dev-only
    // mount/cleanup/remount cycle, the cleanup below runs once before this
    // effect re-fires, which would otherwise leave isMountedRef permanently
    // false even though the component is still mounted.
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    const checkDue = () => {
      const checkin = configRef.current.coachCheckin;
      if (!isCheckinDue(checkin)) return;
      // Defer until cloud sync is confirmed — saveConfigPatch() before the
      // first RTDB snapshot stamps a still-cached config as "newest" (see
      // saveConfigPatch in useSync.js), which could overwrite newer config
      // synced from another device. Retried every 60s via the interval below
      // (and on remount), so this just delays delivery until sync confirms.
      if (cloudSyncUnconfirmedRef.current) return;
      const resumeMsg = buildCheckinResumeMessage(firstName, checkin.note);
      saveSubPath("chatHistory", [...chatHistoryRef.current, { text: resumeMsg, isUser: false }]);
      saveConfigPatch({ coachCheckin: null });
      cancelCoachCheckin();
    };
    checkDue();
    const interval = setInterval(checkDue, 60000);
    return () => clearInterval(interval);
  }, [config.coachCheckin?.fireAt, firstName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deliver a Proactive Coach Nudge (see utils/coachNudge.js) handed off from
  // the Today tab — voiced by the AI when a key is available, falling back to
  // the signal's own canned text otherwise. Runs on mount, and again once
  // cloudSyncUnconfirmed flips to false (see the deferral below) so a nudge
  // deferred during the cache-sync window is delivered as soon as sync
  // confirms, instead of waiting for the next Coach remount.
  const deliveredNudgeRef = useRef(null);
  useEffect(() => {
    // Defer to the Coach Check-In resume effect above if it's also acting on
    // this mount — both write a fresh `config`/`chatHistory` snapshot from
    // the same pre-effect refs, so running both here would let one clobber
    // the other. The nudge stays pending and is picked up on a later mount.
    if (isCheckinDue(configRef.current.coachCheckin)) return;

    const nudge = configRef.current.pendingCoachNudge;
    if (!shouldDeliverPendingCoachNudge(nudge, deliveredNudgeRef.current)) return;
    // Defer until cloud sync is confirmed — saveConfigPatch() before the
    // first RTDB snapshot stamps a still-cached config as "newest" (see
    // saveConfigPatch in useSync.js), which could overwrite newer config
    // synced from another device. cloudSyncUnconfirmed is in this effect's
    // deps, so once sync confirms this re-runs and delivers the still-pending
    // nudge — it isn't dropped until the next mount.
    if (cloudSyncUnconfirmedRef.current) return;
    deliveredNudgeRef.current = nudge;
    saveConfigPatch({ pendingCoachNudge: null });
    if (isPendingCoachNudgeStale(nudge, payload)) return;

    const deliver = (text, voiced) => {
      saveSubPath("chatHistory", [...chatHistoryRef.current, { text, isUser: false }]);
      track("coach_nudge_delivered", { reason: nudge.reason, voiced });
    };

    if (!hasAnyKey) {
      deliver(nudge.body, false);
      return;
    }

    (async () => {
      try {
        // Read config/cloudSyncUnconfirmed via their refs (not the mount-time
        // closure values) — this async IIFE can resolve well after mount, by
        // which point Coach Memory may have been toggled off or cloud sync
        // confirmed/lost on another device.
        const memoryContext = (isMemoryEnabled(configRef.current) && !cloudSyncUnconfirmedRef.current) ? buildLociMemoryContext(configRef.current.coachMemory) : "";
        const systemInstruction = `${buildLociCoreInstruction({ firstName })}

You are ${configRef.current.mentorName || "Loci AI Coach"}, ${firstName}'s productivity mentor inside Loci Focus. You are reaching out FIRST — ${firstName} hasn't said anything yet this conversation. Something you noticed about their day: "${nudge.title} — ${nudge.body}". Open the conversation with this observation and a concrete next step. Max 2 short sentences. Don't mention that this is automated or that you "noticed" via data — just speak as their coach.

${buildPersonaInstruction(configRef.current, firstName)}
${memoryContext ? `\n${memoryContext}\n` : ""}`;

        const reply = await callAI({
          groqKey, geminiKey,
          systemPrompt: systemInstruction,
          messages: [{ role: "user", content: "(Start the conversation.)" }],
          maxTokens: 120
        });
        deliver(reply.trim(), true);
      } catch (_) {
        deliver(nudge.body, false);
      }
    })();
  }, [cloudSyncUnconfirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !hasAnyKey || chatLoading) return;

    const userText = chatInput.trim();
    setChatInput("");

    const MAX_HISTORY = 20;
    const trimmed = chatHistory.length >= MAX_HISTORY
      ? chatHistory.slice(chatHistory.length - MAX_HISTORY + 1)
      : chatHistory;

    const withUser = [...trimmed, { text: userText, isUser: true }];
    saveSubPath("chatHistory", withUser);
    setChatLoading(true);

    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const nowLabel = now.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const todayActive = tasks.filter(t => t.horizonLevel === "today" && isActiveLociTask(t));
    const taskContext = buildLociTaskContext(tasks, new Date(), getFocusWindows(config));
    const todayStr = getLociDayStr(new Date(), getFocusWindows(config));
    const anchorContext = buildLociAnchorsContext(
      config.dailyAnchors || [],
      getTodayCheckedIds(config, todayStr)
    );
    const checkinContext = buildLociCheckinContext(config, tasks, todayStr);
    const focusSessionContext = buildLociFocusSessionContext(focusTimer);
    const nowFocusContext = buildLociNowFocusContext(tasks);
    const deadlineContext = buildLociDeadlineContext(config, now);
    const dayMapContext = buildLociDayMapContext(tasks, getLocalDateString(now));
    const brainDumpContext = buildLociBrainDumpContext(brainDump);
    const velocityContext = buildLociVelocityContext(contributions, now);
    const remindersContext = buildLociRemindersContext(tasks, now);
    const lowEnergyContext = buildLociLowEnergyContext(config);
    const recentlyParkedContext = buildLociRecentlyParkedContext(tasks, now);
    const lociCoreInstruction = buildLociCoreInstruction({ firstName });
    const memoryEnabled = isMemoryEnabled(config);
    // Don't send memory facts/notes to the AI — or the MEMORY instructions
    // that reference them (including REMEMBER/NOTE/FORGET tags and "say
    // clearly if there's nothing stored yet") — until cloud sync is
    // confirmed. config.coachMemory may be stale localStorage data that's
    // already been cleared or disabled on another device, and without this
    // the AI could falsely tell the user nothing is stored (memoryContext
    // empty) while still being instructed to behave as if memory is live.
    const memorySectionEnabled = memoryEnabled && !cloudSyncUnconfirmed;
    const memoryContext = memorySectionEnabled ? buildLociMemoryContext(config.coachMemory) : "";
    const personaInstruction = buildPersonaInstruction(config, firstName);

    const userMessageCount = withUser.filter(m => m.isUser).length;
    const isEarlyConversation = userMessageCount <= 1;

    const systemInstruction = `${lociCoreInstruction}

You are ${config.mentorName || "Loci AI Coach"}, an expert productivity mentor and motivating friend inside Loci Focus — an app that helps people cut through overwhelm and actually start working.

YOUR CLIENT: ${config.userName || "a user"} — call them "${firstName}". Core challenge: "${challengeLabel}".
${memoryContext ? `\n${memoryContext}\n` : ""}
WHO THEY MIGHT BE:
${firstName} could be a student, graduate researcher, early-career professional, founder, creative, office worker, retiree, or anyone looking to be more productive. Adapt your tone based on cues:
- Student / younger user: energetic, encouraging, relatable examples, celebrate every small win with enthusiasm.
- Professional / founder / researcher: match their register, respect their expertise, be direct and tactical.
- Elderly / retired user: warm, patient, deeply respectful, clear and jargon-free language, never rush.
- Child or young teen: playful, kind, very safe and encouraging, keep it simple and fun.
- Anyone in distress: listen first, solve second. One empathetic question at a time.

THEIR FULL TASK LIST (you can see ALL of this — reference specific task names in your replies):
${taskContext}
${focusSessionContext ? `\n${focusSessionContext}\n` : ""}${nowFocusContext ? `\n${nowFocusContext}\n` : ""}${dayMapContext ? `\n${dayMapContext}\n` : ""}${remindersContext ? `\n${remindersContext}\n` : ""}${anchorContext ? `\n${anchorContext}\n` : ""}${checkinContext ? `\n${checkinContext}\n` : ""}${deadlineContext ? `\n${deadlineContext}\n` : ""}${brainDumpContext ? `\n${brainDumpContext}\n` : ""}${velocityContext ? `\n${velocityContext}\n` : ""}${lowEnergyContext ? `\n${lowEnergyContext}\n` : ""}${recentlyParkedContext ? `\n${recentlyParkedContext}\n` : ""}
LOCI'S PHILOSOPHY — you embody this:
Loci is built to bias people toward DOING, not just planning. Your role is to reduce friction and close the gap between intention and action.
- Planning Paradox: If ${firstName} is reorganizing or adding tasks but not starting any, gently redirect — "You've got a solid plan. What's the ONE thing to actually start right now?"
- Backlog Shame: Never shame or criticize a big backlog. Normalize it — "Backlogs grow when your ambitions are real. Let's just pick one thing for today."
- Activation Gap: Always end with a concrete first step — not just advice. Turn "I should…" into "Open [task] and do this one thing in the next 2 minutes."
- Translation Gap: Help them convert vague stress ("I'm overwhelmed, there's so much") into one specific next action. Name the task. Name the step.
- Avoid Planning Black Hole: Never suggest more organizing, more setup, or more lists as the answer. The answer is always a micro-start.

YOUR EXPERTISE COVERS:
- Focus coaching: initiation, protecting attention, time awareness, task completion
- Cognitive load: reducing overwhelm, chunking work, managing mental energy
- Momentum: door-handle moves, micro-commitments, 2-minute starts, quick wins
- Recovery: backlog shame, bad days, restarting without guilt, "minimum viable day"
- Context-aware guidance: you see their real tasks — be specific, not generic

${personaInstruction}

${isEarlyConversation
  ? `CONTEXT FIRST: This is the start of the conversation. Ask ONE good question to understand ${firstName}'s current situation before giving recommendations. "What's happening for you today?" or "What's on your mind right now?" is better than jumping straight to task advice. Understand first, guide second.`
  : `COACHING STYLE:
- Max 3 short sentences per reply. Zero filler phrases ("Great!", "Absolutely!", "Of course!").
- Address as "${firstName}". Be warm, specific, and action-oriented.
- For overwhelm: name ONE specific task from their list + its 30-second starter.
- For initiation blocks: use the [NOW FOCUS] task if present, else top P1 or P2.
- For distraction: re-anchor — "You were working on [task name], open it and read the first line."
- NEVER say you cannot see their tasks — you CAN see the full list above.
- If asked "what should I do?" or "what are my tasks?": answer directly from the list above.`}

GUARD RAILS:
- Off-topic (illegal, harmful, explicit, not related to productivity/wellbeing): "That's outside my scope, ${firstName}. What's one thing blocking you right now?" Do not elaborate.
- Genuine distress or crisis: "I hear you. Please reach out to someone you trust or a professional if this feels urgent. What's the one smallest thing that might help right now?"
- Stay within: productivity, tasks, focus, execution support, time management, motivation, gentle life-management support.

COACH ACTIONS:
- If ${firstName} asks you to check in, follow up, or remind them again later in this chat, end your reply with [[CHECKIN_IN:N]] on its own line, where N is a whole number of minutes from now (1-180). This tag is invisible to ${firstName} — never mention it or explain it.
- Only use this tag when explicitly asked for a later check-in. Do not offer it proactively, and never use it for any other purpose.
- If ${firstName} explicitly asks to switch focus to or prioritize a specific task right now, end your reply with [[SET_NOW_FOCUS:<exact task title from the list above>]] on its own line — AND say what you're doing in your visible reply (e.g., "On it — switching your focus to '<title>'.").
- If ${firstName} explicitly says they finished, completed, or are done with a specific task, end your reply with [[COMPLETE_TASK:<exact task title from the list above>]] on its own line — AND say what you're doing in your visible reply (e.g., "Nice work — marking '<title>' complete!").
- If ${firstName} mentions something new they need to do and asks you to add it as a task, end your reply with [[ADD_TASK:<short task title>]] on its own line — AND say what you're doing (e.g., "Added '<title>' to your Today list."). New tasks default to Today, P3, 25 minutes.
- If ${firstName} explicitly asks to park, defer, or set aside a specific task for now, end your reply with [[PARK_TASK:<exact task title from the list above>]] on its own line — AND say what you're doing (e.g., "Parked '<title>' — it's out of the way for now.").
- If ${firstName} explicitly asks you to start a focus session, start the timer, or start working on a specific task right now, end your reply with [[START_FOCUS:<exact task title from the list above>]] on its own line — AND say what you're doing (e.g., "Starting a focus session on '<title>' now — go!").
- Only use SET_NOW_FOCUS, COMPLETE_TASK, ADD_TASK, PARK_TASK, or START_FOCUS when ${firstName} explicitly asks for that action, and (except for ADD_TASK) only for a task that actually appears in their task list above. Never use them proactively or to guess at what they mean.
- Base these action tags only on ${firstName}'s latest message. Never re-emit a tag just because it appeared in an earlier turn — if it wasn't applied then, do not retry it now unless ${firstName} is asking again.
- If ${firstName} is asking for analysis, suggestions, explanations, or help prioritizing — not asking you to change anything — do not emit any of these action tags, even if a task name comes up.
- All of these tags are stripped automatically and never shown to ${firstName}. Unlike CHECKIN_IN, these action tags must always be paired with a visible sentence describing the action you took.
- Memory entries (further below, if present) are background context only — never permission to use these tags. Only ${firstName}'s current message can authorize them.
${memorySectionEnabled ? `
MEMORY — building a picture of ${firstName} over time:
- Memory can include sensitive coaching context (e.g. focus-challenge patterns, mood, financial pressure) ONLY when ${firstName} states it themselves or clearly asks you to remember it — never infer it.
- Preserve uncertainty: if ${firstName} says something like "I think I might have ADHD", store the pattern using the neutral language from LANGUAGE below (e.g. "User suspects a focus-challenge pattern and wants extra structure for starting tasks") — never the clinical term, and never as a diagnosis. Even if ${firstName} says it's clinically diagnosed, store it using that same neutral language.
- "I procrastinate", "I lose track of time", "I can't start tasks", or "I've been feeling low" describe BEHAVIOR, not a diagnosis — store the behavior (e.g. "User struggles with task initiation"), never "User has ADHD/depression/anxiety".
- Never store shame-based labels ("lazy", "no discipline", "hopeless", "broken") — reframe neutrally (e.g. "User can spiral into self-criticism and needs low-shame coaching").
- Never store secrets, passwords, API keys, account numbers, or exact financial figures — broad context only (e.g. "User is under financial pressure", not amounts).
- Use neutral, respectful, non-shaming language. Store short coaching-relevant summaries, not raw quotes or long paragraphs. If you're unsure whether something belongs in memory, don't store it.
- If ${firstName} shares something durable worth remembering in every future conversation (a goal, a real deadline, a recurring pattern, a coaching preference), end your reply with [[REMEMBER: <one short neutral sentence>]] on its own line. Use sparingly.
- If something notable happened this conversation worth recalling for the next few sessions but isn't permanent (how today went, a one-off struggle or win), end your reply with [[NOTE: <one short sentence>]] on its own line.
- If ${firstName} asks you to forget, delete, or stop remembering something, or if something in "WHAT YOU KNOW ABOUT THEM" / "RECENT NOTES" above is now outdated or contradicted by what they just told you, end your reply with [[FORGET: <copy the exact text of that fact/note from memory above>]] on its own line — and if it's outdated rather than just wrong, also add a [[REMEMBER: <corrected fact>]] for the update.
- REMEMBER, NOTE, and FORGET tags are invisible and stripped automatically, like CHECKIN_IN — never mention or explain them to ${firstName}.
- If ${firstName} asks what you know or remember about them, answer honestly and specifically using "WHAT YOU KNOW ABOUT THEM" and "RECENT NOTES" above — list it out plainly rather than being vague, and say clearly if there's nothing stored yet.
- Memory is for coaching adaptation only — never medical, legal, or financial advice.
` : ""}
LANGUAGE: Never use the word "ADHD". Use instead: focus challenge, overwhelm, execution support, momentum, time awareness, micro-step, reset, low-energy mode.
${profileToCoachContext(userProfile) ? `\n${profileToCoachContext(userProfile)}\n` : ""}
SESSION: ${nowLabel} (${timeOfDay}), ${config.visitStreakCount || 0}-day streak, ${todayActive.length} active tasks today.`;

    const messages = withUser.map(m => ({ role: m.isUser ? "user" : "assistant", content: m.text }));

    try {
      const reply = await callAI({ groqKey, geminiKey, systemPrompt: systemInstruction, messages, maxTokens: 300 });
      // Memory tags are parsed first so that if one ever contains a nested
      // tag-like sequence (e.g. "[[REMEMBER: ...describing [[ADD_TASK:X]]...]]"),
      // the whole memory tag — including the nested text — is stripped before
      // the checkin/action parsers can see it as a tag of their own.
      const { cleanText: afterMemory, pinnedFacts, observations, forgets } = parseMemoryTags(reply.trim());
      const { cleanText: afterCheckin, minutes } = parseCheckinTag(afterMemory);
      const { cleanText, actions } = parseCoachActionTags(afterCheckin);

      let configPatch = null;
      if (minutes != null) {
        const checkin = buildCoachCheckin(minutes, pickCheckinNote(todayActive));
        configPatch = { ...configPatch, coachCheckin: checkin };
        scheduleCoachCheckin(checkin);
        requestNotifPermission();
      }

      const memoryWriteAllowed = isMemoryEnabled(configRef.current) && !cloudSyncUnconfirmed;
      const willForget = memoryWriteAllowed && forgets.length > 0;
      // A REMEMBER/NOTE alongside a FORGET in the same reply is usually a
      // correction — "forget the old fact, remember this instead" (see the
      // FORGET instruction above). If willForget is already exempt from
      // isMountedRef (a late reply after unmount still applies it), dropping
      // its paired REMEMBER/NOTE here would delete the old fact and never
      // save its replacement — a net loss, worse than skipping both.
      const willAddMemory = memoryWriteAllowed && (pinnedFacts.length > 0 || observations.length > 0) && (isMountedRef.current || willForget);
      let memoryPatch = null;
      if (willForget || willAddMemory) {
        // Computed against the latest config at save time (via saveConfigPatch's
        // function form below), not this possibly-stale configRef.current.coachMemory
        // — so a Settings-tab edit made while this reply was in flight isn't
        // reverted by this whole-coachMemory write.
        memoryPatch = (latestConfig) => {
          let memory = latestConfig.coachMemory || {};
          if (willForget) forgets.forEach(text => { memory = forgetFromMemory(memory, text); });
          // Re-check Coach Memory's enabled flag against the latest config —
          // willAddMemory may have been computed pre-unmount (paired with a
          // willForget exemption), so the user could have turned memory off
          // in Settings before this reply resolves. The forget above is still
          // applied (it's a deletion the user already asked for), but a new
          // addition shouldn't be written after an explicit opt-out.
          if (willAddMemory && isMemoryEnabled(latestConfig)) {
            pinnedFacts.forEach(fact => { memory = addPinnedFact(memory, fact); });
            observations.forEach(note => { memory = addRecentObservation(memory, note, todayStr); });
          }
          return memory;
        };
      }

      let replyText = cleanText;
      if (actions.length > 0 && isSyncingFromCache) {
        // The model's narration above (e.g. "Added 'X' to your list") describes an
        // action that was NOT applied below — replace it entirely so the user
        // doesn't believe the mutation succeeded.
        replyText = "Hold on — still syncing your latest data. Mind asking that again in a moment?";
      } else if (actions.length > 0) {
        const { payload: updatedPayload, results } = applyCoachActions(
          { ...payload, tasks: tasksRef.current, config: configRef.current, contributions: contributionsRef.current },
          actions,
          { lociDateStr: todayStr, localDateStr: getLocalDateString(now), lastUserMessage: userText, now: now.getTime() }
        );

        const patch = {};
        if (updatedPayload.tasks !== tasksRef.current) patch.tasks = updatedPayload.tasks;
        if (updatedPayload.contributions !== contributionsRef.current) patch.contributions = updatedPayload.contributions;
        if (Object.keys(patch).length > 0) saveSubPaths(patch);

        // Apply the XP change as a DELTA onto the latest known totalXp (via
        // saveConfigPatch's function form) rather than writing the absolute
        // value computed against configRef.current — a concurrent XP change
        // from another device wouldn't be reflected in configRef.current, and
        // writing that stale absolute value would silently overwrite the
        // other device's gain. When XP changed, fold configPatch/memoryPatch
        // into this same saveConfigPatch call so all of them land as one set
        // of nested config/<key> writes — saveSubPaths above never touches
        // "config", so the two calls can't clobber each other regardless of
        // network ordering.
        const xpDelta = (Number(updatedPayload.config.totalXp) || 0) - (Number(configRef.current.totalXp) || 0);
        if (xpDelta !== 0) {
          // saveConfigPatch's updater runs asynchronously (on the next render),
          // after this synchronous block finishes — so it must close over
          // copies of configPatch/memoryPatch, not the `let` bindings below,
          // which are reset to null immediately after this call.
          const xpConfigPatch = configPatch;
          const xpMemoryPatch = memoryPatch;
          saveConfigPatch((latestConfig) => ({
            ...xpConfigPatch,
            totalXp: (Number(latestConfig.totalXp) || 0) + xpDelta,
            ...(xpMemoryPatch ? { coachMemory: xpMemoryPatch(latestConfig) } : {}),
          }));
          configPatch = null;
          memoryPatch = null;
        }

        const startFocus = results.find(r => r.type === "START_FOCUS" && r.matched);
        if (startFocus && typeof focusTimer.extendTimer === "function") {
          const isSwitchingTask = focusTimer.activeTask?.uuid !== startFocus.task.uuid;
          if (!focusTimer.isTimerRunning || isSwitchingTask) {
            const mins = Number(startFocus.task.timeEstimateMinutes) > 0 ? Number(startFocus.task.timeEstimateMinutes) : 25;
            focusTimer.extendTimer(mins);
          }
        }

        // Assembles success/failure narration from the action results — see
        // buildActionReplyText for how blocked-but-stale tags are silently
        // dropped vs. surfaced as a clarifying question.
        replyText = buildActionReplyText(cleanText, results, userText);
      }

      if (configPatch || memoryPatch) {
        // saveConfigPatch merges onto the latest known config and writes only
        // these keys — safe even if this tab unmounted and configRef.current
        // is now stale (e.g. the user changed Coach Memory settings elsewhere
        // while this reply was in flight). memoryPatch is itself resolved
        // against the latest config (see above).
        saveConfigPatch(memoryPatch
          ? (latestConfig) => ({ ...configPatch, coachMemory: memoryPatch(latestConfig) })
          : configPatch);
      }

      saveSubPath("chatHistory", [...chatHistoryRef.current, { text: replyText || "Got it.", isUser: false }]);
    } catch (err) {
      const hint = err.message === "429" ? "Rate limit — wait 30 sec and retry." : err.message === "503" ? "AI server busy — try again." : err.message === "no_key" ? "Add an AI key in Settings." : `AI error ${err.message}`;
      saveSubPath("chatHistory", [...chatHistoryRef.current, { text: hint, isUser: false }]);
    } finally {
      setChatLoading(false);
    }
  };

  // -- Focus Briefing (AI task analysis across all horizons) -----------------
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingResult, setBriefingResult] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);

  const handleFocusBriefing = async () => {
    if (!hasAnyKey) return;
    const backlog = tasks.filter(isActiveLociTask);
    if (backlog.length === 0) {
      setBriefingResult(`No tasks yet, ${firstName}. Tap + on the Home tab to add your first task, or use the Plan tab to map goals across horizons — then come back for your Focus Briefing.`);
      return;
    }

    setBriefingLoading(true);
    setBriefingResult("");

    const challengeDesc =
      config.challengeType === "overplanner"  ? "Overplanner — over-researches and plans but rarely starts; needs forced simplicity and execution bias" :
      config.challengeType === "overwhelmed"  ? "Overwhelmed professional — backlog shame, fear of missing commitments; needs recovery, reassurance, reduced alert fatigue" :
      config.challengeType === "initiation"   ? "Initiation block — knows what to do but freezes before starting; needs scaffolding, visual cues, micro-starts" :
      config.challengeType === "momentum"     ? "Momentum seeker — high activation energy needed; needs quick wins and visible forward movement" :
      config.challengeType === "starting"     ? "Overcoming inertia (struggles to start tasks)" :
      config.challengeType === "focusing"     ? "Protecting focus sessions (gets distracted mid-task)" :
      config.challengeType === "tracking"     ? "Time awareness (loses track of time, misses deadlines)" :
      "Action over perfectionism (overthinks and delays finishing)";

    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const energyNote = hour < 12 ? "peak cognitive energy — ideal for deep/complex work" : hour < 15 ? "post-lunch dip — prefer shorter, concrete tasks" : hour < 18 ? "second wind — good for creative or social tasks" : "low energy — protect recovery, do only simple tasks";

    const todayTasks = backlog.filter(t => t.horizonLevel === "today");
    const weekTasks = backlog.filter(t => t.horizonLevel === "week");
    const totalTodayMins = todayTasks.reduce((sum, t) => sum + (Number(t.timeEstimateMinutes) || 25), 0);
    const totalTodayHours = (totalTodayMins / 60).toFixed(1);
    const p1Count = backlog.filter(t => t.priority === "P1").length;
    const p1Ratio = p1Count / backlog.length;
    const briefingAnchorContext = buildLociAnchorsContext(
      config.dailyAnchors || [],
      getTodayCheckedIds(config, getLociDayStr(new Date(), getFocusWindows(config)))
    );
    const prompt = `You are ${config.mentorName || "Loci AI Coach"}, an expert productivity mentor inside Loci Focus — an app built to help people close the gap between intention and action.

USER: ${config.userName || "friend"} | Challenge: ${challengeDesc}
Time: ${timeOfDay} (${hour}:00) — ${energyNote}
Streak: ${config.visitStreakCount || 0} days
${profileToCoachContext(userProfile) ? profileToCoachContext(userProfile) + "\n" : ""}Today: ${todayTasks.length} tasks (${totalTodayHours}h estimated) | Week backlog: ${weekTasks.length} | Total active: ${backlog.length}
Priority distribution: ${p1Count} P1 of ${backlog.length} total (${Math.round(p1Ratio * 100)}% P1)

LOCI PHILOSOPHY: The app biases toward doing, not planning. Your briefing must close the activation gap — turn intentions into a specific first step. Never suggest "organize more" or "plan better." Suggest starting.

FULL TASK LIST (key: [priority] [horizon] title | est minutes):
${backlog.map(t => `[${t.priority}] [${t.horizonLevel}] ${t.title} | ${t.timeEstimateMinutes || 25}min | ${t.category || "–"}`).join("\n")}
${briefingAnchorContext ? `\n${briefingAnchorContext}\n` : ""}
PRODUCE A FOCUS BRIEFING with these sections:

**📊 Load Check**
- Is today overloaded? (flag if >6h estimated or >8 tasks today)
- Any horizon packed? (flag if week>10 tasks or month>15 tasks with no quarter plan)
- If overload: name 1-2 specific tasks to park or defer — use normalising language, no shame

**🎯 Top 3 Right Now**
For each task: bold the name, one sentence WHY (energy match + urgency + momentum), then "Start: [10-word door-handle action]"
Pick based on: current energy level, momentum-first sequencing, urgency, and cascade value (doing X unblocks Y)

**⏰ Time Awareness Check** (only if issues found)
- Flag tasks that seem severely underestimated
- Flag tasks placed in the wrong horizon (e.g., a P1 urgent item sitting in Quarter)
- Give 1-2 specific move suggestions

**🔥 Priority Note** (only if >35% of tasks are P1)
- Flag priority inflation briefly. One sentence max.

**One sentence of encouragement** — specific, warm, reference their streak or recent progress if visible. Never generic.

RULES: Bold task names. Direct and concise. No filler. Punchy and actionable beats thorough but vague. Never shame a big backlog — treat it as ambition, not failure. Never use the word "ADHD" — use: overwhelm, execution support, momentum, micro-step, time awareness, reset.`;

    try {
      const reply = await callAI({
        groqKey, geminiKey,
        systemPrompt: `${buildLociCoreInstruction({ firstName })}\n\nYou are ${config.mentorName || "a focus coach"}, an expert productivity coach.`,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 800
      });
      setBriefingResult(reply);
    } catch (err) {
      setBriefingResult(`Focus Briefing failed: ${err.message}`);
    } finally {
      setBriefingLoading(false);
    }
  };

  // -- Render ----------------------------------------------------------------
  const parkedTasks = tasks.filter(t => t.isParked && !t.isDeleted && !t.isCompleted);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {/* 1 -- AI Mentor Chat */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
              🤖 Chat with {config.mentorName || "your Mentor"}
            </h2>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
              Your AI coach — ask about tasks, focus, overwhelm, or momentum.
            </p>
          </div>
          {payload.chatHistory && payload.chatHistory.length > 0 && (
            <button
              onClick={() => setConfirmDialog({ message: "Clear all chat history?", confirmLabel: "Clear", danger: true, onConfirm: () => { saveSubPath("chatHistory", null); setConfirmDialog(null); }, onCancel: () => setConfirmDialog(null) })}
              style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "11px", fontWeight: "700", cursor: "pointer", padding: "4px 8px", flexShrink: 0 }}
            >
              Clear
            </button>
          )}
        </div>

        <div className="chat-window">
          {chatHistory.map((m, idx) => (
            <div key={idx} className={`chat-bubble ${m.isUser ? "chat-bubble-user" : "chat-bubble-mentor"}`}
              style={{ alignSelf: m.isUser ? "flex-end" : "flex-start" }}>
              <span>{m.text}</span>
              <div className="chat-sender" style={{ color: m.isUser ? "rgba(255,255,255,0.7)" : "var(--text-muted)" }}>
                {m.isUser ? "You" : config.mentorName || "Mentor"}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="chat-bubble chat-bubble-mentor" style={{ fontStyle: "italic", color: "var(--text-muted)", alignSelf: "flex-start" }}>
              <span>{config.mentorName || "Mentor"} is thinking…</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {!hasAnyKey ? (
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center", marginTop: "8px" }}>
            🔑 Add an AI key in <strong>Settings → AI Keys</strong> to enable chat.
          </div>
        ) : (
          <form onSubmit={handleSendChat} className="chat-input-row" style={{ marginTop: "8px" }}>
            <textarea ref={chatInputRef} className="text-input" rows={3} value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={`Ask ${config.mentorName || "your mentor"}… (Shift+Enter for a new line)`}
              disabled={chatLoading}
              style={{ background: "var(--accent-ring)", border: "1.5px solid var(--accent-light)" }} />
            {chatLoading
              ? <span style={{ fontSize: "12px", color: "var(--text-muted)", padding: "0 10px" }}>…</span>
              : <button className="btn" type="submit" disabled={!chatInput.trim()} style={{ padding: "10px 16px", fontSize: "13px" }}>Send</button>
            }
          </form>
        )}
      </section>

      {/* 2 -- Focus Briefing */}
      <section className="card">
        <button type="button" onClick={() => setBriefOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, marginBottom: briefOpen ? "4px" : 0 }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "2px", color: "var(--text-primary)" }}>
              ⚡ AI Focus Brief
            </h2>
            {!briefOpen && (
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                Task snapshot & AI briefing
              </div>
            )}
          </div>
          <span style={{ fontSize: "16px", color: "var(--text-secondary)", transition: "transform 0.2s", transform: briefOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, marginLeft: "8px" }}>▼</span>
        </button>

        {briefOpen && (
        <>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "12px", marginBottom: "14px", lineHeight: "1.5" }}>
          Your AI scans every task across all horizons — flags overload, catches time blindness, and briefs you on exactly what to tackle now.
        </p>

        {/* Task Snapshot — always-visible data viz */}
        {(() => {
          const active = tasks.filter(isActiveLociTask);
          const horizons = ["today", "week", "month", "quarter", "halfyear", "office"];
          const hLabels = { today: "Today", week: "Week", month: "Month", quarter: "Quarter", halfyear: "6 Mo.", office: "Work" };
          const hCounts = horizons.map(h => active.filter(t => t.horizonLevel === h).length);
          const maxHCount = Math.max(...hCounts, 1);
          const priorities = ["P1", "P2", "P3", "P4"];
          const pColors = { P1: "var(--danger)", P2: "var(--warning)", P3: "var(--accent)", P4: "var(--success)" };
          const pCounts = Object.fromEntries(priorities.map(p => [p, active.filter(t => t.priority === p).length]));
          const totalPriority = Math.max(Object.values(pCounts).reduce((a, b) => a + b, 0), 1);
          const todayTasks = active.filter(t => t.horizonLevel === "today");
          const todayMins = todayTasks.reduce((s, t) => s + (Number(t.timeEstimateMinutes) || 25), 0);
          const loadPct = Math.min(100, Math.round((todayMins / 60) / 8 * 100));
          return (
            <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px 14px", marginBottom: "4px" }}>
              <h3 style={{ fontSize: "10px", fontWeight: "900", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "10px" }}>
                📊 Task Snapshot
              </h3>
              {/* Horizon bars */}
              <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "12px" }}>
                {horizons.map((h, i) => {
                  const count = hCounts[i];
                  if (count === 0) return null;
                  const pct = (count / maxHCount) * 100;
                  return (
                    <div key={h} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", width: "46px", flexShrink: 0 }}>{hLabels[h]}</span>
                      <div style={{ flex: 1, height: "6px", background: "var(--bg-card)", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: "3px" }} />
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-primary)", width: "14px", textAlign: "right" }}>{count}</span>
                    </div>
                  );
                })}
                {active.length === 0 && (
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>No active tasks yet</span>
                )}
              </div>
              {/* Priority mix bar */}
              {active.length > 0 && (
                <>
                  <div style={{ display: "flex", height: "6px", borderRadius: "3px", overflow: "hidden", marginBottom: "6px", gap: "1px" }}>
                    {priorities.map(p => {
                      const count = pCounts[p];
                      if (count === 0) return null;
                      return (
                        <div key={p} style={{ flex: count / totalPriority, background: pColors[p], minWidth: "4px" }} title={`${p}: ${count}`} />
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                    {priorities.map(p => pCounts[p] > 0 && (
                      <span key={p} style={{ fontSize: "10px", fontWeight: "700", color: pColors[p] }}>{p} {pCounts[p]}</span>
                    ))}
                  </div>
                </>
              )}
              {/* Today's load gauge */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)" }}>Today's Load</span>
                  <span style={{ fontSize: "10px", fontWeight: "800", color: loadPct > 100 ? "var(--danger)" : loadPct > 75 ? "var(--warning)" : "var(--success)" }}>
                    {(todayMins / 60).toFixed(1)}h / 8h
                  </span>
                </div>
                <div style={{ height: "6px", background: "var(--bg-card)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(loadPct, 100)}%`, background: loadPct > 100 ? "var(--danger)" : loadPct > 75 ? "var(--warning)" : "var(--success)", borderRadius: "3px" }} />
                </div>
                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "3px", textAlign: "right" }}>
                  {loadPct}% capacity{loadPct > 100 ? " — overloaded" : loadPct > 75 ? " — heavy day" : " — good"}
                </div>
              </div>
            </div>
          );
        })()}

        {!hasAnyKey ? (
          <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
            🔑 Add an AI key in <strong>Settings → AI Keys</strong> to enable this.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button className="btn" onClick={handleFocusBriefing} disabled={briefingLoading} style={{ width: "100%" }}>
              {briefingLoading ? "Analyzing your tasks…" : "Get AI Focus Brief"}
            </button>
            {briefingResult && (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px", fontSize: "12.5px", lineHeight: "1.7", maxHeight: "380px", overflowY: "auto", whiteSpace: "pre-line", color: "var(--text-primary)" }}>
                {briefingResult}
              </div>
            )}
          </div>
        )}
        </>
        )}
      </section>

      {/* 3 -- Parked Archive */}
      {parkedTasks.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "4px", color: "var(--text-primary)" }}>
            📦 Parked Tasks ({parkedTasks.length})
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Tasks parked by Bad Day Reset. Tap to restore them to your active list.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {parkedTasks.map(task => (
              <div key={task.uuid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", gap: "10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                    <span className={`priority-badge ${task.priority.toLowerCase()}`} style={{ fontSize: "10px", padding: "2px 6px", flexShrink: 0 }}>
                      {task.priority}
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {task.title}
                    </span>
                  </div>
                </div>
                <button className="btn" style={{ flexShrink: 0, padding: "6px 12px", fontSize: "11px", background: "var(--success)" }}
                  onClick={() => savePayload({ ...payload, tasks: tasks.map(t =>
                    t.uuid === task.uuid ? { ...t, isParked: false, lastUpdated: Date.now() } : t
                  )})}>
                  Restore ↑
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
