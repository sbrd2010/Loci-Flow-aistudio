import React, { useState, useEffect, useRef } from "react";
import { track, auth } from "../firebase";
import { callAI, describeAIError, getAIKeys, hasAIKey } from "../utils/aiCall";
import ConfirmDialog from "./ConfirmDialog";
import { profileToCoachContext } from "../utils/userProfile";
import { buildLociCoreInstruction, buildLociTaskContext, buildLociAnchorsContext, buildLociCheckinContext, buildLociFocusSessionContext, buildLociNowFocusContext, buildLociDeadlineContext, buildLociDayMapContext, buildLociBrainDumpContext, buildLociVelocityContext, buildLociRemindersContext, buildLociLowEnergyContext, buildLociRecentlyParkedContext, buildLociCategoryFilterContext, getLocalDateString, isActiveLociTask } from "../utils/lociAIContext";
import { getTodayCheckedIds, getLociDayStr } from "../utils/dailyAnchors";
import { getFocusWindows } from "../utils/focusWindows";
import { requestNotifPermission } from "../utils/focusNotifications";
import { scheduleCoachCheckin } from "../utils/reminders";
import { parseCheckinTag, pickCheckinNote, buildCoachCheckin, isCheckinDue, parseCheckinRequestFromMessage, buildCoachCheckinContext } from "../utils/coachCheckin";
import { parseCoachActionTags, applyCoachActions, buildActionReplyText, buildSetNowFocusTasks, buildParkTaskTasks, findTaskByTitle } from "../utils/coachActions";
import { isPendingCoachNudgeStale, shouldDeliverPendingCoachNudge } from "../utils/coachNudge";
import { buildPersonaInstruction } from "../utils/coachPersona";
import { buildProfileContext } from "../utils/coachProfile";
import { addPinnedFact, addRecentObservation, buildLociMemoryContext, forgetFromMemory, isMemoryEnabled, parseMemoryTags, isResurrectedMemoryEntry } from "../utils/coachMemory";
import { stripReasoningTag } from "../utils/coachReasoning";
import { classifyContextMode, needsConversationContext, trimHistoryForLLM, historyLimitForMode, detectRequestedCategories } from "../utils/coachContextMode";
import { buildCoachSystemPrompt } from "../utils/coachSystemPrompt";
import {
  needsSummaryUpdate, pendingSummaryMessages, buildPendingSummaryContext,
  pendingSummaryIncludedCount, buildSessionSummaryContext, parseSessionSummaryTag,
  trimChatHistoryWithCursor, shouldIncludeSessionSummaryContext,
} from "../utils/coachSessionSummary";
import { buildRescueHandoffContext, shouldClearRescueHandoff } from "../utils/rescueHandoff";
import { safeCopyToClipboard } from "../utils/clipboard";
import LinkifyText from "./LinkifyText";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import "../styles/coachUI.css";

// Visible/stored chat history cap (was 20) — the raw window actually sent to
// the LLM stays at historyLimitForMode's 3/10, unaffected by this; the
// session summary (coachSessionSummary.js) is what lets the model stay
// aware of anything older than that raw window without paying to replay it.
const MAX_DB_HISTORY = 40;

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
  const copyTimeoutRef = useRef(null);
  useEffect(() => () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); }, []);

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

  // Every coachSessionSummary write is gated on !cloudSyncUnconfirmed (see
  // applyOrDeferCursorDecrement/the isClear reset below) — saveConfigPatch
  // always stamps config.lastUpdated, and mergeConfig (normalizePayload.js)
  // picks the newer-lastUpdated config as a WHOLE object, so writing this
  // before the first RTDB snapshot arrives could make a stale cached config
  // beat fresh remote data on the first merge (Codex review finding,
  // PR #347). Both kinds of gated writes here — the chat-clear reset and
  // the 40-cap trim's cursor decrement — are deferred via localStorage
  // rather than just skipped or held in a ref:
  //   - cloudSyncUnconfirmed is not always brief: syncWarning "offline"
  //     specifically means RTDB hasn't responded, which can persist for an
  //     entire session if Firebase itself is blocked (e.g. a privacy
  //     extension) while the LLM provider stays reachable on a different
  //     host — so chatting (and repeatedly hitting the 40-cap) while
  //     unconfirmed is a real, not just theoretical, scenario.
  //   - Coach unmounts on tab switch (App.jsx renders it only while
  //     activeTab === "coach"), so a ref would be silently discarded if the
  //     user switches away before sync confirms (the same unmount-loss bug
  //     class PR1/#346 already fixed once for memory writes).
  // localStorage is per-device and never goes through the RTDB config
  // merge, so writing these flags during the unconfirmed window is itself
  // safe. Re-checked on every mount (not just cloudSyncUnconfirmed
  // transitions while mounted) so switching back to the Coach tab after
  // sync has already confirmed still applies them.
  const pendingSummaryClearKey = () => `loci_coach_pending_summary_clear_${auth?.currentUser?.uid || "signed-out"}`;
  const pendingSummaryDecrementKey = () => `loci_coach_pending_summary_decrement_${auth?.currentUser?.uid || "signed-out"}`;

  // Applies a cursor decrement immediately when sync is already confirmed,
  // or accumulates it in localStorage (added to whatever's already pending)
  // to apply in one shot once it is. Pass cloudSyncUnconfirmedRef.current
  // instead of the plain value from call sites that can run after an await
  // (e.g. the nudge-delivery IIFE below), matching this file's existing
  // convention for those closures.
  const applyOrDeferCursorDecrement = (removedCount, isUnconfirmed) => {
    if (removedCount <= 0) return;
    if (isUnconfirmed) {
      const key = pendingSummaryDecrementKey();
      const existing = Number(localStorage.getItem(key)) || 0;
      localStorage.setItem(key, String(existing + removedCount));
      return;
    }
    saveConfigPatch((latestConfig) => ({
      coachSessionSummary: {
        ...(latestConfig.coachSessionSummary || {}),
        summarizedThroughIndex: Math.max(0, (latestConfig.coachSessionSummary?.summarizedThroughIndex || 0) - removedCount),
      },
    }));
  };

  // Shared by the typed "clear chat" command and the Clear button below —
  // previously duplicated inline at both sites (code-review finding,
  // PR #347). Always reads cloudSyncUnconfirmedRef.current, not the plain
  // closure value: the Clear button's version of this logic used to run
  // inside a ConfirmDialog's onConfirm closure, created when the dialog
  // opens but not invoked until the user clicks Confirm — a real gap for
  // cloudSyncUnconfirmed to change in, e.g. sync confirming while the
  // dialog sits open (code-review finding, PR #347). The typed-command
  // call site is fully synchronous, so the ref and the closure value are
  // always equal there — using the ref uniformly is still correct and
  // keeps this one function safe to call from both places without callers
  // needing to know which case applies.
  const clearSessionSummaryDeferredIfNeeded = () => {
    if (cloudSyncUnconfirmedRef.current) {
      localStorage.setItem(pendingSummaryClearKey(), "1");
    } else {
      saveConfigPatch({ coachSessionSummary: null });
    }
  };

  useEffect(() => {
    if (cloudSyncUnconfirmed) return;
    const clearKey = pendingSummaryClearKey();
    const shouldClear = localStorage.getItem(clearKey) === "1";
    if (shouldClear) localStorage.removeItem(clearKey);

    const decrementKey = pendingSummaryDecrementKey();
    const pendingDecrement = Number(localStorage.getItem(decrementKey)) || 0;
    if (pendingDecrement > 0) localStorage.removeItem(decrementKey);

    if (shouldClear) {
      // A clear supersedes any accumulated decrement — the summary is being
      // reset to null either way, so there's nothing left to decrement.
      saveConfigPatch({ coachSessionSummary: null });
    } else if (pendingDecrement > 0) {
      applyOrDeferCursorDecrement(pendingDecrement, false);
    }
  }, [cloudSyncUnconfirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coach tab unmounts on tab switch (see App.jsx), so an in-flight AI reply
  // can resolve after the user has navigated to Settings and changed
  // coachMemory/coachMemoryEnabled there. Rather than dropping the reply's
  // memory writes based on mount state, memoryPatch below re-checks
  // isMemoryEnabled against the latest config at save time — so a late
  // REMEMBER/NOTE is still saved unless the user explicitly opted out before
  // it resolved, and a [[FORGET: ...]] is always applied (the user already
  // asked to delete something; applying it late is strictly better than
  // silently dropping it and re-injecting the "forgotten" entry into every
  // future prompt).

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
      const { history: savedWithReply, trimmed, removedCount } =
        trimChatHistoryWithCursor(withReply, MAX_DB_HISTORY, configRef.current.coachSessionSummary);
      saveSubPath("chatHistory", savedWithReply);
      // The 40-cap can trim old messages off the front even on this
      // no-AI-call nudge path — keep summarizedThroughIndex in sync so it
      // doesn't drift relative to the now-shorter array (see
      // trimChatHistoryWithCursor's doc comment). Recomputed against
      // latestConfig rather than a pre-built value, so this doesn't clobber
      // a same-session chat-send's own cursor write if the two land close
      // together (loopcheck finding, PR #347).
      //
      // Uses the ref (not the mount-time cloudSyncUnconfirmed closure
      // value) since deliver() can run from the async IIFE below, well
      // after this effect's own cloudSyncUnconfirmedRef check at the top —
      // sync could still be unconfirmed, or have become unconfirmed again,
      // by the time the AI reply resolves.
      applyOrDeferCursorDecrement(removedCount, cloudSyncUnconfirmedRef.current);
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
          maxTokens: 120,
          reasoningEffort: "low"
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
        // Session summary is conversation-scoped (unlike coachMemory, which
        // stays untouched here) — reset it alongside the history it
        // summarizes. See clearSessionSummaryDeferredIfNeeded's declaration
        // above for why this is deferred (not skipped) while sync is
        // unconfirmed.
        clearSessionSummaryDeferredIfNeeded();
        const userId = auth?.currentUser?.uid || "signed-out";
        localStorage.removeItem(`loci_last_coach_plan_${userId}`);
        localStorage.removeItem(`loci_last_full_task_time_${userId}`);
        localStorage.removeItem("loci_last_coach_plan");
        localStorage.removeItem("loci_last_full_task_time");
        return;
      }
      // Same two-step early+late cursor chaining as the main path below:
      // the early trim (adding userText) must adjust the cursor via
      // trimChatHistoryWithCursor before the reply's own trim reads it,
      // or the second trim clobbers/misreads a stale cursor (identical
      // bug class to the main path's loopcheck finding, PR #347).
      const withUserForLocalReply = [...chatHistory, { text: userText, isUser: true }];
      const { history: savedHistory, coachSessionSummary: summaryAfterLocalEarlyTrim, removedCount: localEarlyRemovedCount } =
        trimChatHistoryWithCursor(withUserForLocalReply, MAX_DB_HISTORY, config.coachSessionSummary);
      // Not persisted immediately — folded into the single decrement below
      // instead, same reasoning as the main path's earlyRemovedCount: two
      // independent saveConfigPatch calls close together can still race via
      // RTDB's own retry/backoff (a delayed retry from the first call can
      // land after the second succeeds and overwrite it), regardless of how
      // close together they were issued locally — retry timing depends on
      // network conditions, not local call spacing (code-review finding,
      // PR #347).
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
      const { history: savedWithReply, removedCount } =
        trimChatHistoryWithCursor(withReply, MAX_DB_HISTORY, summaryAfterLocalEarlyTrim);
      saveSubPath("chatHistory", savedWithReply);
      // Deferred (not skipped) while sync is unconfirmed — see the isClear
      // reset above for why. Includes localEarlyRemovedCount so this single
      // write correctly reflects BOTH trims relative to the still-
      // unadjusted remote value (code-review finding, PR #347).
      applyOrDeferCursorDecrement(removedCount + localEarlyRemovedCount, cloudSyncUnconfirmed);
      return;
    }

    if (!pendingChip) setChatInput("");

    // savedHistory (not the untrimmed chatHistory+userText) is the basis for
    // everything below that indexes into "the array as actually stored" —
    // this can trim a message off the front here if chatHistory was at the
    // 40-cap. Using the untrimmed version for the raw-window/cursor math
    // further down would silently compute rawWindowStart in the wrong
    // coordinate system once the cap is reached, since front-trimming
    // shifts every index by however much was removed (loopcheck finding,
    // PR #347). Safe for trimHistoryForLLM too — trimming from the front
    // never changes which messages end up in the last-N tail.
    //
    // Routed through trimChatHistoryWithCursor (not the plain
    // trimHistoryForDb) specifically so summaryAfterEarlyTrim is adjusted
    // for this trim before anything below reads a cursor value — otherwise
    // the cursor stays relative to the pre-trim array while rawWindowStart
    // is relative to the post-trim one, silently skipping whichever
    // messages fall in the gap between the two coordinate systems (second,
    // deeper loopcheck finding — confirmed by simulation to permanently and
    // silently drop every coach reply once the 40-cap trim starts firing
    // regularly, not just an edge case).
    const withUserForTrim = [...chatHistory, { text: userText, isUser: true }];
    const { history: savedHistory, coachSessionSummary: summaryAfterEarlyTrim, removedCount: earlyRemovedCount } =
      trimChatHistoryWithCursor(withUserForTrim, MAX_DB_HISTORY, config.coachSessionSummary);
    saveSubPath("chatHistory", savedHistory);
    // Not persisted immediately here — earlyRemovedCount is instead folded
    // into whichever later write actually happens (the !hasAnyKey branch
    // just below, the main success path, or the error-catch path), so
    // there is only ever ONE saveConfigPatch call touching
    // coachSessionSummary per turn instead of two. saveConfigPatch issues
    // an independent RTDB update() with its own retry/backoff per call; an
    // earlier call whose write is delayed by a retry can still land AFTER
    // a later call's write completes, silently overwriting a fresher value
    // with a stale one — a real risk here specifically because the gap
    // between this early trim and the main success path's write spans the
    // full AI network call (seconds), a much wider window for a transient
    // retry to land out of order than the near-zero gap between two
    // synchronous calls elsewhere in this file (Codex review finding,
    // PR #347). summaryAfterEarlyTrim (used as coachSessionSummary/
    // preTrimSessionSummary's base below) already reflects this trim
    // in-memory regardless — only the immediate, separate persistence is
    // removed.
    if (!hasAnyKey) {
      const replyMsg = { text: "🔑 Add an AI key in **Settings → AI Keys** to enable chat.", isUser: false };
      const withReply = [...savedHistory, replyMsg];
      const { history: savedWithReply, removedCount } =
        trimChatHistoryWithCursor(withReply, MAX_DB_HISTORY, summaryAfterEarlyTrim);
      saveSubPath("chatHistory", savedWithReply);
      applyOrDeferCursorDecrement(removedCount + earlyRemovedCount, cloudSyncUnconfirmed);
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
    const trimmedForLLM = trimHistoryForLLM(savedHistory, contextMode, isReference);
    setChatLoading(true);

    // Session summary: same raw-window boundary trimHistoryForLLM just used,
    // computed via the shared historyLimitForMode so the two can never drift
    // apart. Messages sitting between the stored cursor and that boundary
    // are about to leave the raw window for good — include them one final
    // time (as plain-text context, not chat-role messages) so the model can
    // fold them into an updated summary before they're gone.
    const coachSessionSummary = summaryAfterEarlyTrim;
    const rawWindowStart = Math.max(0, savedHistory.length - historyLimitForMode(contextMode, isReference));
    const summarizedThroughIndex = coachSessionSummary?.summarizedThroughIndex || 0;
    const summaryUpdateNeeded = needsSummaryUpdate(rawWindowStart, summarizedThroughIndex);
    // Same cloud-sync gate as memorySectionEnabled/rescueHandoffContext
    // below, applied to BOTH the stored-summary read and the pending-
    // messages trigger: config/chatHistory can still be the stale cached
    // value here (this whole section is computed from savedHistory /
    // summaryAfterEarlyTrim, both sourced from cache before the first RTDB
    // snapshot). If another device cleared or replaced the conversation
    // during that window, either one could resurface stale conversation
    // content into THIS turn's prompt — the stored summary as "CONVERSATION
    // SO FAR", or cached older messages as the pending-update trigger block
    // — even though the resulting write is separately never persisted
    // while unconfirmed (Codex review finding, PR #347).
    const sessionSummarySectionEnabled = !cloudSyncUnconfirmed;
    const pendingBatch = sessionSummarySectionEnabled && summaryUpdateNeeded
      ? pendingSummaryMessages(savedHistory, rawWindowStart, summarizedThroughIndex)
      : [];
    const pendingSummaryContext = buildPendingSummaryContext(pendingBatch);
    // How far the cursor may actually advance if this turn's summary write
    // succeeds — summarizedThroughIndex + however many of pendingBatch
    // buildPendingSummaryContext actually included, NOT blindly
    // rawWindowStart. buildPendingSummaryContext truncates an oversized
    // batch to a budget (see PENDING_SUMMARY_TOTAL_MAX_CHARS), and the
    // cursor may only advance past messages the model actually saw —
    // advancing all the way to rawWindowStart regardless would mark
    // truncated-out messages as "summarized" when they were never shown to
    // the model, permanently losing them from both raw history and the
    // summary (Codex review finding, PR #347). Equals rawWindowStart
    // exactly whenever nothing was truncated.
    const summaryCoveredThroughIndex = summarizedThroughIndex + pendingSummaryIncludedCount(pendingBatch);
    const sessionSummaryContext = sessionSummarySectionEnabled && shouldIncludeSessionSummaryContext(contextMode, isReference, summaryUpdateNeeded)
      ? buildSessionSummaryContext(coachSessionSummary)
      : "";

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
    const requestedCategories = detectRequestedCategories(userText);
    const categoryFilterContext = buildLociCategoryFilterContext(tasks, requestedCategories);
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
    // Captured now (mirrors rescueHandoffSummaryUsedAt below) so a late-
    // resolving reply's memoryPatch can detect whether the user deleted a
    // fact or cleared memory from Settings while this reply was in flight,
    // and skip re-adding its now-stale REMEMBER/NOTE on top of that
    // intentional deletion (Codex review finding, PR #346).
    const coachMemoryAtSendTime = config.coachMemory || {};
    // Independent of Coach Memory — the user's own Coach Profile (Settings)
    // stays available even when AI-written memory is disabled.
    const profileContext = buildProfileContext(config);
    const personaInstruction = buildPersonaInstruction(config, firstName);
    // Same cloud-sync gate as memorySectionEnabled above: cached/pre-sync
    // config.rescueHandoffSummary may already be stale/consumed on another
    // device, so don't send it to the AI until sync is confirmed.
    const rescueHandoffContext = cloudSyncUnconfirmed
      ? ""
      : buildRescueHandoffContext(config.rescueHandoffSummary, { now, config });
    // Captured now so the eventual clear (after the AI call resolves) can be
    // checked against the latest config instead of blindly nulling — a newer
    // Rescue session started while this reply was in flight would have saved
    // a different summary that must not be clobbered.
    const rescueHandoffSummaryUsedAt = rescueHandoffContext ? (config.rescueHandoffSummary?.createdAt ?? null) : null;

    const userMessageCount = savedHistory.filter(m => m.isUser).length;
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
      categoryFilterContext,
      rescueHandoffContext,
      isEarlyConversation,
      nowLabel,
      timeOfDay,
      todayActiveCount: todayActive.length,
      streakCount: config.visitStreakCount || 0,
      profileBlock,
      lastCoachPlan: lastPlan,
      currentFocusTitle,
      sessionSummaryContext,
      pendingSummaryContext,
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
    // Not a blind doubling — just enough headroom for the ~700-1000 char
    // (roughly 200-300 token) [[SESSION_SUMMARY:...]] tag on top of the
    // normal reply, so neither gets truncated on the turns that need it.
    // Also requires sessionSummarySectionEnabled: summaryUpdateNeeded alone
    // just means the raw window has moved past the cursor — while sync is
    // unconfirmed, pendingBatch/pendingSummaryContext are already forced
    // empty (see sessionSummarySectionEnabled above), so the model was
    // never actually asked to write a tag; padding for one it can't emit
    // wastes token headroom every such turn (code-review finding, PR #347).
    if (summaryUpdateNeeded && sessionSummarySectionEnabled) maxTokens += 300;

    try {
      const reply = await callAI({ groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey, systemPrompt: systemInstruction, messages, maxTokens, contextMode, reasoningEffort: "low" });
      if (contextMode === "full_task") {
        localStorage.setItem(`loci_last_full_task_time_${userId}`, String(Date.now()));
      }
      // The hidden response plan (see buildReasoningInstruction) is at the
      // start of the output, so it's stripped first, before any other tag
      // parsing.
      const afterReasoning = stripReasoningTag(reply.trim());
      // The session summary is stripped before memory-tag parsing, not
      // after: its content can legitimately quote older raw conversation
      // text (see buildPendingSummaryContext/pendingSummaryMessages), and if
      // that quoted text happens to contain something that looks like
      // "[[REMEMBER: ...]]" / "[[NOTE: ...]]" / "[[FORGET: ...]]" (e.g.
      // because the user literally typed those characters in an earlier
      // message), parsing memory tags first would treat quoted, stale text
      // as a live durable-memory command instead of stripping it away with
      // the rest of the summary block (loopcheck finding, PR #347).
      const { cleanText: afterSummaryTag, summary: newSessionSummary } = parseSessionSummaryTag(afterReasoning);
      // Memory tags are parsed next so that if one ever contains a nested
      // tag-like sequence (e.g. "[[REMEMBER: ...describing [[ADD_TASK:X]]...]]"),
      // the whole memory tag — including the nested text — is stripped before
      // the checkin/action parsers can see it as a tag of their own.
      const { cleanText: afterMemory, pinnedFacts, observations, forgets } = parseMemoryTags(afterSummaryTag);
      const { cleanText: afterCheckin, minutes } = parseCheckinTag(afterMemory);
      const { cleanText, actions } = parseCoachActionTags(afterCheckin);
      if (summaryUpdateNeeded && sessionSummarySectionEnabled && !newSessionSummary) {
        // Missing/malformed tag on a turn that needed one — keep whatever
        // summary was already stored (never overwrite a valid one with
        // nothing) and don't advance the cursor, so the same pending
        // messages are retried on a later turn rather than silently lost.
        // Gated on sessionSummarySectionEnabled too, or this fires every
        // turn while sync is unconfirmed — an update wasn't actually
        // requested that turn (pendingSummaryContext was forced empty), so
        // a missing tag isn't an anomaly worth warning about (code-review
        // finding, PR #347).
        console.warn("[CoachTab] session summary update requested but [[SESSION_SUMMARY:...]] was missing or empty; keeping previous summary");
      }

      let currentTasks = tasks;

      // If the AI's reply omitted [[CHECKIN_IN:N]] despite a clear, non-recurring
      // check-in request in the user's latest message, fall back to a
      // deterministic parse of that request rather than dropping it silently.
      const checkinMinutes = minutes ?? parseCheckinRequestFromMessage(userText);

      let configPatch = null;
      // Only clears rescueHandoffSummary if it's still the same summary that
      // was actually used to build this prompt (see rescueHandoffSummaryUsedAt
      // above) — otherwise a newer handoff saved mid-flight would be lost.
      const clearRescueHandoffIfUnchanged = (latestConfig) =>
        shouldClearRescueHandoff(latestConfig.rescueHandoffSummary, rescueHandoffSummaryUsedAt)
          ? { rescueHandoffSummary: null }
          : {};
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
      // Applied regardless of isMountedRef — saveConfigPatch below is safe to
      // call after unmount (see its own comment), so a REMEMBER/NOTE from a
      // reply that resolves after the user left the Coach tab is still saved
      // rather than silently dropped.
      const willAddMemory = memoryWriteAllowed && (pinnedFacts.length > 0 || observations.length > 0);
      let memoryPatch = null;
      if (willForget || willAddMemory) {
        // Computed against the latest config at save time (via saveConfigPatch's
        // function form below), not this possibly-stale configRef.current.coachMemory
        // — so a Settings-tab edit made while this reply was in flight isn't
        // reverted by this whole-coachMemory write.
        memoryPatch = (latestConfig) => {
          // latestMemory (pre-forget) is the "after" snapshot for resurrection
          // checks below, so this reply's own FORGET (applied next) never
          // counts as "someone else's deletion" against itself.
          const latestMemory = latestConfig.coachMemory || {};
          let memory = latestMemory;
          if (willForget) forgets.forEach(text => { memory = forgetFromMemory(memory, text); });
          // Re-check Coach Memory's enabled flag against the latest config —
          // willAddMemory may have been computed pre-unmount (paired with a
          // willForget exemption), so the user could have turned memory off
          // in Settings before this reply resolves. The forget above is still
          // applied (it's a deletion the user already asked for), but a new
          // addition shouldn't be written after an explicit opt-out. Each
          // candidate is also checked individually against
          // isResurrectedMemoryEntry — skip only the specific fact/note the
          // user just deleted/corrected from Settings while this reply was
          // in flight, not the whole batch (loopcheck + Codex review
          // findings, PR #346), so an unrelated new memory or a paired
          // FORGET+REMEMBER correction still saves normally.
          if (willAddMemory && isMemoryEnabled(latestConfig)) {
            pinnedFacts.forEach(fact => {
              if (!isResurrectedMemoryEntry(coachMemoryAtSendTime, latestMemory, fact)) memory = addPinnedFact(memory, fact);
            });
            observations.forEach(note => {
              if (!isResurrectedMemoryEntry(coachMemoryAtSendTime, latestMemory, note)) memory = addRecentObservation(memory, note, todayStr);
            });
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
            ...clearRescueHandoffIfUnchanged(latestConfig),
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
            const mins = Number(startFocus.durationMinutes) > 0 ? Number(startFocus.durationMinutes)
              : Number(startFocus.task.timeEstimateMinutes) > 0 ? Number(startFocus.task.timeEstimateMinutes) : 25;
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

      // What coachSessionSummary should become, before accounting for this
      // save's own 40-cap trim below — either this turn's fresh rewrite, or
      // whatever was already stored (untouched) if no update was needed or
      // the tag came back missing/malformed. Kept relative to the same
      // send-time snapshot (coachSessionSummary) that rawWindowStart was
      // computed against, rather than re-reading configRef.current here —
      // mixing the two reference frames could regress the cursor if another
      // device wrote a newer one concurrently, and chatHistory itself
      // doesn't fully solve that cross-device race either (see baseHistory
      // above), so this doesn't attempt to go further than that existing
      // best-effort model.
      const preTrimSessionSummary = (summaryUpdateNeeded && newSessionSummary)
        ? {
            ...(coachSessionSummary || {}),
            sessionSummary: newSessionSummary,
            // summaryCoveredThroughIndex, not rawWindowStart — see its
            // declaration above. Equal unless this turn's pending batch was
            // truncated for length, in which case a later turn's
            // needsSummaryUpdate naturally picks up the remainder.
            summarizedThroughIndex: summaryCoveredThroughIndex,
            summaryUpdatedAt: Date.now(),
            summaryVersion: (coachSessionSummary?.summaryVersion || 0) + 1,
          }
        : coachSessionSummary;

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
      const { history: savedWithReply, coachSessionSummary: finalSessionSummary, removedCount: historyRemovedCount } =
        trimChatHistoryWithCursor(withReply, MAX_DB_HISTORY, preTrimSessionSummary);
      saveSubPath("chatHistory", savedWithReply);

      // A fresh summary written this turn keeps using the locally-computed
      // value (rawWindowStart-relative — see preTrimSessionSummary's comment
      // on the accepted concurrent-write limitation).
      //
      // Uses the ref, not the mount-time cloudSyncUnconfirmed closure value:
      // this whole try block resolves after `await callAI(...)`, which can
      // take several seconds, so sync can confirm or drop mid-flight —
      // exactly the staleness class cloudSyncUnconfirmedRef exists for
      // elsewhere in this file (the nudge-delivery closure), missed here
      // across every previous round (code-review finding, PR #347).
      //
      // A fresh summary that can't be persisted right now (sync unconfirmed)
      // is skipped outright rather than deferred like a pure cursor
      // decrement: deferring the full text correctly would mean every read
      // site also needs to see a pending localStorage-shadowed value
      // instead of the stale config.coachSessionSummary it currently reads,
      // a bigger change than warranted for how rarely this exact branch
      // fires. It's naturally retried on a later turn that legitimately
      // needs an update once sync confirms and reads see the real config
      // again.
      const freshSummaryWrittenThisTurn = summaryUpdateNeeded && !!newSessionSummary;
      const sessionSummaryChanged = freshSummaryWrittenThisTurn && !cloudSyncUnconfirmedRef.current;
      if (configPatch || memoryPatch || rescueHandoffSummaryUsedAt !== null || sessionSummaryChanged) {
        // saveConfigPatch merges onto the latest known config and writes only
        // these keys — safe even if this tab unmounted and configRef.current
        // is now stale (e.g. the user changed Coach Memory settings elsewhere
        // while this reply was in flight). memoryPatch and the rescue-handoff
        // clear are both resolved against the latest config (see above).
        saveConfigPatch((latestConfig) => ({
          ...configPatch,
          ...clearRescueHandoffIfUnchanged(latestConfig),
          ...(memoryPatch ? { coachMemory: memoryPatch(latestConfig) } : {}),
          ...(sessionSummaryChanged ? { coachSessionSummary: finalSessionSummary } : {}),
        }));
      }
      // Deferred (not skipped) whenever the fresh-summary write above did
      // NOT actually persist — either no fresh summary was computed this
      // turn (pure cap-trim case), or one WAS computed but couldn't be
      // written because sync was unconfirmed. historyRemovedCount is purely
      // a function of withReply.length and MAX_DB_HISTORY (see
      // trimChatHistoryWithCursor), identical either way — only the
      // cursor's TEXT differs, not how much the trim itself removed.
      // Without this check being `!sessionSummaryChanged` (rather than the
      // narrower `!freshSummaryWrittenThisTurn` used previously), a fresh-
      // summary-but-unconfirmed turn silently dropped BOTH the write and
      // the decrement, permanently desyncing the cursor from chatHistory
      // (which is trimmed unconditionally via saveSubPath above) — code-
      // review finding, PR #347. Recomputed against latestConfig when
      // applied immediately, so it can't clobber a same-session proactive-
      // nudge save that also trimmed around the same time (loopcheck
      // finding, PR #347). Includes earlyRemovedCount (the early trim's own
      // decrement, never separately persisted — see its declaration above)
      // so this single write/deferral correctly reflects BOTH trims
      // relative to the still-unadjusted remote value.
      if (!sessionSummaryChanged) {
        applyOrDeferCursorDecrement(historyRemovedCount + earlyRemovedCount, cloudSyncUnconfirmedRef.current);
      }
    } catch (err) {
      console.error("[CoachTab] AI chat failed:", err);
      const hint = describeAIError(err);

      const currentHistory = chatHistoryRef.current || [];
      const hasUserMsg = currentHistory.length > 0 &&
                         currentHistory[currentHistory.length - 1].isUser &&
                         currentHistory[currentHistory.length - 1].text === userText;
      const baseHistory = hasUserMsg ? currentHistory : savedHistory;

      const withError = [...baseHistory, { text: hint, isUser: false }];
      // No reply was generated this turn, so there's nothing to fold into
      // the summary — only the 40-cap trim (if any) can still apply.
      const { history: savedWithError, removedCount } =
        trimChatHistoryWithCursor(withError, MAX_DB_HISTORY, coachSessionSummary);
      saveSubPath("chatHistory", savedWithError);
      // Deferred (not skipped) while sync is unconfirmed — see
      // applyOrDeferCursorDecrement's declaration above for why. Includes
      // earlyRemovedCount for the same reason as the main success path
      // above — the early trim's own decrement is never separately
      // persisted. Uses the ref, not the mount-time cloudSyncUnconfirmed
      // closure value — this catch block also runs after `await
      // callAI(...)` (code-review finding, PR #347).
      applyOrDeferCursorDecrement(removedCount + earlyRemovedCount, cloudSyncUnconfirmedRef.current);
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
        maxTokens: 800,
        reasoningEffort: "low"
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
              onClick={() => setConfirmDialog({ message: "Clear all chat history?", confirmLabel: "Clear", danger: true, onConfirm: () => { saveSubPath("chatHistory", null); clearSessionSummaryDeferredIfNeeded(); const uId = auth?.currentUser?.uid || "signed-out"; localStorage.removeItem(`loci_last_coach_plan_${uId}`); localStorage.removeItem(`loci_last_full_task_time_${uId}`); localStorage.removeItem("loci_last_coach_plan"); localStorage.removeItem("loci_last_full_task_time"); setConfirmDialog(null); }, onCancel: () => setConfirmDialog(null) })}
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
                    if (ok) {
                      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
                      setCopiedMsgIdx(idx);
                      copyTimeoutRef.current = setTimeout(() => {
                        setCopiedMsgIdx(curr => (curr === idx ? null : curr));
                        copyTimeoutRef.current = null;
                      }, 1500);
                    }
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
                      <LinkifyText text={task.title} />
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
