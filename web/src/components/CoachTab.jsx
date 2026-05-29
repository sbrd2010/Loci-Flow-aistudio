import React, { useState, useEffect, useRef } from "react";
import { callAI, getAIKeys } from "../utils/aiCall";
import ConfirmDialog from "./ConfirmDialog";

export default function CoachTab({ payload, savePayload, saveSubPath }) {
  const { tasks = [], config = {} } = payload;
  const { groqKey, geminiKey } = getAIKeys();
  const hasAnyKey = !!(groqKey || geminiKey);

  // ── Morning Ritual ────────────────────────────────────────────────────────
  const [ritualActive, setRitualActive] = useState(false);
  const [ritualStepIndex, setRitualStepIndex] = useState(-1);
  const [ritualSecondsLeft, setRitualSecondsLeft] = useState(0);
  const [ritualMaxSeconds, setRitualMaxSeconds] = useState(0);
  const [ritualDone, setRitualDone] = useState(false);
  const [ritualSuccess, setRitualSuccess] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const timerIntervalRef = useRef(null);

  const ritualSteps = [
    { name: "Hydrate — drink a full glass of water", seconds: 60 },
    { name: "Stand & Stretch (touch toes)", seconds: 90 },
    { name: "Box Breathing (4-hold-4 cycle)", seconds: 90 },
    { name: "Write ONE intention for today", seconds: 60 },
    { name: "Scan your task list — pick 3 priorities", seconds: 30 },
    { name: "Pick your very first action NOW", seconds: 30 }
  ];

  useEffect(() => {
    if (ritualActive && ritualStepIndex >= 0 && ritualSecondsLeft > 0) {
      timerIntervalRef.current = setInterval(() => {
        setRitualSecondsLeft(prev => prev <= 1 ? 0 : prev - 1);
      }, 1000);
    } else {
      clearInterval(timerIntervalRef.current);
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [ritualActive, ritualStepIndex, ritualSecondsLeft > 0]);

  useEffect(() => {
    if (ritualActive && ritualStepIndex >= 0 && ritualSecondsLeft === 0) {
      handleAdvanceStep();
    }
  }, [ritualSecondsLeft, ritualActive, ritualStepIndex]);

  useEffect(() => {
    if (ritualDone) {
      const newXp = (Number(config.totalXp) || 0) + 80;
      savePayload({ ...payload, config: { ...config, totalXp: newXp } });
      setRitualDone(false);
      setRitualSuccess(true);
      setTimeout(() => setRitualSuccess(false), 3500);
    }
  }, [ritualDone]);

  const handleAdvanceStep = () => {
    if (ritualStepIndex < ritualSteps.length - 1) {
      const next = ritualStepIndex + 1;
      setRitualStepIndex(next);
      setRitualSecondsLeft(ritualSteps[next].seconds);
      setRitualMaxSeconds(ritualSteps[next].seconds);
    } else {
      setRitualActive(false);
      setRitualStepIndex(-1);
      setRitualSecondsLeft(0);
      setRitualDone(true);
    }
  };

  const handleBeginRitual = () => {
    setRitualActive(true);
    setRitualStepIndex(0);
    setRitualSecondsLeft(ritualSteps[0].seconds);
    setRitualMaxSeconds(ritualSteps[0].seconds);
    setRitualDone(false);
  };

  const handleAbortRitual = () => {
    clearInterval(timerIntervalRef.current);
    setRitualActive(false);
    setRitualStepIndex(-1);
    setRitualSecondsLeft(0);
  };

  const formatTime = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  // ── Task context builder ──────────────────────────────────────────────────
  const buildTaskContext = (allTasks) => {
    const active = (allTasks || []).filter(t => !t.isDeleted && !t.isCompleted);
    const horizonOrder = ["today", "week", "month", "quarter", "halfyear", "office"];
    const horizonLabels = { today: "TODAY", week: "THIS WEEK", month: "THIS MONTH", quarter: "QUARTER", halfyear: "6 MONTHS", office: "WORK" };
    const lines = [];
    let total = 0;
    for (const h of horizonOrder) {
      const hTasks = active.filter(t => t.horizonLevel === h);
      if (hTasks.length === 0) continue;
      total += hTasks.length;
      lines.push(`${horizonLabels[h]} (${hTasks.length}):`);
      hTasks.slice(0, 6).forEach(t => {
        const focus = t.isNowFocus ? " [NOW FOCUS]" : "";
        lines.push(`  • [${t.priority}]${focus} ${t.title}${t.timeEstimateMinutes ? ` (${t.timeEstimateMinutes}min)` : ""}`);
      });
      if (hTasks.length > 6) lines.push(`  … +${hTasks.length - 6} more`);
    }
    const completed = (allTasks || []).filter(t => t.isCompleted && !t.isDeleted);
    const todayStr = new Date().toISOString().slice(0, 10);
    const doneToday = completed.filter(t => t.dateCompletedString === todayStr).length;
    if (doneToday > 0) lines.push(`\nCOMPLETED TODAY: ${doneToday} task${doneToday > 1 ? "s" : ""}`);
    return total === 0 ? "No active tasks yet." : lines.join("\n");
  };

  // ── AI Mentor Chat ────────────────────────────────────────────────────────
  const challengeLabel =
    config.challengeType === "starting"  ? "Overcoming Inertia" :
    config.challengeType === "focusing"  ? "Protecting Focus Sessions" :
    config.challengeType === "tracking"  ? "Time Awareness & Calendar Management" :
    "Action over Perfectionism";

  const firstName = (config.userName || "").split(" ")[0] || "friend";
  const defaultWelcome = [{
    text: `Hey ${firstName}! I'm ${config.mentorName || "your AI coach"} 👋 You're working on ${challengeLabel}. What's on your mind — stuck on a task, feeling overwhelmed, or just need a nudge to start?`,
    isUser: false
  }];

  const chatHistory = (payload.chatHistory && payload.chatHistory.length > 0)
    ? payload.chatHistory
    : defaultWelcome;

  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.parentElement?.scrollTo?.({ top: 99999, behavior: "smooth" });
    }
  }, [chatHistory, chatLoading]);

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
    const todayActive = tasks.filter(t => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted);
    const taskContext = buildTaskContext(tasks);

    const systemInstruction = `You are ${config.mentorName || "an ADHD coach"}, a certified ADHD productivity coach embedded inside Loci Focus — an ADHD-friendly task management app.

Your client: ${config.userName || "a user"} (call them "${firstName}"), core challenge: "${challengeLabel}".

THEIR FULL TASK LIST — you can see ALL of this and MUST reference specific task names in your replies:
${taskContext}

COACHING RULES:
- Max 3 sentences per reply. No filler phrases ("Great!", "Absolutely!", "Of course!").
- Address as "${firstName}". Be warm, specific, and action-oriented.
- For overwhelm: name ONE specific task from their list and give its door-handle step (under 30 seconds to start).
- For initiation blocks: use the [NOW FOCUS] task if present, else pick the top P1 or P2.
- For distraction: re-anchor — "You were working on [task name], open it and read the first line."
- NEVER say you cannot see their tasks — you CAN see the full list above.
- If they ask "what should I do?" or "what are my tasks?", answer from the list above directly.

SESSION: ${timeOfDay}, ${config.visitStreakCount || 0}-day streak, ${todayActive.length} active tasks today.`;

    const messages = withUser.map(m => ({ role: m.isUser ? "user" : "assistant", content: m.text }));

    try {
      const reply = await callAI({ groqKey, geminiKey, systemPrompt: systemInstruction, messages, maxTokens: 300 });
      saveSubPath("chatHistory", [...withUser, { text: reply.trim(), isUser: false }]);
    } catch (err) {
      const hint = err.message === "429" ? "Rate limit — wait 30 sec and retry." : err.message === "503" ? "AI server busy — try again." : err.message === "no_key" ? "Add an AI key in Settings." : `AI error ${err.message}`;
      saveSubPath("chatHistory", [...withUser, { text: hint, isUser: false }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── AI Weekly Review ──────────────────────────────────────────────────────
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState("");

  const handleAiReview = async () => {
    if (!hasAnyKey) return;
    const backlog = tasks.filter(t => !t.isDeleted && !t.isCompleted);
    if (backlog.length === 0) {
      setReviewResult("🎉 Your backlog is empty — nothing to review! Add goals on the Roadmap tab and come back.");
      return;
    }
    setReviewLoading(true);
    setReviewResult("");
    const challengeDesc =
      config.challengeType === "starting" ? "Overcoming Inertia (struggles to start tasks)" :
      config.challengeType === "focusing" ? "Protecting Focus Sessions (gets distracted mid-task)" :
      config.challengeType === "tracking" ? "Time Awareness (loses track of time, misses deadlines)" :
      "Action over Perfectionism (overthinks and delays finishing)";
    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const todayTasks = backlog.filter(t => t.horizonLevel === "today");
    const overdueTasks = backlog.filter(t => t.horizonLevel === "today" && t.priority === "P1");
    const prompt = `You are ${config.mentorName || "an ADHD coach"}, an expert ADHD productivity coach. Review this person's task list and pick the 3 best tasks to do TODAY based on ADHD-friendly prioritization.

USER PROFILE:
- Name: ${config.userName || "friend"}
- Core challenge: ${challengeDesc}
- Time of day: ${timeOfDay} (${hour}:00) — ${hour < 12 ? "peak cognitive energy window" : hour < 15 ? "post-lunch dip, use easier tasks" : hour < 18 ? "second wind window" : "low energy, protect recovery"}
- Streak: ${config.visitStreakCount || 0} days
- Today's task count: ${todayTasks.length}
- Urgent P1 tasks today: ${overdueTasks.length}

FULL TASK LIST:
${backlog.map(t => `[${t.priority}] ${t.title} | horizon: ${t.horizonLevel} | est: ${t.timeEstimateMinutes}min | category: ${t.category || "–"}`).join("\n")}

ADHD PRIORITIZATION RULES (apply in this order):
1. Urgent + short tasks first if procrastination is the challenge
2. Energy-matched tasks for current time of day
3. Tasks with momentum value — completing it makes OTHER things easier
4. Never recommend more than one P1 to avoid overwhelm

FOR EACH OF YOUR 3 PICKS, PROVIDE:
• **Task title**
• Why to do it NOW (1 sentence — energy match, urgency, or momentum reason)
• The door-handle move: the single first physical action to START it (max 10 words)

End with one sentence of encouragement. Be direct and specific — no generic productivity advice.`;

    try {
      const reply = await callAI({
        groqKey, geminiKey,
        systemPrompt: `You are ${config.mentorName || "an ADHD coach"}, an expert ADHD productivity coach.`,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 600
      });
      setReviewResult(reply);
    } catch (err) {
      setReviewResult(`AI Review failed: ${err.message}`);
    } finally {
      setReviewLoading(false);
    }
  };


  // ── Render ────────────────────────────────────────────────────────────────
  const parkedTasks = tasks.filter(t => t.isParked && !t.isDeleted && !t.isCompleted);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {ritualSuccess && (
        <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", background: "var(--success)", color: "#fff", padding: "12px 24px", borderRadius: "20px", fontWeight: "700", fontSize: "14px", zIndex: 300, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
          🎉 Morning Ritual complete! +80 XP
        </div>
      )}

      {/* 1 ── AI Mentor Chat */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
              🤖 Chat with {config.mentorName || "your Mentor"}
            </h2>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
              Your AI focus coach — ask anything about tasks, focus, or momentum.
            </p>
          </div>
          {payload.chatHistory && payload.chatHistory.length > 0 && (
            <button
              onClick={() => setConfirmDialog({ message: "Clear all chat history with your coach?", confirmLabel: "Clear", danger: true, onConfirm: () => { saveSubPath("chatHistory", null); setConfirmDialog(null); }, onCancel: () => setConfirmDialog(null) })}
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
              <span>{config.mentorName || "Mentor"} is typing…</span>
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
              disabled={chatLoading} />
            {chatLoading
              ? <span style={{ fontSize: "12px", color: "var(--text-muted)", padding: "0 10px" }}>…</span>
              : <button className="btn" type="submit" disabled={!chatInput.trim()} style={{ padding: "10px 16px", fontSize: "13px" }}>Send</button>
            }
          </form>
        )}
      </section>

      {/* 3 ── Morning Ritual */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "4px", color: "var(--text-primary)" }}>
          Morning Ritual <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted)" }}>7 min · +80 XP</span>
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.5" }}>
          6 micro-habits to clear executive fog and build momentum before you open your task list.
        </p>

        {!ritualActive ? (
          <button className="btn" onClick={handleBeginRitual} style={{ width: "100%" }}>
            Begin Morning Ritual
          </button>
        ) : (
          <div className="ritual-step-card">
            <span style={{ fontSize: "10px", fontWeight: "800", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              STEP {ritualStepIndex + 1} OF {ritualSteps.length}
            </span>
            <h4 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-primary)", marginTop: "6px" }}>
              {ritualSteps[ritualStepIndex].name}
            </h4>
            <div className="ritual-timer-display">{formatTime(ritualSecondsLeft)}</div>
            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button className="btn" onClick={handleAdvanceStep}
                style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                Skip
              </button>
              <button className="btn" onClick={handleAbortRitual}
                style={{ flex: 1, background: "var(--danger)", color: "#fff" }}>
                Stop
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 4 ── AI Weekly Review */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "4px", color: "var(--text-primary)" }}>
          AI Horizon Review
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.5" }}>
          Your mentor scans your full backlog and recommends the 3 most important tasks to do today.
        </p>

        {!hasAnyKey ? (
          <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
            🔑 Add an AI key in <strong>Settings → AI Keys</strong> to enable this.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button className="btn" onClick={handleAiReview} disabled={reviewLoading} style={{ width: "100%" }}>
              {reviewLoading ? "Reviewing…" : "Run AI Review"}
            </button>
            {reviewResult && (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px", fontSize: "12.5px", lineHeight: "1.6", maxHeight: "200px", overflowY: "auto", whiteSpace: "pre-line", color: "var(--text-primary)" }}>
                {reviewResult}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 6 ── Parked Archive */}
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
