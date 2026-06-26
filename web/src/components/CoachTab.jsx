import React, { useState, useEffect, useRef } from "react";
import { track, auth } from "../firebase";
import { callAI, describeAIError, getAIKeys, hasAIKey } from "../utils/aiCall";
import ConfirmDialog from "./ConfirmDialog";
import { profileToCoachContext } from "../utils/userProfile";
import { buildLociCoreInstruction, buildLociTaskContext, buildLociAnchorsContext, buildLociCheckinContext, buildLociFocusSessionContext, buildLociNowFocusContext, buildLociDeadlineContext, buildLociDayMapContext, buildLociBrainDumpContext, buildLociVelocityContext, buildLociRemindersContext, buildLociLowEnergyContext, buildLociRecentlyParkedContext, getLocalDateString, isActiveLociTask } from "../utils/lociAIContext";
import { getTodayCheckedIds, getLociDayStr } from "../utils/dailyAnchors";
import { getFocusWindows } from "../utils/focusWindows";
import { requestNotifPermission } from "../utils/focusNotifications";
import { scheduleCoachCheckin } from "../utils/reminders";
import { parseCheckinTag, pickCheckinNote, buildCoachCheckin, isCheckinDue, parseCheckinRequestFromMessage, buildCoachCheckinContext } from "../utils/coachCheckin";
import { parseCoachActionTags, applyCoachActions, buildActionReplyText, buildSetNowFocusTasks, buildParkTaskTasks, findTaskByTitle } from "../utils/coachActions";
import { isPendingCoachNudgeStale, shouldDeliverPendingCoachNudge } from "../utils/coachNudge";
import { buildPersonaInstruction } from "../utils/coachPersona";
import { buildProfileContext } from "../utils/coachProfile";
import { addPinnedFact, addRecentObservation, buildLociMemoryContext, forgetFromMemory, isMemoryEnabled, parseMemoryTags } from "../utils/coachMemory";
import { stripReasoningTag } from "../utils/coachReasoning";
import { classifyContextMode, needsConversationContext, trimHistoryForDb, trimHistoryForLLM } from "../utils/coachContextMode";
import { buildCoachSystemPrompt } from "../utils/coachSystemPrompt";
import { safeCopyToClipboard } from "../utils/clipboard";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import "../styles/coachUI.css";

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTitleSafeForTextMatching(title = "") {
  if (!title) return false;
  if (title.length >= 8) return true;
  const words = title.split(/[\s,._\-!?]+/);
  let meaningfulCount = 0;
  for (const w of words) {
    if (w.length >= 3) {
      meaningfulCount++;
    }
  }
  return meaningfulCount >= 2;
}

function getLastCoachPlan(userId) {
  // Discard old global key to prevent leakage across users
  if (localStorage.getItem("loci_last_coach_plan")) {
    localStorage.removeItem("loci_last_coach_plan");
  }
  const key = `loci_last_coach_plan_${userId}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const plan = JSON.parse(raw);
    const EXPIRE_MS = 45 * 60 * 1000; // 45 minutes
    if (Date.now() - plan.createdAt > EXPIRE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return plan;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function getLastFullTaskTime(userId) {
  // Discard old global key to prevent leakage across users
  if (localStorage.getItem("loci_last_full_task_time")) {
    localStorage.removeItem("loci_last_full_task_time");
  }
  const key = `loci_last_full_task_time_${userId}`;
  const raw = localStorage.getItem(key);
  return raw ? Number(raw) : 0;
}

export default function CoachTab({ payload, savePayload, saveSubPath, saveSubPaths, saveConfigPatch, userProfile, focusTimer = {}, isSyncingFromCache = false, syncWarning = null, chatDraft = "", setChatDraft = () => {} }) {
  const { tasks = [], config = {}, brainDump = [], contributions = [] } = payload;
  const { groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const hasAnyKey = hasAIKey();

  // True until RTDB has actually delivered a snapshot for this session — true
  // while rendering from cache, but ALSO once the 15s offline warning fires
  // (useSync clears isSyncingFromCache then even with no RTDB response yet, so
  // config.coachMemory may still be stale localStorage data at that point).
  const cloudSyncUnconfirmed = isSyncingFromCache || syncWarning === "offline";

  const [confirmDialog, setConfirmDialog] = useState(null);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null);

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

  const chatInput = chatDraft;
  const setChatInput = setChatDraft;
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);
  const chatInputRef = useRef(null);
  const chatFormRef = useRef(null);
  const chipTextRef = useRef(null);
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

  // Deliver a Proactive Coach Nudge (see utils/coachNudge.js) handed off from
  // the Today tab — voiced by the AI when a key is available, falling back to
  // the signal's own canned text otherwise. Runs on mount, and again once
  // cloudSyncUnconfirmed flips to false (see the deferral below) so a nudge
  // deferred during the cache-sync window is delivered as soon as sync
  // confirms, instead of waiting for the next Coach remount.
  const deliveredNudgeRef = useRef(null);
  useEffect(() => {
    // Defer to App's Coach Check-In resume effect if it's also acting on
    // this tick — both write a fresh `config`/`chatHistory` snapshot, so
    // running both here would let one clobber the other. The nudge stays
    // pending and is picked up on a later mount.
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
      const withReply = [...chatHistoryRef.current, { text, isUser: false }];
      const MAX_DB_HISTORY = 20;
      const savedWithReply = withReply.length > MAX_DB_HISTORY
        ? withReply.slice(withReply.length - MAX_DB_HISTORY)
        : withReply;
      saveSubPath("chatHistory", savedWithReply);
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
        const profileContext = buildProfileContext(configRef.current);
        const systemInstruction = `${buildLociCoreInstruction({ firstName })}

You are ${configRef.current.mentorName || "Loci AI Coach"}, ${firstName}'s productivity mentor inside Loci Focus. You are reaching out FIRST — ${firstName} hasn't said anything yet this conversation. Something you noticed about their day: "${nudge.title} — ${nudge.body}". Open the conversation with this observation and a concrete next step. Max 2 short sentences. Don't mention that this is automated or that you "noticed" via data — just speak as their coach.

${buildPersonaInstruction(configRef.current, firstName)}
${profileContext ? `\n${profileContext}\n` : ""}${memoryContext ? `\n${memoryContext}\n` : ""}`;

        const reply = await callAI({
          groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey,
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
    const pendingChip = chipTextRef.current;
    chipTextRef.current = null;
    const userText = (pendingChip || chatInput).trim();
    if (!userText || chatLoading) return;

    // -- Local Replies Interceptor --
    const lowerText = userText.toLowerCase().replace(/[.?!]/g, "").trim();
    const isHi = /^(hi|hello|hey|hey yoda|hello yoda|hi yoda)$/i.test(lowerText);
    const isThanks = /^(thanks|thank you|thank you yoda|thanks yoda)$/i.test(lowerText);
    const isDay = /^(which day is it|what day is it|what's today|what is today)$/i.test(lowerText);
    const isWho = /^(who are you|what are you|who is yoda)$/i.test(lowerText);
    const isClear = /^(clear chat|clear history|clear conversation)$/i.test(lowerText);
    const isFocus = /^(what is my current focus|what's my current focus|what is my focus|what's my focus|what focus task)$/i.test(lowerText);

    if (isHi || isThanks || isDay || isWho || isClear || isFocus) {
      if (!pendingChip) setChatInput("");
      if (isClear) {
        saveSubPath("chatHistory", null);
        const userId = auth?.currentUser?.uid || "signed-out";
        localStorage.removeItem(`loci_last_coach_plan_${userId}`);
        localStorage.removeItem(`loci_last_full_task_time_${userId}`);
        localStorage.removeItem("loci_last_coach_plan");
        localStorage.removeItem("loci_last_full_task_time");
        return;
      }
      const MAX_DB_HISTORY = 20;
      const savedHistory = trimHistoryForDb(chatHistory, userText, MAX_DB_HISTORY);
      let localReplyText = "";
      if (isHi) {
        localReplyText = `Hey ${firstName}! I'm here. Want to ease in gently, or are you trying to decide what to do next?`;
      } else if (isThanks) {
        localReplyText = `You're welcome, ${firstName}. Let me know if you need to set focus or capture anything else.`;
      } else if (isDay) {
        const dayStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        localReplyText = `Today is ${dayStr}.`;
      } else if (isWho) {
        localReplyText = `I'm ${config.mentorName || "your AI coach"} inside Loci Focus. I'm here to help you cut through overwhelm, choose what to do next, and take action without shame.`;
      } else if (isFocus) {
        const focusTask = (tasks || []).find(t => isActiveLociTask(t) && t.isNowFocus);
        if (focusTask) {
          localReplyText = `Your current focus is **${focusTask.title}**. Ready to start a timer, or do you want to switch tasks?`;
        } else {
          localReplyText = `You don't have a Now Focus set right now. Want to set one, or should we look at your Today list?`;
        }
      }
      const replyMsg = { text: localReplyText, isUser: false };
      const withReply = [...savedHistory, replyMsg];
      const savedWithReply = withReply.length > MAX_DB_HISTORY
        ? withReply.slice(withReply.length - MAX_DB_HISTORY)
        : withReply;
      saveSubPath("chatHistory", savedWithReply);
      return;
    }

    if (!pendingChip) setChatInput("");

    const MAX_DB_HISTORY = 20;
    const withUser = [...chatHistory, { text: userText, isUser: true }];
    const savedHistory = trimHistoryForDb(chatHistory, userText, MAX_DB_HISTORY);
    saveSubPath("chatHistory", savedHistory);

    if (!hasAnyKey) {
      const replyMsg = { text: "🔑 Add an AI key in **Settings → AI Keys** to enable chat.", isUser: false };
      const withReply = [...savedHistory, replyMsg];
      const savedWithReply = withReply.length > MAX_DB_HISTORY
        ? withReply.slice(withReply.length - MAX_DB_HISTORY)
        : withReply;
      saveSubPath("chatHistory", savedWithReply);
      return;
    }

    const userId = auth?.currentUser?.uid || "signed-out";
    let lastPlan = getLastCoachPlan(userId);
    if (lastPlan) {
      const task = tasks.find(t => t.uuid === lastPlan.recommendedTaskId);
      if (!task || !isActiveLociTask(task) || task.title !== lastPlan.recommendedTaskTitle) {
        localStorage.removeItem(`loci_last_coach_plan_${userId}`);
        lastPlan = null;
      }
    }
    const lastFullTaskTime = getLastFullTaskTime(userId);
    const contextMode = classifyContextMode(userText, { lastFullTaskTime, hasLastPlan: !!lastPlan });
    const isReference = needsConversationContext(userText);
    const trimmedForLLM = trimHistoryForLLM(withUser, contextMode, isReference);
    setChatLoading(true);

    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const nowLabel = now.toLocaleString([], { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
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
    const pendingCheckinContext = buildCoachCheckinContext(config.coachCheckin, now.getTime());
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
    // Independent of Coach Memory — the user's own Coach Profile (Settings)
    // stays available even when AI-written memory is disabled.
    const profileContext = buildProfileContext(config);
    const personaInstruction = buildPersonaInstruction(config, firstName);

    const userMessageCount = withUser.filter(m => m.isUser).length;
    const isEarlyConversation = userMessageCount <= 1;

    const profileBlock = profileToCoachContext(userProfile);
    const currentFocusTitle = tasks.find(t => isActiveLociTask(t) && t.isNowFocus)?.title || null;
    const systemInstruction = buildCoachSystemPrompt(contextMode, {
      lociCoreInstruction,
      mentorName: config.mentorName || "Loci AI Coach",
      firstName,
      userName: config.userName,
      challengeLabel,
      profileContext,
      memoryContext,
      memorySectionEnabled,
      personaInstruction,
      taskContext,
      focusSessionContext,
      nowFocusContext,
      dayMapContext,
      remindersContext,
      anchorContext,
      checkinContext,
      pendingCheckinContext,
      deadlineContext,
      brainDumpContext,
      velocityContext,
      lowEnergyContext,
      recentlyParkedContext,
      isEarlyConversation,
      nowLabel,
      timeOfDay,
      todayActiveCount: todayActive.length,
      streakCount: config.visitStreakCount || 0,
      profileBlock,
      lastCoachPlan: lastPlan,
      currentFocusTitle,
    });

    const messages = trimmedForLLM.map(m => ({ role: m.isUser ? "user" : "assistant", content: m.text }));

    let maxTokens = 450;
    if (contextMode === "light") {
      maxTokens = 150;
    } else if (contextMode === "compact_task") {
      maxTokens = 280;
    } else if (contextMode === "emotional") {
      maxTokens = 300;
    } else if (contextMode === "full_task") {
      maxTokens = 450;
    } else if (contextMode === "profile_reflection") {
      maxTokens = 300;
    }

    try {
      const reply = await callAI({ groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey, systemPrompt: systemInstruction, messages, maxTokens, contextMode });
      if (contextMode === "full_task") {
        localStorage.setItem(`loci_last_full_task_time_${userId}`, String(Date.now()));
      }
      // The hidden response plan (see buildReasoningInstruction) is at the
      // start of the output, so it's stripped first, before any other tag
      // parsing.
      const afterReasoning = stripReasoningTag(reply.trim());
      // Memory tags are parsed first so that if one ever contains a nested
      // tag-like sequence (e.g. "[[REMEMBER: ...describing [[ADD_TASK:X]]...]]"),
      // the whole memory tag — including the nested text — is stripped before
      // the checkin/action parsers can see it as a tag of their own.
      const { cleanText: afterMemory, pinnedFacts, observations, forgets } = parseMemoryTags(afterReasoning);
      const { cleanText: afterCheckin, minutes } = parseCheckinTag(afterMemory);
      const { cleanText, actions } = parseCoachActionTags(afterCheckin);

      let currentTasks = tasks;

      // If the AI's reply omitted [[CHECKIN_IN:N]] despite a clear, non-recurring
      // check-in request in the user's latest message, fall back to a
      // deterministic parse of that request rather than dropping it silently.
      const checkinMinutes = minutes ?? parseCheckinRequestFromMessage(userText);

      let configPatch = null;
      if (checkinMinutes != null) {
        // Exact-title-only match (no fuzzy/partial matching) against the
        // user's own message, so the check-in never silently attaches to an
        // unrelated task — see pickCheckinNote.
        const activeForCheckin = currentTasks.filter(isActiveLociTask);
        const lowerUserText = userText.toLowerCase();
        // Use word-char lookaround instead of \b so titles with leading/trailing
        // punctuation (e.g. "Call mom?") still match when said verbatim — \b
        // only fires at a word/non-word transition, which a trailing "?" lacks.
        // "_" is included alongside letters/digits (matching \w's definition of
        // a word character) so "write_report" doesn't falsely match inside the
        // unrelated task title "write_report_draft".
        const titleBoundaryRegex = (title) => new RegExp(`(?<![a-z0-9_])${escapeRegExp(title.trim().toLowerCase())}(?![a-z0-9_])`, "gi");
        const mentionedTasks = activeForCheckin.filter(t =>
          isTitleSafeForTextMatching(t.title) && titleBoundaryRegex(t.title).test(lowerUserText)
        );
        // If multiple titles match (e.g. "Write report" and "Write report draft"
        // both match a single mention of the latter), prefer the most specific
        // one — but only when every other match is the *same* textual mention
        // (its occurrence is nested inside the longest title's match span).
        // If a shorter title is also mentioned as its own separate occurrence
        // (e.g. "remind me about Write report, not Write report draft"), that's
        // a genuinely ambiguous/excluding mention, not a single specific one —
        // fall back to null rather than guessing the excluded task.
        let mentionedTitle = null;
        if (mentionedTasks.length === 1) {
          mentionedTitle = mentionedTasks[0].title;
        } else if (mentionedTasks.length > 1) {
          const matchRanges = mentionedTasks.map(t => {
            const re = titleBoundaryRegex(t.title);
            const ranges = [];
            let m;
            while ((m = re.exec(lowerUserText))) ranges.push([m.index, m.index + m[0].length]);
            return { task: t, ranges };
          });
          const longest = matchRanges.reduce((a, b) => (b.task.title.length > a.task.title.length ? b : a));
          const [longestStart, longestEnd] = longest.ranges[0];
          const allNested = matchRanges.every(({ task, ranges }) =>
            task === longest.task || ranges.every(([s, e]) => s >= longestStart && e <= longestEnd)
          );
          mentionedTitle = allNested ? longest.task.title : null;
        }
        const checkin = buildCoachCheckin(checkinMinutes, pickCheckinNote(activeForCheckin, mentionedTitle));
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
      let actionResults = [];
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
        actionResults = results;
        if (updatedPayload.tasks) {
          currentTasks = updatedPayload.tasks;
        }

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

      // Extract and save lastCoachPlan
      if (contextMode === "full_task" || contextMode === "compact_task") {
        let recommendedTask = null;
        let matchedFromActionTag = false;
        const actionTagTasks = [];

        for (const action of actions) {
          if (action.type === "COMPLETE_TASK" || action.type === "PARK_TASK" || action.type === "ADD_TASK") {
            continue; // Do not update lastCoachPlan from complete, park, or add action tags
          }
          const task = findTaskByTitle(currentTasks, action.title);
          if (task && !actionTagTasks.some(t => t.uuid === task.uuid)) {
            actionTagTasks.push(task);
          }
        }

        if (actionTagTasks.length === 1) {
          recommendedTask = actionTagTasks[0];
          matchedFromActionTag = true;
        } else if (actionTagTasks.length > 1) {
          recommendedTask = null;
          matchedFromActionTag = true; // Multiple matches, ambiguous, do not guess or match text
        }

        if (!matchedFromActionTag) {
          const activeTasks = currentTasks.filter(isActiveLociTask);
          const lowerReply = cleanText.toLowerCase();
          const matchedTasks = [];
 
           // Collect and normalize titles of excluded tasks (added, completed, parked in this turn)
           const normalizeTitleForCache = (title) => (title || "").trim().toLowerCase().replace(/\s+/g, " ");
           const excludedTitles = new Set();
           for (const action of actions) {
             if (action.type === "COMPLETE_TASK" || action.type === "PARK_TASK" || action.type === "ADD_TASK") {
               if (action.title) {
                 excludedTitles.add(normalizeTitleForCache(action.title));
               }
             }
           }
 
           const normalizedReply = normalizeTitleForCache(cleanText);
           for (const task of activeTasks) {
             const title = task.title;
             if (excludedTitles.has(normalizeTitleForCache(title))) {
               continue; // Exclude added/completed/parked tasks from fallback matching
             }
             if (isTitleSafeForTextMatching(title)) {
               const normalizedTitle = normalizeTitleForCache(title);
               const escapedTitle = escapeRegExp(normalizedTitle);
               const regex = new RegExp(`\\b${escapedTitle}\\b`, 'i');
               if (regex.test(normalizedReply)) {
                 matchedTasks.push(task);
               }
             }
           }

          if (matchedTasks.length === 1) {
            recommendedTask = matchedTasks[0];
          } else {
            recommendedTask = null; // Ambiguous (0 or multiple matches), do not guess
          }
        }

        if (recommendedTask) {
          const plan = {
            recommendedTaskId: recommendedTask.uuid,
            recommendedTaskTitle: recommendedTask.title,
            horizon: recommendedTask.horizonLevel,
            reason: "Extracted from Coach turn",
            nextStep: recommendedTask.concreteStep || "Do first tiny step",
            alternateTaskIds: [],
            createdAt: Date.now()
          };
          localStorage.setItem(`loci_last_coach_plan_${userId}`, JSON.stringify(plan));
        } else if (contextMode === "full_task") {
          localStorage.removeItem(`loci_last_coach_plan_${userId}`);
        }
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

      const currentHistory = chatHistoryRef.current || [];
      const hasUserMsg = currentHistory.length > 0 &&
                         currentHistory[currentHistory.length - 1].isUser &&
                         currentHistory[currentHistory.length - 1].text === userText;
      const baseHistory = hasUserMsg ? currentHistory : savedHistory;

      const replyMsg = {
        text: replyText || "Got it.",
        isUser: false,
        ...(actionResults.some(r => r.matched) && { actions: actionResults.filter(r => r.matched) }),
      };
      const withReply = [...baseHistory, replyMsg];
      const savedWithReply = withReply.length > MAX_DB_HISTORY
        ? withReply.slice(withReply.length - MAX_DB_HISTORY)
        : withReply;
      saveSubPath("chatHistory", savedWithReply);
    } catch (err) {
      console.error("[CoachTab] AI chat failed:", err);
      const hint = describeAIError(err);
      
      const currentHistory = chatHistoryRef.current || [];
      const hasUserMsg = currentHistory.length > 0 &&
                         currentHistory[currentHistory.length - 1].isUser &&
                         currentHistory[currentHistory.length - 1].text === userText;
      const baseHistory = hasUserMsg ? currentHistory : savedHistory;

      const withError = [...baseHistory, { text: hint, isUser: false }];
      const savedWithError = withError.length > MAX_DB_HISTORY
        ? withError.slice(withError.length - MAX_DB_HISTORY)
        : withError;
      saveSubPath("chatHistory", savedWithError);
    } finally {
      setChatLoading(false);
    }
  };

  // -- Interactive chips (Phase A: prompt chips, Phase B: task-action chips) --

  const handlePromptChip = (promptText) => {
    if (!hasAnyKey || chatLoading) return;
    chipTextRef.current = promptText;
    chatFormRef.current?.requestSubmit();
  };

  // Phase A: select up to 3 context-aware follow-up prompts for a message
  const getPromptChips = (text) => {
    const chips = [];
    if (text.length > 300)           chips.push({ label: "Summarize",       prompt: "Summarize that in 2 sentences." });
    if (text.length > 300)           chips.push({ label: "Be more direct",  prompt: "Give me the key point in one sentence." });
    if (/[-•]|\d+\.\s/.test(text))  chips.push({ label: "Make it smaller", prompt: "Can you make that shorter?" });
    if (/step|\d+\.\s/i.test(text)) chips.push({ label: "3 concrete steps",prompt: "Turn that into 3 concrete steps." });
    if (/\d+\.\s/.test(text) || /\boptions?\b|\bchoose\b|\beither\b/i.test(text) || (text.match(/\bor\b/gi) || []).length >= 2)
      chips.push({ label: "Help me choose", prompt: "Help me choose one option." });
    chips.push({ label: "10-min version", prompt: "What’s the 10-minute version of this?" });
    return chips.slice(0, 3);
  };

  // Phase B: return a fresh task only when exactly one matched action has a uuid
  const taskChipsFor = (actions) => {
    const matched = (actions || []).filter(a => a.matched && a.task?.uuid);
    if (matched.length !== 1) return null;
    const fresh = tasks.find(t => t.uuid === matched[0].task.uuid && !t.isDeleted);
    return fresh || null;
  };

  const handleTaskChip = (action, taskUuid) => {
    // Re-read from tasksRef.current at click time — not from render-time closure
    const task = tasksRef.current.find(t => t.uuid === taskUuid && !t.isDeleted);
    if (!task) return; // task gone between render and click — silent no-op per guardrail
    const msgs = {
      focus:         `Set "${task.title}" as your Now Focus?`,
      'focus+today': `Move "${task.title}" to Today and set as Now Focus?`,
      today:         `Move "${task.title}" to Today?`,
      park:          `Park "${task.title}" for later?`,
    };
    setConfirmDialog({
      message: msgs[action],
      confirmLabel: action === 'park' ? 'Park it' : 'Yes',
      onConfirm: () => { applyTaskChip(action, taskUuid); setConfirmDialog(null); },
      onCancel:  () => setConfirmDialog(null),
    });
  };

  const applyTaskChip = (action, taskUuid) => {
    const current = tasksRef.current;
    const task = current.find(t => t.uuid === taskUuid && !t.isDeleted);
    if (!task) return;
    const now = Date.now();
    if (action === 'focus') {
      savePayload({ ...payload, tasks: buildSetNowFocusTasks(current, taskUuid, now) });
    } else if (action === 'focus+today') {
      const todayActive = current.filter(t => t.horizonLevel === 'today' && !t.isDeleted);
      const maxOrder = todayActive.reduce((m, t) => Math.max(m, t.orderIndex ?? 0), -1);
      savePayload({ ...payload, tasks: current.map(t => {
        if (t.uuid === taskUuid) return { ...t, horizonLevel: 'today', isNowFocus: true, isParked: false, orderIndex: maxOrder + 1, lastUpdated: now };
        return t.isNowFocus ? { ...t, isNowFocus: false, lastUpdated: now } : t;
      })});
    } else if (action === 'today') {
      const todayActive = current.filter(t => t.horizonLevel === 'today' && !t.isDeleted);
      const maxOrder = todayActive.reduce((m, t) => Math.max(m, t.orderIndex ?? 0), -1);
      savePayload({ ...payload, tasks: current.map(t =>
        t.uuid === taskUuid
          ? { ...t, horizonLevel: 'today', isNowFocus: false, isParked: false, orderIndex: maxOrder + 1, lastUpdated: now }
          : t
      )});
    } else if (action === 'park') {
      savePayload({ ...payload, tasks: buildParkTaskTasks(current, taskUuid, now) });
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
        groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey,
        systemPrompt: `${buildLociCoreInstruction({ firstName })}\n\nYou are ${config.mentorName || "a focus coach"}, an expert productivity coach.`,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 800
      });
      setBriefingResult(reply);
    } catch (err) {
      console.error("[CoachTab] Focus briefing failed:", err);
      setBriefingResult(describeAIError(err));
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
              onClick={() => setConfirmDialog({ message: "Clear all chat history?", confirmLabel: "Clear", danger: true, onConfirm: () => { saveSubPath("chatHistory", null); const uId = auth?.currentUser?.uid || "signed-out"; localStorage.removeItem(`loci_last_coach_plan_${uId}`); localStorage.removeItem(`loci_last_full_task_time_${uId}`); localStorage.removeItem("loci_last_coach_plan"); localStorage.removeItem("loci_last_full_task_time"); setConfirmDialog(null); }, onCancel: () => setConfirmDialog(null) })}
              style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "11px", fontWeight: "700", cursor: "pointer", padding: "4px 8px", flexShrink: 0 }}
            >
              Clear
            </button>
          )}
        </div>

        <div className="chat-window coach-chat">
          {(() => {
            const lastMentorIdx = chatHistory.reduce((last, m, i) => (!m.isUser ? i : last), -1);
            return chatHistory.map((m, idx) => (
            <div key={idx} className={`chat-bubble ${m.isUser ? "chat-bubble-user" : "chat-bubble-mentor"}`}
              style={m.isUser ? { alignSelf: "flex-end" } : undefined}>
              {m.isUser ? (
                <span>{m.text}</span>
              ) : (
                <ReactMarkdown
                  className="coach-md"
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitize]}
                  components={{
                    a: ({ node, href, children, ...props }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
                    ),
                  }}
                >
                  {m.text}
                </ReactMarkdown>
              )}
              <button
                type="button"
                className="chat-bubble-copy-btn"
                aria-label="Copy message"
                onClick={() => {
                  safeCopyToClipboard(m.text).then(ok => {
                    if (ok) { setCopiedMsgIdx(idx); setTimeout(() => setCopiedMsgIdx(null), 1500); }
                  });
                }}
              >
                {copiedMsgIdx === idx ? "✓" : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                )}
              </button>
              {!m.isUser && m.actions && m.actions.length > 0 && (
                <div className="coach-action-chips">
                  {m.actions.map((a, i) => {
                    const icons  = { COMPLETE_TASK: "✅", SET_NOW_FOCUS: "🎯", START_FOCUS: "🟢", ADD_TASK: "+", PARK_TASK: "🔵" };
                    const labels = { COMPLETE_TASK: "Done", SET_NOW_FOCUS: "Focus", START_FOCUS: "Session", ADD_TASK: "Added", PARK_TASK: "Parked" };
                    const title  = (a.task?.title || a.title || "").slice(0, 28);
                    return (
                      <span key={i} className="coach-action-chip">
                        {icons[a.type] || "·"} {labels[a.type] || a.type}: {title}
                      </span>
                    );
                  })}
                </div>
              )}
              {/* Phase A — prompt chips: last mentor message only, ephemeral */}
              {!m.isUser && idx === lastMentorIdx && (() => {
                const chips = getPromptChips(m.text);
                return chips.length > 0 ? (
                  <div className="coach-prompt-chips">
                    {chips.map((c, i) => (
                      <button key={i} type="button" className="coach-prompt-chip"
                        disabled={chatLoading}
                        onClick={() => handlePromptChip(c.prompt)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
              {/* Phase B — task-action chips: last mentor message, exactly one matched task */}
              {!m.isUser && idx === lastMentorIdx && (() => {
                const task = taskChipsFor(m.actions);
                if (!task) return null;
                const phaseB = [];
                if (task.horizonLevel === 'today' && !task.isNowFocus)
                  phaseB.push({ action: 'focus',       label: 'Set as Focus' });
                else if (task.horizonLevel !== 'today' && !task.isNowFocus)
                  phaseB.push({ action: 'focus+today', label: 'Move to Today & Focus' });
                if (task.horizonLevel !== 'today')
                  phaseB.push({ action: 'today',       label: 'Move to Today' });
                if (!task.isParked)
                  phaseB.push({ action: 'park',        label: 'Park' });
                return phaseB.length > 0 ? (
                  <div className="coach-task-chips">
                    {phaseB.map((c, i) => (
                      <button key={i} type="button" className="coach-task-chip"
                        disabled={chatLoading}
                        onClick={() => handleTaskChip(c.action, task.uuid)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
              <div className="chat-sender" style={{ color: m.isUser ? "rgba(255,255,255,0.7)" : "var(--text-muted)" }}>
                {m.isUser ? "You" : config.mentorName || "Mentor"}
              </div>
            </div>
          ));
          })()}
          {chatLoading && (
            <div className="chat-bubble chat-bubble-mentor" style={{ fontStyle: "italic", color: "var(--text-muted)", alignSelf: "flex-start" }}>
              <span>{config.mentorName || "Mentor"} is thinking…</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        <form ref={chatFormRef} onSubmit={handleSendChat} className="chat-input-row" style={{ marginTop: "8px" }}>
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
              <div className="coach-briefing-box">
                <ReactMarkdown
                  className="coach-md"
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitize]}
                  components={{
                    a: ({ node, href, children, ...props }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
                    ),
                  }}
                >
                  {briefingResult}
                </ReactMarkdown>
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
