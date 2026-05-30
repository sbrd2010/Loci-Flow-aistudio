import React, { useState, useEffect, useRef } from "react";
import { callAI, getAIKeys } from "../utils/aiCall";
import ConfirmDialog from "./ConfirmDialog";

export default function CoachTab({ payload, savePayload, saveSubPath }) {
  const { tasks = [], config = {} } = payload;
  const { groqKey, geminiKey } = getAIKeys();
  const hasAnyKey = !!(groqKey || geminiKey);

  const [confirmDialog, setConfirmDialog] = useState(null);

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
      hTasks.slice(0, 8).forEach(t => {
        const focus = t.isNowFocus ? " [NOW FOCUS]" : "";
        lines.push(`  • [${t.priority}]${focus} ${t.title}${t.timeEstimateMinutes ? ` (${t.timeEstimateMinutes}min)` : ""}`);
      });
      if (hTasks.length > 8) lines.push(`  … +${hTasks.length - 8} more`);
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

    const systemInstruction = `You are ${config.mentorName || "an ADHD coach"}, an expert AI productivity coach embedded inside Loci Focus — an ADHD-friendly task management app.

YOUR CLIENT: ${config.userName || "a user"} — call them "${firstName}". Core challenge: "${challengeLabel}".

THEIR FULL TASK LIST (you can see ALL of this — reference specific task names in your replies):
${taskContext}

YOUR EXPERTISE COVERS:
- ADHD productivity: initiation, focus protection, time awareness, task completion
- Task planning: sequencing, realistic time estimation, priority calibration
- Cognitive load: reducing overwhelm, chunking work, managing mental energy
- Momentum coaching: door-handle moves, micro-commitments, 2-minute rules
- Time blindness: realistic scheduling, buffer time, deadline awareness
- Motivation: streaks, progress visibility, identity-based encouragement

COACHING STYLE:
- Max 3 short sentences per reply. Zero filler phrases ("Great!", "Absolutely!", "Of course!").
- Address as "${firstName}". Be warm, specific, and action-oriented.
- For overwhelm: name ONE specific task from their list + its 30-second starter.
- For initiation blocks: use the [NOW FOCUS] task if present, else top P1 or P2.
- For distraction: re-anchor — "You were working on [task name], open it and read the first line."
- NEVER say you cannot see their tasks — you CAN see the full list above.
- If asked "what should I do?" or "what are my tasks?": answer directly from the list above.

GUARD RAILS:
- Off-topic (illegal, harmful, explicit, unrelated to productivity/wellbeing): respond with "That's outside my scope, ${firstName}. Let's focus on your tasks — what's blocking you right now?" Do not elaborate.
- If ${firstName} seems in genuine distress or crisis: "I hear you. Please reach out to someone you trust or a professional if this feels urgent. For now, what's the one smallest thing that might help you feel less stuck?"
- Stay firmly within: productivity, tasks, focus, ADHD strategies, time management, motivation, wellbeing support.

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

  // ── Focus Briefing (AI task analysis across all horizons) ─────────────────
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingResult, setBriefingResult] = useState("");

  const handleFocusBriefing = async () => {
    if (!hasAnyKey) return;
    const backlog = tasks.filter(t => !t.isDeleted && !t.isCompleted);
    if (backlog.length === 0) {
      setBriefingResult(`No tasks yet, ${firstName}. Tap + on the Home tab to add your first task, or use the Plan tab to map goals across horizons — then come back for your Focus Briefing.`);
      return;
    }

    setBriefingLoading(true);
    setBriefingResult("");

    const challengeDesc =
      config.challengeType === "starting" ? "Overcoming Inertia (struggles to start tasks)" :
      config.challengeType === "focusing" ? "Protecting Focus Sessions (gets distracted mid-task)" :
      config.challengeType === "tracking" ? "Time Awareness (loses track of time, misses deadlines)" :
      "Action over Perfectionism (overthinks and delays finishing)";

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

    const prompt = `You are ${config.mentorName || "an ADHD coach"}, an expert ADHD productivity coach.

USER: ${config.userName || "friend"} | Challenge: ${challengeDesc}
Time: ${timeOfDay} (${hour}:00) — ${energyNote}
Streak: ${config.visitStreakCount || 0} days
Today: ${todayTasks.length} tasks (${totalTodayHours}h estimated) | Week backlog: ${weekTasks.length} | Total active: ${backlog.length}
Priority distribution: ${p1Count} P1 of ${backlog.length} total (${Math.round(p1Ratio * 100)}% P1)

FULL TASK LIST (key: [priority] [horizon] title | est minutes):
${backlog.map(t => `[${t.priority}] [${t.horizonLevel}] ${t.title} | ${t.timeEstimateMinutes || 25}min | ${t.category || "–"}`).join("\n")}

PRODUCE A FOCUS BRIEFING with these sections:

**📊 Load Check**
- Is today overloaded? (flag if >6h estimated or >8 tasks today)
- Any horizon packed? (flag if week>10 tasks or month>15 tasks with no quarter plan)
- If overload: name 1-2 specific tasks to park or move to a later horizon

**🎯 Top 3 Right Now**
For each task: bold the name, one sentence WHY (energy match + urgency + momentum), then "Start: [10-word door-handle action]"
Pick based on: current energy level, ADHD-friendly sequencing (build momentum first), urgency, and cascade value (doing X unblocks Y)

**⏰ Time Awareness Check** (only if issues found)
- Flag any task that seems severely underestimated (e.g., "Quarterly report" at 15min — likely 3-4h)
- Flag any task placed in wrong horizon (e.g., a P1 urgent item sitting in Quarter)
- Give 1-2 specific move suggestions: "Move '[task]' from [current] to [better] because..."

**🔥 Priority Note** (only if >35% of tasks are P1)
- Flag priority inflation briefly. One sentence max.

**One sentence of encouragement** — be specific, reference their streak or a task they've completed recently if visible.

RULES: Bold task names. Be direct and concise. No filler. ${firstName} is ADHD — punchy, specific, actionable beats thorough but vague.`;

    try {
      const reply = await callAI({
        groqKey, geminiKey,
        systemPrompt: `You are ${config.mentorName || "an ADHD coach"}, an expert ADHD productivity coach.`,
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

  // ── Render ────────────────────────────────────────────────────────────────
  const parkedTasks = tasks.filter(t => t.isParked && !t.isDeleted && !t.isCompleted);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {/* 1 ── AI Mentor Chat */}
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

      {/* 2 ── Focus Briefing */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "4px", color: "var(--text-primary)" }}>
          ⚡ Focus Briefing
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.5" }}>
          Your AI scans every task across all horizons — flags overload, catches time blindness, and tells you exactly what to tackle now.
        </p>

        {!hasAnyKey ? (
          <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
            🔑 Add an AI key in <strong>Settings → AI Keys</strong> to enable this.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button className="btn" onClick={handleFocusBriefing} disabled={briefingLoading} style={{ width: "100%" }}>
              {briefingLoading ? "Analyzing your tasks…" : "Get Focus Briefing"}
            </button>
            {briefingResult && (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px", fontSize: "12.5px", lineHeight: "1.7", maxHeight: "380px", overflowY: "auto", whiteSpace: "pre-line", color: "var(--text-primary)" }}>
                {briefingResult}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3 ── Parked Archive */}
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
