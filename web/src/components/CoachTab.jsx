import React, { useState, useEffect, useRef } from "react";

export default function CoachTab({ payload, savePayload, saveSubPath }) {
  const { tasks = [], config = {} } = payload;

  // User's personal key overrides the default embedded key
  const apiKey = localStorage.getItem("loci_gemini_key") || (import.meta.env.VITE_GEMINI_KEY ? import.meta.env.VITE_GEMINI_KEY.trim() : "") || "";

  // ── Morning Ritual ────────────────────────────────────────────────────────
  const [ritualActive, setRitualActive] = useState(false);
  const [ritualStepIndex, setRitualStepIndex] = useState(-1);
  const [ritualSecondsLeft, setRitualSecondsLeft] = useState(0);
  const [ritualMaxSeconds, setRitualMaxSeconds] = useState(0);
  const [ritualDone, setRitualDone] = useState(false);
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
      alert("Morning Ritual complete! +80 XP 🎉");
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

  // ── AI Mentor Chat ────────────────────────────────────────────────────────
  const challengeLabel =
    config.challengeType === "starting"  ? "Overcoming Inertia" :
    config.challengeType === "focusing"  ? "Protecting Focus Sessions" :
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
    if (!chatInput.trim() || !apiKey || chatLoading) return;

    const userText = chatInput.trim();
    setChatInput("");

    const MAX_HISTORY = 40;
    const trimmed = chatHistory.length >= MAX_HISTORY
      ? chatHistory.slice(chatHistory.length - MAX_HISTORY + 1)
      : chatHistory;

    const withUser = [...trimmed, { text: userText, isUser: true }];
    saveSubPath("chatHistory", withUser);
    setChatLoading(true);

    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const todayTasks = tasks.filter(t => t.horizonLevel === "today" && !t.isDeleted && !t.isCompleted);
    const pinnedTask = todayTasks.find(t => t.isNowFocus);
    const streak = config.currentStreak || 0;
    const totalXp = config.totalXp || 0;

    const systemInstruction = `You are ${config.mentorName || "an ADHD coach"}, a certified ADHD productivity coach specializing in executive dysfunction, task initiation, and dopamine regulation. Your client is ${config.userName || "a user"}, who specifically struggles with "${challengeLabel}".

COACHING TECHNIQUES YOU ALWAYS APPLY:
- Task initiation block: Give ONE physical action for the next 2 minutes. Not 5 steps — just the door-handle move.
- Overwhelm: Acknowledge briefly, then triage ruthlessly. "Let's park everything except this ONE thing."
- Distraction/lost focus: Re-anchor gently. "You're back. What were you doing before?" No shame.
- Procrastination: Name the real blocker (fear of failure, perfectionism, unclear first step) then shrink the task.
- Bad days: Validate fully first, then offer the smallest possible win to rebuild momentum.
- Transitions (finished a task): Celebrate briefly, then point to the next smallest action.
- Overwhelm from deadline: "What's the one thing that would make tomorrow easier? Do that now."
- Perfectionism spiral: "Done and imperfect beats perfect and unfinished. Ship it."
- Body doubling: Narrate the task with them. "Open the doc. I'll wait."
- Emotional dysregulation: Validate the feeling first, always. Then reframe.

RESPONSE RULES:
- Max 3 sentences unless listing steps (then max 3 bullets)
- Never say "Great question!", "Absolutely!", or "Of course!"
- Address the user as "${(config.userName || "").split(" ")[0] || "friend"}" (their first name). Use their name naturally in the first sentence of your response.
- Warm and direct — not clinical, not cheerleader
- If user celebrates, celebrate back briefly and immediately redirect to next action

USER CONTEXT RIGHT NOW:
- Time: ${timeOfDay} (${hour}:00)
- Streak: ${streak} days in a row
- Total XP earned: ${totalXp}
- Today's remaining tasks: ${todayTasks.length > 0 ? todayTasks.slice(0,5).map(t => `[${t.priority}] ${t.title}`).join(", ") : "none"}
- Currently focused on: ${pinnedTask ? pinnedTask.title : "nothing pinned yet"}`;

    const recentCtx = withUser.slice(-6, -1)
      .map(m => `${m.isUser ? config.userName || "User" : config.mentorName || "Coach"}: ${m.text}`)
      .join("\n");

    const userMessage = `${recentCtx ? `Recent conversation:\n${recentCtx}\n\n` : ""}${config.userName || "User"}: "${userText}"`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }]
          }) }
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Keep going. I'm with you.";
      saveSubPath("chatHistory", [...withUser, { text: reply.trim(), isUser: false }]);
    } catch (err) {
      saveSubPath("chatHistory", [...withUser, { text: `Could not reach AI: ${err.message}`, isUser: false }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── AI Weekly Review ──────────────────────────────────────────────────────
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState("");

  const handleAiReview = async () => {
    if (!apiKey) return;
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
- Streak: ${config.currentStreak || 0} days
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
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setReviewResult(data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from AI.");
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

      {/* 1 ── AI Mentor Chat */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
              🤖 Chat with {config.mentorName || "your Mentor"}
            </h2>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
              Your AI ADHD coach — ask anything about focus, tasks, or momentum.
            </p>
          </div>
          {payload.chatHistory && payload.chatHistory.length > 0 && (
            <button
              onClick={() => { if (window.confirm("Clear chat history?")) saveSubPath("chatHistory", null); }}
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

        {!apiKey ? (
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center", marginTop: "8px" }}>
            🔑 Add your Gemini API key in <strong>Settings</strong> to enable AI chat.
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

        {!apiKey ? (
          <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
            🔑 Add your Gemini API key in Settings to enable this.
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
