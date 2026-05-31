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
    const now2 = new Date();
    const todayStr = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,"0")}-${String(now2.getDate()).padStart(2,"0")}`;
    const doneToday = completed.filter(t => t.dateCompletedString === todayStr).length;
    if (doneToday > 0) lines.push(`\nCOMPLETED TODAY: ${doneToday} task${doneToday > 1 ? "s" : ""}`);
    return total === 0 ? "No active tasks yet." : lines.join("\n");
  };

  // ── AI Mentor Chat ────────────────────────────────────────────────────────
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
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
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

    const systemInstruction = `You are ${config.mentorName || "a focus coach"}, an expert AI productivity coach embedded inside Loci Focus — a focus and momentum app for people who struggle with overwhelm and execution.

YOUR CLIENT: ${config.userName || "a user"} — call them "${firstName}". Core challenge: "${challengeLabel}".

THEIR FULL TASK LIST (you can see ALL of this — reference specific task names in your replies):
${taskContext}

YOUR EXPERTISE COVERS:
- Focus and momentum coaching: initiation, protecting attention, time awareness, task completion
- Task planning: sequencing, realistic time estimation, priority calibration
- Cognitive load: reducing overwhelm, chunking work, managing mental energy
- Momentum coaching: door-handle moves, micro-commitments, 2-minute rules
- Time awareness: realistic scheduling, buffer time, deadline awareness
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
- Stay firmly within: productivity, tasks, focus, execution support, time management, motivation, wellbeing support.

LANGUAGE: Never use the word "ADHD" in your responses. Instead use: focus challenge, overwhelm, execution support, momentum, time awareness, micro-step, reset, low-energy mode.

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

    const prompt = `You are ${config.mentorName || "a focus coach"}, an expert productivity coach specialising in focus, momentum, and execution support.

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
Pick based on: current energy level, momentum-first sequencing (build momentum first), urgency, and cascade value (doing X unblocks Y)

**⏰ Time Awareness Check** (only if issues found)
- Flag any task that seems severely underestimated (e.g., "Quarterly report" at 15min — likely 3-4h)
- Flag any task placed in wrong horizon (e.g., a P1 urgent item sitting in Quarter)
- Give 1-2 specific move suggestions: "Move '[task]' from [current] to [better] because..."

**🔥 Priority Note** (only if >35% of tasks are P1)
- Flag priority inflation briefly. One sentence max.

**One sentence of encouragement** — be specific, reference their streak or a task they've completed recently if visible.

RULES: Bold task names. Be direct and concise. No filler. Punchy, specific, actionable beats thorough but vague. Never use the word "ADHD" — use: overwhelm, execution support, momentum, micro-step, time awareness, reset.`;

    try {
      const reply = await callAI({
        groqKey, geminiKey,
        systemPrompt: `You are ${config.mentorName || "a focus coach"}, an expert productivity coach. Never use the word "ADHD" in responses.`,
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
          ⚡ AI Focus Brief
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.5" }}>
          Your AI scans every task across all horizons — flags overload, catches time blindness, and briefs you on exactly what to tackle now.
        </p>

        {/* Task Snapshot — always-visible data viz */}
        {(() => {
          const active = tasks.filter(t => !t.isDeleted && !t.isCompleted);
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
