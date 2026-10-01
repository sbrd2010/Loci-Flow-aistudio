import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { track, auth } from "../firebase";
import { callAI, describeAIError, getAIKeys, hasAIKey } from "../utils/aiCall";
import { getCoachNudge, resolveCoachNudge, buildCoachNudgeDeliveredConfig } from "../utils/coachNudge";
import { buildLocalSafetyReply } from "../utils/crisisSafety";
import { isEventTask } from "../utils/dayMapRoute";
import ConfirmDialog from "./ConfirmDialog";
import { profileToCoachContext } from "../utils/userProfile";
import { buildLociCoreInstruction, buildLociTaskContext, buildLociAnchorsContext, buildLociCheckinContext, buildLociClosingContext, buildLociFocusSessionContext, buildLociNowFocusContext, buildLociDeadlineContext, buildLociDayMapContext, buildLociBrainDumpContext, buildLociVelocityContext, buildLociRemindersContext, buildLociRecentlyParkedContext, buildLociRecentlyCompletedContext, buildLociCategoryFilterContext, buildLociTodaySnapshotContext, getLocalDateString, isActiveLociTask } from "../utils/lociAIContext";
import { getLociDayStr } from "../utils/dailyAnchors";
import { getFocusWindows } from "../utils/focusWindows";
import { safeUUID } from "../utils/uuid";
import CoachReview from "./CoachReview";
import CoachBrief from "./CoachBrief";
import SplitTaskSheet from "./SplitTaskSheet";
import { buildBriefInput, BRIEF_SYSTEM_PROMPT, parseBrief, moveTaskToHorizon, undoMoveTask, briefToText } from "../utils/coachBrief";
import { buildSplit, undoSplit } from "../utils/splitTask";
import { horizonsFromConfig } from "../utils/horizons";
import { requestNotifPermission } from "../utils/focusNotifications";
import { scheduleCoachCheckin } from "../utils/reminders";
import { parseCheckinTag, pickCheckinNote, buildCoachCheckin, isCheckinDue, parseCheckinRequestFromMessage, buildCoachCheckinContext } from "../utils/coachCheckin";
import { parseCoachActionTags, applyCoachActions, buildActionReplyText, buildSetNowFocusTasks, buildParkTaskTasks, findTaskByTitle, undoCoachAction } from "../utils/coachActions";
import { shouldDeliverPendingCoachNudge } from "../utils/coachNudge";
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
import { buildTaskMutationEvent, buildFocusStartedEvent, buildFocusTerminalEvent, eventPatch, eventsPatch } from "../utils/activityLog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import "../styles/coachUI.css";
import { isOnToday } from "../utils/deferral";
import { focusBlockSeconds } from "../utils/focusSession";

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

const NO_MESSAGES = [];
// Q50: the button under a reply, and what it reads once applied.
const COACH_ACTION_LABELS = { COMPLETE_TASK: "Mark done", SET_NOW_FOCUS: "Make it the one thing", START_FOCUS: "Start focus", ADD_TASK: "Add to Today", PARK_TASK: "Park" };
const COACH_ACTION_DONE = { COMPLETE_TASK: "Marked done", SET_NOW_FOCUS: "The one thing", START_FOCUS: "Focus started", ADD_TASK: "Added", PARK_TASK: "Parked" };
const clockHHMM = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// "Brief · 1 Oct 09:41" (62h).
const briefChipLabel = (brief) => {
  const d = new Date(brief.at);
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${clockHHMM(brief.at)}`;
};

export default function CoachTab({ payload, savePayload, savePayloadAsync, saveSubPath, saveSubPaths, saveSubPathsAsync, saveConfigPatch, userProfile, focusTimer = {}, isSyncingFromCache = false, syncWarning = null, chatDraft = "", setChatDraft = () => {}, uid, writeActivityEvents, stuck = null, onClearStuck, onBackToFocus }) {
  const { tasks = [], config = {}, brainDump = [], contributions = [] } = payload;
  const windows = getFocusWindows(config);
  // "Today" is the Loci day: a task moved to tomorrow stays off it until the
  // focus window ends, even one that runs past midnight.
  const lociDayNow = () => getLociDayStr(new Date(), windows);
  const { groqKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
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
  // 62j: an empty conversation shows its own empty state; Coach doesn't
  // speak first.
  const chatHistory = payload.chatHistory || NO_MESSAGES;
  // Q50: "Coach" everywhere; Settings → Coach → Name replaces the word only
  // in the kicker and the placeholder.
  const coachName = config.mentorName || "Coach";
  const [coachTab, setCoachTab] = useState("chat");

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
  // The chat-action block below runs after `await callAI(...)`, which can
  // take several real seconds — by then the `focusTimer` this closure
  // captured at send-time is stale (isTimerRunning/activeTask/timerSecondsLeft
  // etc. reflect however things were before the wait, not now). Read
  // focusTimerRef.current instead of the closed-over `focusTimer` for that
  // block's session-ending/session-starting decisions, same reason
  // tasksRef/configRef/contributionsRef exist above.
  const focusTimerRef = useRef(focusTimer);
  focusTimerRef.current = focusTimer;
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
  const deliveringNudgeRef = useRef(false);
  useEffect(() => {
    // Defer to App's Coach Check-In resume effect if it's also acting on
    // this tick — both write a fresh `config`/`chatHistory` snapshot, so
    // running both here would let one clobber the other. The nudge stays
    // pending and is picked up on a later mount.
    if (isCheckinDue(configRef.current.coachCheckin)) return;

    // J3 moved the proactive nudge off Today: "it never appears unprompted on
    // Today. The same logic renders as the first line of the Coach transcript
    // when Coach is opened." Today used to compute it, show a card, and hand it
    // over here only if tapped — so with that card gone, Coach has to derive it
    // itself or the nudge would simply never reach anyone.
    //
    // A pending one still wins: it carries the context of whatever the user
    // acted on, and it may name a reason that is no longer derivable.
    //
    // getCoachNudge already returns null under Low Energy and when the day's
    // nudge has been cleared, so neither is re-checked here.
    // resolveCoachNudge judges a pending hand-off stale BEFORE letting it win
    // — see its comment for why that ordering is the whole point.
    const pending = configRef.current.pendingCoachNudge;
    const { nudge, pendingIsStale } = resolveCoachNudge({
      pending,
      derived: getCoachNudge(payload, new Date()),
      payload,
    });
    if (!shouldDeliverPendingCoachNudge(nudge, deliveredNudgeRef.current)) {
      // A stale hand-off with nothing to replace it still has to be swept, or
      // it sits in config and is re-evaluated on every open forever.
      if (pendingIsStale && !cloudSyncUnconfirmedRef.current) saveConfigPatch({ pendingCoachNudge: null });
      return;
    }
    // Defer until cloud sync is confirmed — saveConfigPatch() before the
    // first RTDB snapshot stamps a still-cached config as "newest" (see
    // saveConfigPatch in useSync.js), which could overwrite newer config
    // synced from another device. cloudSyncUnconfirmed is in this effect's
    // deps, so once sync confirms this re-runs and delivers the still-pending
    // nudge — it isn't dropped until the next mount.
    if (cloudSyncUnconfirmedRef.current) return;
    // A derived nudge is a fresh object on every effect invocation, so the
    // identity check above cannot catch StrictMode's double-invoke the way it
    // does for one read from config. This does. It is set only past the
    // deferral above — setting it before would make a nudge deferred during
    // the cache-sync window undeliverable when this re-runs.
    if (deliveringNudgeRef.current) return;
    deliveringNudgeRef.current = true;
    deliveredNudgeRef.current = nudge;
    // Clearing is what makes this once per loci day. Today used to write this
    // when the card was dismissed or acted on; with the card gone, delivering
    // here is the moment the day's nudge is spent. Without it getCoachNudge
    // would hand back the same signal on every single open of this tab — a
    // nudge that interrupts every visit is worse than the card ever was.
    // Delivering is the moment the day's nudge is spent — and, for the
    // expired-deadline follow-up, the moment it was asked. Today's deleted
    // handler used to record both.
    saveConfigPatch(buildCoachNudgeDeliveredConfig(nudge, configRef.current, payload, new Date()));

    const deliver = (text, voiced) => {
      const withReply = [...chatHistoryRef.current, { text, isUser: false, at: Date.now() }];
      const { history: savedWithReply, removedCount } =
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

    // Hold the composer while the opening line is in flight. handleSendChat
    // bails on chatLoading, so this serializes the two paths: without it a
    // message typed during the nudge's request produces two independent
    // replies, each saving a whole chatHistory array built from its own
    // (by then stale) chatHistoryRef — so the "opening" line can land after
    // the exchange it was meant to open, or clobber the reply to it. Rare
    // before J3, when the nudge only arrived if handed off from Today;
    // routine now that Coach derives one on every open.
    setChatLoading(true);
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
          groqKey, geminiKey, cerebrasKey, zaiKey,
          systemPrompt: systemInstruction,
          messages: [{ role: "user", content: "(Start the conversation.)" }],
          maxTokens: 120,
          reasoningEffort: "low"
        });
        deliver(reply.trim(), true);
      } catch (_) {
        deliver(nudge.body, false);
      } finally {
        setChatLoading(false);
      }
    })();
  }, [cloudSyncUnconfirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Applies what a tapped action button changed (Q50), with the same ledger
  // and focus-session bookkeeping a Coach action has always had. `extraPatch`
  // rides along in the same write (the reply's button state). Returns the
  // focus session it started, or null.
  const commitCoachActions = (updatedPayload, results, now, extraPatch = {}) => {
    const patch = { ...extraPatch };
    if (updatedPayload.tasks !== tasksRef.current) patch.tasks = updatedPayload.tasks;
    if (updatedPayload.contributions !== contributionsRef.current) patch.contributions = updatedPayload.contributions;
    if (Object.keys(patch).length > 0) {
      // Only ADD_TASK/COMPLETE_TASK/PARK_TASK map to a ledger event type —
      // SET_NOW_FOCUS/START_FOCUS pin changes are handled separately below
      // (focus session bookkeeping, not a tracked mutation type). Passing
      // `now: now.getTime()` (the message-send time, same value already
      // given to applyCoachActions above for lociDateStr/todayStr) keeps
      // this event's lociDateString consistent with the core mutation's
      // own dateCompletedString/contributions day — without it, a slow
      // AI reply crossing a Loci-day boundary would date the ledger event
      // under a LATER day than the mutation it describes.
      const eventTypeByAction = { ADD_TASK: "task_created", COMPLETE_TASK: "task_completed", PARK_TASK: "task_parked" };
      const events = results
        .filter(r => r.matched && r.task && eventTypeByAction[r.type])
        .map(r => buildTaskMutationEvent(eventTypeByAction[r.type], r.task, { windows, source: "coach_action", now: now.getTime() }));
      // COMPLETE_TASK/PARK_TASK clear isNowFocus on the matched task
      // (buildToggleCompletedTasks/buildParkTaskTasks) — if that task was
      // the one actively focused, end its session here so the ledger
      // isn't left open with no terminal event (same bug class fixed for
      // TodayTab's handleToggleComplete/handleMoveToHorizon).
      const focusEndingResult = results.find(r =>
        r.matched && r.task?.isNowFocus && (r.type === "COMPLETE_TASK" || r.type === "PARK_TASK")
        && typeof focusTimerRef.current.endFocusSession === "function"
      );
      if (focusEndingResult) {
        const endedFocusSession = focusTimerRef.current.endFocusSession(focusEndingResult.type === "COMPLETE_TASK" ? "completed_task" : "user_abandoned");
        if (endedFocusSession) {
          // Use endedFocusSession.task, not focusEndingResult.task — if a
          // pin-only path moved Now Focus while the open session still
          // belonged to a previous task, this call actually closed out
          // that older session, which may not be the matched task.
          events.push(buildFocusTerminalEvent(
            focusEndingResult.type === "COMPLETE_TASK" ? "focus_completed" : "focus_abandoned",
            endedFocusSession.task, endedFocusSession.focusSessionId,
            // No explicit `now` — default to a fresh Date.now() here, at
            // the moment the session is actually ended, not `now` (the
            // message-send time captured before `await callAI(...)`,
            // which can take several real seconds).
            { ...endedFocusSession, windows }
          ));
        }
      }

      // SET_NOW_FOCUS retargets the pin (buildSetNowFocusTasks) the same
      // way applyTaskChip's 'focus'/'focus+today' chips do — if a
      // different task's session was open before this action ran, end it
      // too. (START_FOCUS's own retargeting is handled below, since it
      // also needs to mint a new session rather than just closing the old
      // one.) focusTimerRef.current.activeTask here still reflects the PRE-action
      // pin, since `tasks` hasn't re-rendered from this synchronous block yet.
      const setNowFocusResult = results.find(r => r.type === "SET_NOW_FOCUS" && r.matched);
      if (setNowFocusResult && focusTimerRef.current.activeTask && focusTimerRef.current.activeTask.uuid !== setNowFocusResult.task.uuid && typeof focusTimerRef.current.endFocusSession === "function") {
        const retargetedFocusSession = focusTimerRef.current.endFocusSession("user_abandoned");
        // Retargeting to a DIFFERENT task doesn't make activeTask null,
        // so the hook's own "stop timer when activeTask disappears"
        // effects never fire.
        if (retargetedFocusSession) {
          focusTimerRef.current.setIsTimerRunning?.(false);
          focusTimerRef.current.setIsFocusMode?.(false);
          focusTimerRef.current.setFocusSessionActive?.(false);
        }
        if (retargetedFocusSession) {
          // No explicit `now` — see the same fix above for why message-
          // send time is wrong for an event built after `await callAI(...)`.
          events.push(buildFocusTerminalEvent("focus_abandoned", retargetedFocusSession.task, retargetedFocusSession.focusSessionId, {
            ...retargetedFocusSession, windows,
          }));
        }
      }

      const startFocus = results.find(r => r.type === "START_FOCUS" && r.matched);
      // Captured so the saveSubPathsAsync(patch) rejection handler below
      // can undo this exact session if the core pin write never confirms.
      let startedFocusSession = null;
      if (startFocus) {
        const isSwitchingTask = focusTimerRef.current.activeTask?.uuid !== startFocus.task.uuid;
        if (!focusTimerRef.current.isTimerRunning || isSwitchingTask) {
          // A duration the Coach names, else one block (53e) — not the estimate.
          const mins = Number(startFocus.durationMinutes) > 0 ? Number(startFocus.durationMinutes)
            : focusBlockSeconds(config) / 60;
          // Also mint a session when the target is already pinned but no
          // session is currently open (e.g. it was only ever pinned via
          // SET_NOW_FOCUS, or a prior session already ended) — not just
          // when switching to a different task, or this Coach-started
          // session would still go unlogged.
          const needsNewSession = isSwitchingTask || !focusTimerRef.current.focusSessionId;
          if (needsNewSession && typeof focusTimerRef.current.startFocusSession === "function") {
            // A genuinely new focused task — mint a real ledger session for
            // it (enterFocusMode: false so the chat stays open instead of
            // being replaced by the full-screen Focus overlay), auto-closing
            // whatever session was previously open the same way Day Map's
            // "Start Focus" does. Collected into `events` below and written
            // only once the core pin write (saveSubPathsAsync(patch))
            // actually confirms, instead of immediately.
            const session = focusTimerRef.current.startFocusSession(startFocus.task, { enterFocusMode: false, plannedSeconds: mins * 60 });
            startedFocusSession = session;
            if (session.priorSession && session.priorSession.task) {
              // No explicit `now` — same fix as above.
              events.push(buildFocusTerminalEvent("focus_abandoned", session.priorSession.task, session.priorSession.focusSessionId, {
                ...session.priorSession, windows,
              }));
            }
            events.push(buildFocusStartedEvent(startFocus.task, session.focusSessionId, {
              focusInitialPlannedSeconds: session.focusInitialPlannedSeconds, now: session.focusStartedAt, windows, source: "coach_action",
            }));
          } else if (typeof focusTimerRef.current.extendTimer === "function") {
            // Same task, just resuming/restarting from a paused state — any
            // ledger session already open for it stays open under its own
            // focusSessionId, so don't mint a new one here.
            focusTimerRef.current.extendTimer(mins);
          }
        }
      }

      saveSubPathsAsync(patch)
        .then(() => { if (events.length > 0) writeActivityEvents(eventsPatch(uid, events)); })
        .catch(() => {
          // The core pin write never confirmed — undo the optimistic
          // session start above, or it's left open with no focus_started
          // event for a later endFocusSession call to surface as an
          // orphaned terminal event. Only if nothing newer has already
          // started (live-ref check, not a stale closure value).
          if (startedFocusSession && focusTimerRef.current.focusSessionId === startedFocusSession.focusSessionId) {
            focusTimerRef.current.endFocusSession?.("user_abandoned");
            focusTimerRef.current.setIsTimerRunning?.(false);
            focusTimerRef.current.setIsFocusMode?.(false);
            focusTimerRef.current.setFocusSessionActive?.(false);
          }
        });
      // The session this commit started, if any — Undo may end only that one.
      return startedFocusSession;
    }
    return null;
  };

  // Q50: a reply's action is a button. A tap applies it, and the button
  // becomes "✓ Marked done · task" with Undo for this session.
  const [actionUndo, setActionUndo] = useState({});
  // Each offered action has its own id (indexes shift when old messages are
  // trimmed). `update` maps that action, or every action of its reply.
  const withActionState = (history, actionId, update, wholeReply = false) => history.map(m => (
    m.isUser || !m.actions?.some(a => a.id === actionId) ? m
      : { ...m, actions: m.actions.map(a => (wholeReply || a.id === actionId ? update(a) : a)) }
  ));
  const handleCoachAction = (actionId) => {
    // Not until the cloud has answered once: a tap writes whole task lists,
    // and from an unconfirmed cache that could overwrite newer changes made
    // on another device.
    if (cloudSyncUnconfirmed || !actionId) return;
    const history = chatHistoryRef.current;
    const a = history.flatMap(m => (m.isUser ? [] : m.actions || [])).find(x => x.id === actionId);
    if (!a || a.state !== "proposed") return;
    const now = new Date();
    const prevPinnedUuid = tasksRef.current.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted)?.uuid || null;
    // The very task the reply offered, by id (it may have been renamed). If it
    // is done, deleted or parked since, the offer is gone: never re-match by
    // title, which could hit another task.
    const fresh = a.task?.uuid ? tasksRef.current.find(t => t.uuid === a.task.uuid && isActiveLociTask(t)) : null;
    const localDateStr = getLocalDateString(now);
    const { payload: updatedPayload, results } = applyCoachActions(
      { ...payload, tasks: tasksRef.current, config: configRef.current, contributions: contributionsRef.current },
      [{ type: a.type, title: fresh?.title || a.title, ...(fresh ? { taskUuid: fresh.uuid } : {}), ...(a.durationMinutes != null ? { durationMinutes: a.durationMinutes } : {}) }],
      { lociDateStr: getLociDayStr(now, getFocusWindows(configRef.current)), localDateStr, now: now.getTime(), skipIntentCheck: true }
    );
    const r = a.type !== "ADD_TASK" && !fresh ? null : results[0];
    const state = r?.matched ? "applied" : "gone";
    const nextHistory = withActionState(history, actionId, x => ({ ...x, state }));
    if (!r?.matched) { saveSubPathsAsync({ chatHistory: nextHistory }).catch(() => {}); return; }
    const started = commitCoachActions(updatedPayload, results, now, { chatHistory: nextHistory });
    // Start focus on a task whose session was already open (running, or
    // resumed from a pause) started nothing new, so there's nothing to undo.
    if (a.type === "START_FOCUS" && !started) return;
    // Undo puts back only this change: it checks the task is as the tap left it.
    const appliedLastUpdated = updatedPayload.tasks.find(t => t.uuid === r.task.uuid)?.lastUpdated ?? null;
    setActionUndo(u => ({ ...u, [actionId]: { type: a.type, taskUuid: r.task.uuid, prevPinnedUuid, localDateStr, appliedLastUpdated, focusSessionId: started?.focusSessionId || null } }));
  };
  const handleUndoCoachAction = (actionId) => {
    const key = actionId;
    const rec = actionUndo[key];
    // Undo writes whole lists too: the same wait for the cloud as a tap.
    if (!rec || cloudSyncUnconfirmed) return;
    setActionUndo(u => { const next = { ...u }; delete next[key]; return next; });
    const next = undoCoachAction({ ...payload, tasks: tasksRef.current, contributions: contributionsRef.current }, rec);
    if (!next) return; // the task has moved on since; nothing to put back
    if (rec.type === "START_FOCUS" && rec.focusSessionId && focusTimerRef.current.focusSessionId === rec.focusSessionId) {
      const ended = focusTimerRef.current.endFocusSession?.("user_abandoned");
      focusTimerRef.current.setIsTimerRunning?.(false);
      focusTimerRef.current.setIsFocusMode?.(false);
      focusTimerRef.current.setFocusSessionActive?.(false);
      if (ended) writeActivityEvents(eventsPatch(uid, [buildFocusTerminalEvent("focus_abandoned", ended.task, ended.focusSessionId, { ...ended, windows })]));
    }
    const patch = {
      chatHistory: withActionState(chatHistoryRef.current, actionId, x => ({ ...x, state: "proposed" })),
      tasks: next.tasks,
    };
    if (next.contributions !== contributionsRef.current) patch.contributions = next.contributions;
    const task = next.tasks.find(t => t.uuid === rec.taskUuid);
    const eventType = { COMPLETE_TASK: "task_reopened", ADD_TASK: "task_deleted", PARK_TASK: "task_unparked" }[rec.type];
    saveSubPathsAsync(patch)
      .then(() => { if (eventType && task) writeActivityEvents(eventPatch(uid, buildTaskMutationEvent(eventType, task, { windows, source: "coach_action" }))); })
      .catch(() => {});
  };
  // "Not needed": the reply's buttons go.
  const handleDismissActions = (actionId) => {
    if (cloudSyncUnconfirmed) return;
    saveSubPathsAsync({ chatHistory: withActionState(chatHistoryRef.current, actionId, a => (a.state === "proposed" ? { ...a, state: "dismissed" } : a), true) }).catch(() => {});
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    const pendingChip = chipTextRef.current;
    chipTextRef.current = null;
    const userText = (pendingChip || chatInput).trim();
    if (!userText || chatLoading) return;

    // -- Safety short-circuit, ahead of every other local reply --
    // Coach is a free-text box reaching the same provider as Rescue, and a
    // person in crisis types into whichever box is open. Rescue has answered
    // locally since it was built; Coach had only prompt instructions, which
    // depend on the model complying AND on the request completing at all —
    // and these provider keys rate-limit hard, so a 429 could turn a crisis
    // message into an error. Answering here means the text never leaves the
    // device and the reply is certain.
    const crisisReply = buildLocalSafetyReply(userText, firstName);

    // -- Local Replies Interceptor --
    const lowerText = userText.toLowerCase().replace(/[.?!]/g, "").trim();
    const isHi = /^(hi|hello|hey|hey yoda|hello yoda|hi yoda)$/i.test(lowerText);
    const isThanks = /^(thanks|thank you|thank you yoda|thanks yoda)$/i.test(lowerText);
    const isDay = /^(which day is it|what day is it|what's today|what is today)$/i.test(lowerText);
    const isWho = /^(who are you|what are you|who is yoda)$/i.test(lowerText);
    const isClear = /^(clear chat|clear history|clear conversation)$/i.test(lowerText);
    const isFocus = /^(what is my current focus|what's my current focus|what is my focus|what's my focus|what focus task)$/i.test(lowerText);

    if (crisisReply || isHi || isThanks || isDay || isWho || isClear || isFocus) {
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
      const withUserForLocalReply = [...chatHistory, { text: userText, isUser: true, at: Date.now() }];
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
      if (crisisReply) {
        localReplyText = crisisReply;
      } else if (isHi) {
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
      const replyMsg = { text: localReplyText, isUser: false, at: Date.now() };
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
    const withUserForTrim = [...chatHistory, { text: userText, isUser: true, at: Date.now() }];
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
      const replyMsg = { text: "🔑 Add an AI key in **Settings → AI Keys** to enable chat.", isUser: false, at: Date.now() };
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
    const todayActive = tasks.filter(t => isOnToday(t, lociDayNow()) && isActiveLociTask(t));
    const taskContext = buildLociTaskContext(tasks, new Date(), getFocusWindows(config));
    const todayStr = getLociDayStr(new Date(), getFocusWindows(config));
    const anchorContext = buildLociAnchorsContext(config.dailyAnchors || []);
    const checkinContext = buildLociCheckinContext(config, tasks, todayStr);
    const focusSessionContext = buildLociFocusSessionContext(focusTimer);
    const nowFocusContext = buildLociNowFocusContext(tasks);
    const deadlineContext = buildLociDeadlineContext(config, now);
    const dayMapContext = buildLociDayMapContext(tasks, todayStr);
    const brainDumpContext = buildLociBrainDumpContext(brainDump);
    const velocityContext = buildLociVelocityContext(contributions, now);
    const remindersContext = buildLociRemindersContext(tasks, now);
    const pendingCheckinContext = buildCoachCheckinContext(config.coachCheckin, now.getTime());
    const recentlyParkedContext = buildLociRecentlyParkedContext(tasks, now);
    const recentlyCompletedContext = cloudSyncUnconfirmed ? "" : buildLociRecentlyCompletedContext(tasks, now);
    const requestedCategories = detectRequestedCategories(userText);
    const categoryFilterContext = buildLociCategoryFilterContext(tasks, requestedCategories, windows);
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
    // Q39.1: the I'm stuck chip goes with this message, then it's spent.
    const stuckContext = stuck
      ? `STUCK IN A FOCUS SESSION: the user opened Coach from "I'm stuck" on "${stuck.title}"${stuck.step ? `, next step "${stuck.step}"` : ""}. The session is paused. This message is about what's in the way.`
      : "";
    if (stuck) onClearStuck?.();
    // 62h: "Ask about this" attaches the brief to this message, then it clears.
    const briefContext = briefChip
      ? `COACH'S BRIEF the user is asking about (made ${briefChipLabel(briefChip)}):\n${briefToText(briefChip)}`
      : "";
    if (briefChip) setBriefChip(null);

    const userMessageCount = savedHistory.filter(m => m.isUser).length;
    const isEarlyConversation = userMessageCount <= 1;

    const profileBlock = profileToCoachContext(userProfile);
    const currentFocusTitle = cloudSyncUnconfirmed ? null : (tasks.find(t => isActiveLociTask(t) && t.isNowFocus)?.title || null);
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
      todaySnapshotContext: buildLociTodaySnapshotContext(tasks, { dayStr: todayStr, focusTimer, unconfirmed: cloudSyncUnconfirmed, mentionText: userText }),
      focusSessionContext,
      nowFocusContext: cloudSyncUnconfirmed ? "" : nowFocusContext,
      dayMapContext,
      remindersContext,
      anchorContext,
      // 55d–e, 57b.29: the days closed and horizon reviews ride with the check-ins.
      checkinContext: [checkinContext, buildLociClosingContext(config, todayStr)].filter(Boolean).join("\n\n"),
      pendingCheckinContext,
      deadlineContext,
      brainDumpContext,
      velocityContext,
      recentlyParkedContext,
      recentlyCompletedContext,
      categoryFilterContext,
      rescueHandoffContext: [rescueHandoffContext, stuckContext, briefContext].filter(Boolean).join("\n"),
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
      const reply = await callAI({ groqKey, geminiKey, cerebrasKey, zaiKey, systemPrompt: systemInstruction, messages, maxTokens, contextMode, reasoningEffort: "low" });
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
        // Q50: Coach never changes data by itself. The reply only checks which
        // actions would apply; each shows as a button, applied on a tap.
        const { results } = applyCoachActions(
          { ...payload, tasks: tasksRef.current, config: configRef.current, contributions: contributionsRef.current },
          actions,
          { lociDateStr: todayStr, localDateStr: getLocalDateString(now), lastUserMessage: userText, now: now.getTime() }
        );
        actionResults = results.map(r => (r.matched ? { ...r, id: safeUUID(), state: "proposed" } : r));

        // Assembles success/failure narration from the action results — see
        // buildActionReplyText for how blocked-but-stale tags are silently
        // dropped vs. surfaced as a clarifying question.
        replyText = buildActionReplyText(cleanText, results, userText, { proposed: true });
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
        at: Date.now(),
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

      const withError = [...baseHistory, { text: hint, isUser: false, at: Date.now() }];
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

  // Phase B: return a fresh task only when exactly one matched action has a uuid.
  // ADD_TASK is excluded deliberately: applyCoachActions attaches `.task` to
  // ADD_TASK results too (so the activity-ledger write can find the created
  // task without re-deriving it), but that's unrelated to Phase B — before
  // that change ADD_TASK never had `.task` and so never reached here; without
  // this exclusion an ADD_TASK-only reply would newly start showing "Set as
  // Focus"/"Move to Today"/"Park" chips, a real UI behavior change this PR
  // isn't meant to make.
  const taskChipsFor = (actions) => {
    const matched = (actions || []).filter(a => a.matched && a.task?.uuid && a.type !== "ADD_TASK");
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
    // Q36.3: checked again on confirm, not only when the chip was drawn — a
    // sync can fix the task's time while the dialog is open (Codex review
    // of #431).
    if ((action === 'focus' || action === 'focus+today') && isEventTask(task)) return;
    const now = Date.now();
    if (action === 'focus') {
      // Same retargeting gap as 'focus+today' below — end whichever task's
      // session was open before this pin takes over.
      const previouslyFocused = current.find(t => t.uuid !== taskUuid && t.isNowFocus);
      const endedFocusSession = previouslyFocused && typeof focusTimer.endFocusSession === "function"
        ? focusTimer.endFocusSession("user_abandoned")
        : null;
      // Retargeting to a DIFFERENT task doesn't make activeTask null, so the
      // hook's own "stop timer when activeTask disappears" effects never fire.
      if (endedFocusSession) {
        focusTimer.setIsTimerRunning?.(false);
        focusTimer.setIsFocusMode?.(false);
        focusTimer.setFocusSessionActive?.(false);
      }
      savePayloadAsync({ ...payload, tasks: buildSetNowFocusTasks(current, taskUuid, now) })
        .then(() => {
          if (endedFocusSession) {
            const abandonEvent = buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now });
            writeActivityEvents(eventPatch(uid, abandonEvent));
          }
        })
        .catch(() => {});
    } else if (action === 'focus+today') {
      const todayActive = current.filter(t => t.horizonLevel === 'today' && !t.isDeleted);
      const maxOrder = todayActive.reduce((m, t) => Math.max(m, t.orderIndex ?? 0), -1);
      const event1 = buildTaskMutationEvent("task_moved", task, {
        fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: "today" }, windows, source: "coach_action", now,
      });
      // Retargeting focus to `task` clears isNowFocus on whichever task
      // currently holds it — if a real session is open for that task, end it
      // here or it's left orphaned with no terminal event when this new pin
      // takes over. (The new pin itself doesn't start a timer, so it doesn't
      // mint its own session, same as the chat SET_NOW_FOCUS tag.)
      const previouslyFocused = current.find(t => t.uuid !== taskUuid && t.isNowFocus);
      const endedFocusSession = previouslyFocused && typeof focusTimer.endFocusSession === "function"
        ? focusTimer.endFocusSession("user_abandoned")
        : null;
      // Retargeting to a DIFFERENT task doesn't make activeTask null, so the
      // hook's own "stop timer when activeTask disappears" effects never fire.
      if (endedFocusSession) {
        focusTimer.setIsTimerRunning?.(false);
        focusTimer.setIsFocusMode?.(false);
        focusTimer.setFocusSessionActive?.(false);
      }
      // This also unparks `task` if it was parked — record that transition too.
      const wasParked = !!task.isParked;
      savePayloadAsync({ ...payload, tasks: current.map(t => {
        if (t.uuid === taskUuid) return { ...t, horizonLevel: 'today', deferredUntil: null, isNowFocus: true, isParked: false, orderIndex: maxOrder + 1, lastUpdated: now };
        return t.isNowFocus ? { ...t, isNowFocus: false, lastUpdated: now } : t;
      })})
        .then(() => {
          const events = [event1];
          if (endedFocusSession) {
            events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
          }
          if (wasParked) {
            events.push(buildTaskMutationEvent("task_unparked", task, { windows, source: "coach_action", now }));
          }
          writeActivityEvents(eventsPatch(uid, events));
        })
        .catch(() => {});
    } else if (action === 'today') {
      const todayActive = current.filter(t => t.horizonLevel === 'today' && !t.isDeleted);
      const maxOrder = todayActive.reduce((m, t) => Math.max(m, t.orderIndex ?? 0), -1);
      const event2 = buildTaskMutationEvent("task_moved", task, {
        fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: "today" }, windows, source: "coach_action", now,
      });
      // This clears `task`'s own isNowFocus (moving it to Today without
      // pinning it as focus) — end its session here if it was the one
      // actively focused, same as the 'park' branch below.
      const endedFocusSession = task.isNowFocus && typeof focusTimer.endFocusSession === "function"
        ? focusTimer.endFocusSession("user_abandoned")
        : null;
      // This also unparks `task` if it was parked — record that transition too.
      const wasParked = !!task.isParked;
      savePayloadAsync({ ...payload, tasks: current.map(t =>
        t.uuid === taskUuid
          ? { ...t, horizonLevel: 'today', deferredUntil: null, isNowFocus: false, isParked: false, orderIndex: maxOrder + 1, lastUpdated: now }
          : t
      )})
        .then(() => {
          const events = [event2];
          if (endedFocusSession) {
            events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
          }
          if (wasParked) {
            events.push(buildTaskMutationEvent("task_unparked", task, { windows, source: "coach_action", now }));
          }
          writeActivityEvents(eventsPatch(uid, events));
        })
        .catch(() => {});
    } else if (action === 'park') {
      const event3 = buildTaskMutationEvent("task_parked", task, { windows, source: "coach_action", now });
      // buildParkTaskTasks clears isNowFocus on the parked task — end its
      // session here if it was the one actively focused.
      const endedFocusSession = task.isNowFocus && typeof focusTimer.endFocusSession === "function"
        ? focusTimer.endFocusSession("user_abandoned")
        : null;
      savePayloadAsync({ ...payload, tasks: buildParkTaskTasks(current, taskUuid, now) })
        .then(() => {
          const events = [event3];
          if (endedFocusSession) {
            events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
          }
          writeActivityEvents(eventsPatch(uid, events));
        })
        .catch(() => {});
    }
  };

  // -- Coach's brief (Q51, 62a–g) --------------------------------------------
  // Runs only on "Brief me"; only the latest is kept (synced, config.coachBrief).
  const [briefStatus, setBriefStatus] = useState("idle");
  const [briefError, setBriefError] = useState("");
  // "Ask about this": the brief rides along with the next Chat message (62h).
  const [briefChip, setBriefChip] = useState(null);
  const handleBriefMe = async (focusRaw, frontNameOf) => {
    if (briefStatus === "running") return;
    if (!hasAnyKey) { setBriefStatus("error"); setBriefError("Add an AI key in Settings → AI provider to use Coach’s brief."); return; }
    setBriefStatus("running");
    setBriefError("");
    const now = new Date();
    const { refs, data } = buildBriefInput({
      tasks: tasksRef.current, contributions: contributionsRef.current, config: configRef.current,
      focusRaw, now, windows: getFocusWindows(configRef.current), frontNameOf,
    });
    try {
      const reply = await callAI({
        groqKey, geminiKey, cerebrasKey, zaiKey,
        systemPrompt: BRIEF_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(data) }],
        maxTokens: 900,
        reasoningEffort: "low",
      });
      const brief = parseBrief(reply, refs, Date.now());
      if (!brief) throw new Error("unreadable brief");
      saveConfigPatch({ coachBrief: brief });
      setBriefStatus("idle");
    } catch (err) {
      console.error("[CoachTab] Coach's brief failed:", err);
      setBriefStatus("error");
      setBriefError("Couldn’t reach Coach. Try again.");
    }
  };
  const handleAskAboutBrief = (brief) => {
    setBriefChip(brief);
    setCoachTab("chat");
  };
  // A brief's buttons (Q50): each applies on the tap and returns its Undo.
  const handleBriefMove = (uuid, to) => {
    if (cloudSyncUnconfirmed) return null;
    const task = tasksRef.current.find(t => t.uuid === uuid);
    const moved = moveTaskToHorizon(tasksRef.current, uuid, to);
    if (!task || !moved) return null;
    if (task.isNowFocus && focusTimerRef.current.activeTask?.uuid === uuid) {
      const ended = focusTimerRef.current.endFocusSession?.("user_abandoned");
      focusTimerRef.current.setIsTimerRunning?.(false);
      focusTimerRef.current.setIsFocusMode?.(false);
      focusTimerRef.current.setFocusSessionActive?.(false);
      if (ended) writeActivityEvents(eventsPatch(uid, [buildFocusTerminalEvent("focus_abandoned", ended.task, ended.focusSessionId, { ...ended, windows })]));
    }
    const event = buildTaskMutationEvent("task_moved", task, { fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: to }, windows, source: "coach_action" });
    saveSubPathsAsync({ tasks: moved.tasks }).then(() => writeActivityEvents(eventPatch(uid, event))).catch(() => {});
    return () => {
      const back = undoMoveTask(tasksRef.current, uuid, moved);
      if (back) saveSubPathsAsync({ tasks: back }).catch(() => {});
    };
  };
  const handleBriefOneThing = (uuid) => {
    if (cloudSyncUnconfirmed) return null;
    const task = tasksRef.current.find(t => t.uuid === uuid && !t.isDeleted && !t.isCompleted);
    if (!task || isEventTask(task)) return null;
    const now = new Date();
    const prevPinnedUuid = tasksRef.current.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted)?.uuid || null;
    const nextTasks = buildSetNowFocusTasks(tasksRef.current, uuid, now.getTime());
    const pinned = nextTasks.find(t => t.uuid === uuid);
    commitCoachActions({ ...payload, tasks: nextTasks, contributions: contributionsRef.current }, [{ type: "SET_NOW_FOCUS", matched: true, task: pinned }], now);
    const rec = { type: "SET_NOW_FOCUS", taskUuid: uuid, prevPinnedUuid, appliedLastUpdated: pinned.lastUpdated };
    return () => {
      const back = undoCoachAction({ ...payload, tasks: tasksRef.current, contributions: contributionsRef.current }, rec);
      if (back) saveSubPathsAsync({ tasks: back.tasks }).catch(() => {});
    };
  };
  // Split it: the same sheet as Today's; the brief line shows the result.
  const [splitFor, setSplitFor] = useState(null);
  const handleBriefSplit = (uuid, markDone) => {
    if (cloudSyncUnconfirmed) return;
    const task = tasksRef.current.find(t => t.uuid === uuid && !t.isDeleted && !t.isCompleted);
    if (task) setSplitFor({ task, markDone });
  };
  const handleSplitDone = (steps) => {
    const target = splitFor;
    setSplitFor(null);
    const original = target && tasksRef.current.find(t => t.uuid === target.task.uuid && !t.isDeleted);
    if (!original || steps.length < 2) return;
    const actionAt = Date.now();
    const events = [];
    if (original.isNowFocus && focusTimerRef.current.activeTask?.uuid === original.uuid) {
      const ended = focusTimerRef.current.endFocusSession?.("user_abandoned");
      focusTimerRef.current.setIsTimerRunning?.(false);
      focusTimerRef.current.setIsFocusMode?.(false);
      focusTimerRef.current.setFocusSessionActive?.(false);
      if (ended) events.push(buildFocusTerminalEvent("focus_abandoned", ended.task, ended.focusSessionId, { ...ended, windows, now: actionAt }));
    }
    const { tasks: nextTasks, created } = buildSplit(tasksRef.current, original, steps, { now: actionAt, makeId: safeUUID });
    events.push(
      buildTaskMutationEvent("task_deleted", original, { windows, now: actionAt }),
      ...created.map(t => buildTaskMutationEvent("task_created", t, { windows, now: actionAt })),
    );
    saveSubPathsAsync({ tasks: nextTasks }).then(() => writeActivityEvents(eventsPatch(uid, events))).catch(() => {});
    target.markDone(`Split into ${created.length}`, () => {
      saveSubPathsAsync({ tasks: undoSplit(tasksRef.current, original, created.map(t => t.uuid)) }).catch(() => {});
    });
  };

  // -- Render ----------------------------------------------------------------

  const clearConversation = () => {
    saveSubPath("chatHistory", null);
    clearSessionSummaryDeferredIfNeeded();
    const uId = auth?.currentUser?.uid || "signed-out";
    localStorage.removeItem(`loci_last_coach_plan_${uId}`);
    localStorage.removeItem(`loci_last_full_task_time_${uId}`);
    localStorage.removeItem("loci_last_coach_plan");
    localStorage.removeItem("loci_last_full_task_time");
  };
  const startNewConversation = () => setConfirmDialog({
    message: "Start a new conversation? This one is cleared.",
    confirmLabel: "New conversation",
    onConfirm: () => { clearConversation(); setConfirmDialog(null); },
    onCancel: () => setConfirmDialog(null),
  });
  // 62j: a starter chip puts its text in the composer; all but the first
  // send at once, as if typed.
  const handleStarter = (text, send) => {
    if (!send) { setChatInput(text); chatInputRef.current?.focus(); return; }
    if (chatLoading) return;
    // The starter replaces any draft, so nothing stale is left to send later.
    setChatInput("");
    chipTextRef.current = text;
    chatFormRef.current?.requestSubmit();
  };
  const hasConversation = !!(payload.chatHistory && payload.chatHistory.length > 0);
  // The chat column fills the screen from where it starts down to the bottom
  // tab bar (phone), so the messages scroll inside it and the page doesn't.
  const chatColRef = useRef(null);
  useLayoutEffect(() => {
    const col = chatColRef.current;
    if (!col) return undefined;
    // Everything above the column, plus the page's own space below it (its
    // bottom padding, which also clears the phone's tab bar).
    const fit = () => {
      const rect = col.getBoundingClientRect();
      const below = Math.max(0, document.documentElement.scrollHeight - (rect.bottom + window.scrollY));
      col.style.setProperty("--coach-chrome", `${Math.round(rect.top + window.scrollY + below)}px`);
    };
    fit();
    // 62h: the newest message sits at the bottom; opening Chat starts there.
    const win = col.querySelector(".chat-window");
    if (win) win.scrollTop = win.scrollHeight;
    window.addEventListener("resize", fit);
    // Something appearing above the column (the offline banner) moves it
    // without a window resize; the page's size changes, so re-fit then.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    ro?.observe(document.body);
    return () => { window.removeEventListener("resize", fit); ro?.disconnect(); };
  }, [coachTab]);

  return (
    <div className="coach-page">
      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {/* Q51: Coach is two tabs, Chat (first) and Review. */}
      <div className="coach-tabs">
        <div className="coach-tabs-list" role="tablist" aria-label="Coach" onKeyDown={e => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const next = coachTab === "chat" ? "review" : "chat";
          setCoachTab(next);
          document.getElementById(`coach-tab-${next}`)?.focus();
        }}>
          <button type="button" role="tab" id="coach-tab-chat" aria-controls="coach-panel-chat" aria-selected={coachTab === "chat"} tabIndex={coachTab === "chat" ? 0 : -1} className="coach-tab" onClick={() => setCoachTab("chat")}>Chat</button>
          <button type="button" role="tab" id="coach-tab-review" aria-controls="coach-panel-review" aria-selected={coachTab === "review"} tabIndex={coachTab === "review" ? 0 : -1} className="coach-tab" onClick={() => setCoachTab("review")}>Review</button>
        </div>
        {coachTab === "chat" && (
          <span className="coach-tabs-end">
            <span className="coach-tabs-note">Reads your lists. Changes only what you tap.</span>
            {hasConversation && (
              <button type="button" className="coach-new-conversation" onClick={startNewConversation}>New conversation</button>
            )}
          </span>
        )}
      </div>

      {coachTab === "chat" && (
      <section ref={chatColRef} className="coach-chat-col" id="coach-panel-chat" role="tabpanel" aria-labelledby="coach-tab-chat">
        <div className="chat-window coach-chat">
          {!hasConversation && !chatLoading && (
            <div className="coach-empty">
              <h2 className="coach-empty-title">What’s on your mind?</h2>
              <p className="coach-empty-line">Tell Coach what you did, what’s in the way, or ask what to do next.</p>
              <div className="coach-starters">
                {[["I just finished…", false], ["What should I start with?", true], ["I’m overwhelmed", true]].map(([label, send]) => (
                  <button key={label} type="button" className="coach-starter" disabled={chatLoading} onClick={() => handleStarter(send ? label : "I just finished ", send)}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {(() => {
            const lastMentorIdx = chatHistory.reduce((last, m, i) => (!m.isUser ? i : last), -1);
            return chatHistory.map((m, idx) => (
            <div key={idx} className={`coach-msg ${m.isUser ? "is-you" : "is-coach"}`}>
              <span className="coach-msg-kicker">{m.isUser ? "You" : coachName}{m.at ? ` · ${clockHHMM(m.at)}` : ""}</span>
              {m.isUser ? (
                <span className="coach-msg-text">{m.text}</span>
              ) : (
                <ReactMarkdown
                  className="coach-md coach-msg-text"
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
              {!m.isUser && m.actions && m.actions.length > 0 && (() => {
                const proposed = m.actions.filter(a => a.state === "proposed");
                return (
                  <div className="coach-task-chips coach-reply-actions">
                    {m.actions.map((a, i) => {
                      const title = a.task?.title || a.title || "";
                      if (a.state === "proposed") {
                        return (
                          <button key={i} type="button" className="coach-task-chip" disabled={chatLoading || cloudSyncUnconfirmed}
                            onClick={() => handleCoachAction(a.id)}>
                            {COACH_ACTION_LABELS[a.type] || a.type}{proposed.length > 1 ? ` · ${title}` : ""}
                          </button>
                        );
                      }
                      if (a.state === "dismissed") return null;
                      if (a.state === "gone") return <span key={i} className="coach-action-done is-gone">No longer on your list · {title}</span>;
                      // Applied by a tap, or by Coach itself on replies from before Q50.
                      return (
                        <span key={i} className="coach-action-done">
                          ✓ {COACH_ACTION_DONE[a.type] || a.type} · {title}
                          {actionUndo[a.id] && (
                            <button type="button" className="coach-action-undo" disabled={cloudSyncUnconfirmed} onClick={() => handleUndoCoachAction(a.id)}>Undo</button>
                          )}
                        </span>
                      );
                    })}
                    {proposed.length > 0 && (
                      <button type="button" className="coach-prompt-chip" disabled={cloudSyncUnconfirmed} onClick={() => handleDismissActions(proposed[0].id)}>Not needed</button>
                    )}
                  </div>
                );
              })()}
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
              {!m.isUser && idx === lastMentorIdx && !(m.actions || []).some(a => a.state === "proposed") && (() => {
                const task = taskChipsFor(m.actions);
                if (!task) return null;
                const phaseB = [];
                // Q36.3: something at a set time is never the focus.
                if (isEventTask(task)) { /* no focus chip */ }
                else if (isOnToday(task, lociDayNow()) && !task.isNowFocus)
                  phaseB.push({ action: 'focus',       label: 'Make it the one thing' });
                else if (!isOnToday(task, lociDayNow()) && !task.isNowFocus)
                  phaseB.push({ action: 'focus+today', label: 'Today, as the one thing' });
                if (!isOnToday(task, lociDayNow()))
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
            </div>
          ));
          })()}
          {chatLoading && (
            <div className="coach-msg is-coach is-thinking">
              <span className="coach-msg-kicker">{coachName}</span>
              <span className="coach-msg-text">Thinking…</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        <div className="coach-composer-wrap">
          {onBackToFocus && (
            <button type="button" className="coach-back-focus" onClick={onBackToFocus}>← Back to focus</button>
          )}
          <form ref={chatFormRef} onSubmit={handleSendChat} className="chat-input-row coach-composer">
            {briefChip && (
              <span className="coach-stuck-chip">
                Brief · {briefChipLabel(briefChip)}
                <button type="button" className="coach-stuck-remove" onClick={() => setBriefChip(null)} aria-label="Remove the brief">×</button>
              </span>
            )}
            {stuck && (
              <span className="coach-stuck-chip">
                Stuck on: {stuck.title}{stuck.step ? ` · next step: ${stuck.step}` : ""}
                <button type="button" className="coach-stuck-remove" onClick={() => onClearStuck?.()} aria-label="Remove the stuck task">×</button>
              </span>
            )}
            <div className="coach-composer-row">
              <textarea ref={chatInputRef} className="coach-composer-input" rows={1} value={chatInput}
                aria-label={`Ask ${coachName}`}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={briefChip ? "Ask about the brief…" : stuck ? "What's in the way?" : `Ask ${coachName}…`}
                disabled={chatLoading} />
              <button className="coach-send" type="submit" disabled={chatLoading || !chatInput.trim()} aria-label="Send">
                <span className="coach-send-label">Send</span>
                <span className="coach-send-icon" aria-hidden="true">↑</span>
              </button>
            </div>
          </form>
          <div className="coach-composer-hints">
            <span className="coach-hint-keys">Enter sends · Shift+Enter new line</span>
            <span>Coach sees: your lists, focus time, Mind Box and what it remembers</span>
          </div>
        </div>
      </section>
      )}

      {/* Review (Q51): the facts, and Coach's brief beside them. */}
      {coachTab === "review" && (
      <div id="coach-panel-review" role="tabpanel" aria-labelledby="coach-tab-review">
        <CoachReview payload={payload} uid={uid} renderBrief={({ focusRaw, frontNameOf }) => (
          <CoachBrief
            brief={config.coachBrief || null}
            status={briefStatus}
            error={briefError}
            tasks={tasks}
            horizonName={(id) => horizonsFromConfig(config, lociDayNow()).find(h => h.id === id)?.name || id}
            onBriefMe={() => handleBriefMe(focusRaw, frontNameOf)}
            onAsk={handleAskAboutBrief}
            onMove={handleBriefMove}
            onMakeOneThing={handleBriefOneThing}
            onSplit={handleBriefSplit}
            actionsDisabled={cloudSyncUnconfirmed}
          />
        )} />
      </div>
      )}
      {splitFor && <SplitTaskSheet task={splitFor.task} onClose={() => setSplitFor(null)} onSplit={handleSplitDone} />}
    </div>
  );
}
