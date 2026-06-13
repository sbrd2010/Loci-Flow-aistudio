import React, { useState, useEffect, useRef } from "react";
import { callAI, getAIKeys } from "../utils/aiCall";
import ConfirmDialog from "./ConfirmDialog";
import { profileToCoachContext } from "../utils/userProfile";
import { buildLociCoreInstruction, buildLociTaskContext, buildLociAnchorsContext, buildLociCheckinContext, buildLociFocusSessionContext, buildLociNowFocusContext, buildLociDeadlineContext, buildLociDayMapContext, buildLociBrainDumpContext, buildLociVelocityContext, buildLociRemindersContext, buildLociLowEnergyContext, buildLociRecentlyParkedContext, getLocalDateString, isActiveLociTask } from "../utils/lociAIContext";
import { getTodayCheckedIds, getLociDayStr } from "../utils/dailyAnchors";
import { getFocusWindows } from "../utils/focusWindows";
import { requestNotifPermission } from "../utils/focusNotifications";
import { scheduleCoachCheckin, cancelCoachCheckin } from "../utils/reminders";
import { parseCheckinTag, pickCheckinNote, buildCoachCheckin, isCheckinDue, buildCheckinResumeMessage } from "../utils/coachCheckin";
import { parseCoachActionTags, applyCoachActions } from "../utils/coachActions";

export default function CoachTab({ payload, savePayload, saveSubPath, userProfile, focusTimer = {} }) {
  const { tasks = [], config = {}, brainDump = [], contributions = [] } = payload;
  const { groqKey, geminiKey } = getAIKeys();
  const hasAnyKey = !!(groqKey || geminiKey);

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
  const prevHistoryLenRef = useRef(chatHistory.length);

  useEffect(() => {
    // Only scroll when a new message is added — not on tab switch / initial mount
    if (chatHistory.length > prevHistoryLenRef.current || chatLoading) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevHistoryLenRef.current = chatHistory.length;
  }, [chatHistory, chatLoading]);

  // Resume a "Coach Check-In" the user asked for earlier — on mount (came
  // back to this tab) and every minute while it stays open (sitting here
  // when the time arrives).
  const chatHistoryRef = useRef(chatHistory);
  chatHistoryRef.current = chatHistory;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const checkDue = () => {
      const checkin = configRef.current.coachCheckin;
      if (!isCheckinDue(checkin)) return;
      const resumeMsg = buildCheckinResumeMessage(firstName, checkin.note);
      saveSubPath("chatHistory", [...chatHistoryRef.current, { text: resumeMsg, isUser: false }]);
      saveSubPath("config", { ...configRef.current, coachCheckin: null, lastUpdated: Date.now() });
      cancelCoachCheckin();
    };
    checkDue();
    const interval = setInterval(checkDue, 60000);
    return () => clearInterval(interval);
  }, [config.coachCheckin?.fireAt, firstName]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const userMessageCount = withUser.filter(m => m.isUser).length;
    const isEarlyConversation = userMessageCount <= 1;

    const systemInstruction = `${lociCoreInstruction}

You are ${config.mentorName || "Loci AI Coach"}, an expert productivity mentor and motivating friend inside Loci Focus — an app that helps people cut through overwhelm and actually start working.

YOUR CLIENT: ${config.userName || "a user"} — call them "${firstName}". Core challenge: "${challengeLabel}".

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

YOUR PERSONALITY:
- You are a mentor AND a motivating friend. Warm, real, never preachy or lecturing.
- You never criticize, shame, or make the user feel judged. When something isn't working, explore with curiosity — "What made it hard?" not "Why didn't you do it?"
- Honest but kind — you lead with support before challenge. Not a yes-person, but your default is encouragement.
- You celebrate small wins genuinely. A completed task is a real victory. Momentum beats perfection.
- If ${firstName} seems in a difficult emotional place: acknowledge it, don't rush past it.

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
- If ${firstName} explicitly asks to switch focus to, prioritize, or start working on a specific task right now, end your reply with [[SET_NOW_FOCUS:<exact task title from the list above>]] on its own line — AND say what you're doing in your visible reply (e.g., "On it — switching your focus to '<title>'.").
- If ${firstName} explicitly says they finished, completed, or are done with a specific task, end your reply with [[COMPLETE_TASK:<exact task title from the list above>]] on its own line — AND say what you're doing in your visible reply (e.g., "Nice work — marking '<title>' complete!").
- If ${firstName} mentions something new they need to do and asks you to add it as a task, end your reply with [[ADD_TASK:<short task title>]] on its own line — AND say what you're doing (e.g., "Added '<title>' to your Today list."). New tasks default to Today, P3, 25 minutes.
- If ${firstName} explicitly asks to park, defer, or set aside a specific task for now, end your reply with [[PARK_TASK:<exact task title from the list above>]] on its own line — AND say what you're doing (e.g., "Parked '<title>' — it's out of the way for now.").
- If ${firstName} explicitly asks you to start a focus session, start the timer, or start working on a specific task right now, end your reply with [[START_FOCUS:<exact task title from the list above>]] on its own line — AND say what you're doing (e.g., "Starting a focus session on '<title>' now — go!").
- Only use SET_NOW_FOCUS, COMPLETE_TASK, ADD_TASK, PARK_TASK, or START_FOCUS when ${firstName} explicitly asks for that action, and (except for ADD_TASK) only for a task that actually appears in their task list above. Never use them proactively or to guess at what they mean.
- All of these tags are stripped automatically and never shown to ${firstName}. Unlike CHECKIN_IN, these action tags must always be paired with a visible sentence describing the action you took.

LANGUAGE: Never use the word "ADHD". Use instead: focus challenge, overwhelm, execution support, momentum, time awareness, micro-step, reset, low-energy mode.
${profileToCoachContext(userProfile) ? `\n${profileToCoachContext(userProfile)}\n` : ""}
SESSION: ${nowLabel} (${timeOfDay}), ${config.visitStreakCount || 0}-day streak, ${todayActive.length} active tasks today.`;

    const messages = withUser.map(m => ({ role: m.isUser ? "user" : "assistant", content: m.text }));

    try {
      const reply = await callAI({ groqKey, geminiKey, systemPrompt: systemInstruction, messages, maxTokens: 300 });
      const { cleanText: afterCheckin, minutes } = parseCheckinTag(reply.trim());
      const { cleanText, actions } = parseCoachActionTags(afterCheckin);

      let configPatch = null;
      if (minutes != null) {
        const checkin = buildCoachCheckin(minutes, pickCheckinNote(todayActive));
        configPatch = { ...configPatch, coachCheckin: checkin };
        scheduleCoachCheckin(checkin);
        requestNotifPermission();
      }

      let replyText = cleanText;
      if (actions.length > 0) {
        const { payload: updatedPayload, results } = applyCoachActions(
          { ...payload, tasks, config, contributions },
          actions,
          { lociDateStr: todayStr, localDateStr: getLocalDateString(now) }
        );
        if (updatedPayload.tasks !== tasks) saveSubPath("tasks", updatedPayload.tasks);
        if (updatedPayload.contributions !== contributions) saveSubPath("contributions", updatedPayload.contributions);
        if (updatedPayload.config.totalXp !== config.totalXp) {
          configPatch = { ...configPatch, totalXp: updatedPayload.config.totalXp };
        }
        const startFocus = results.find(r => r.type === "START_FOCUS" && r.matched);
        if (startFocus && typeof focusTimer.extendTimer === "function") {
          const mins = Number(startFocus.task.timeEstimateMinutes) > 0 ? Number(startFocus.task.timeEstimateMinutes) : 25;
          focusTimer.extendTimer(mins);
        }
        const unmatched = results.filter(r => !r.matched);
        if (unmatched.length > 0) {
          replyText = `${replyText}\n\n(I couldn't find ${unmatched.map(r => `"${r.title}"`).join(" or ")} in your task list — could you double-check the name?)`.trim();
        }
      }

      if (configPatch) {
        saveSubPath("config", { ...configRef.current, ...configPatch, lastUpdated: Date.now() });
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
            <input className="text-input" type="text" value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder={`Ask ${config.mentorName || "your mentor"}…`}
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
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "4px", color: "var(--text-primary)" }}>
          ⚡ AI Focus Brief
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.5" }}>
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
