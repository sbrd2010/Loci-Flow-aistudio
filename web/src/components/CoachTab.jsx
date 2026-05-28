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

  const defaultWelcome = [{
    text: `Hello ${config.userName || "my friend"}. I am ${config.mentorName || "your mentor"}. You're working on "${challengeLabel}". How can I help you stay on track today?`,
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

    const recentCtx = withUser.slice(-7, -1)
      .map(m => `${m.isUser ? config.userName || "User" : config.mentorName || "Mentor"}: ${m.text}`)
      .join("\n");

    const prompt = `You are ${config.mentorName || "a wise mentor"} speaking to ${config.userName || "a user"} who struggles with ${challengeLabel}. Be direct, warm, concise — max 2–3 sentences. No flowery filler.${recentCtx ? `\n\nRecent conversation:\n${recentCtx}` : ""}\n\nUser: "${userText}"\n\nRespond now:`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
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
      config.challengeType === "starting" ? "Overcoming Inertia" :
      config.challengeType === "focusing" ? "Protecting Focus Sessions" :
      "Action over Perfectionism";
    const prompt = `You are ${config.mentorName || "a wise mentor"}. Review this person's task backlog and recommend 3 priority tasks to focus on TODAY.\n\nUser: ${config.userName || "friend"}\nChallenge: ${challengeDesc}\n\nBACKLOG:\n${backlog.map(t => `[${t.priority}] ${t.title} (${t.horizonLevel}) — est ${t.timeEstimateMinutes}min`).join("\n")}\n\nGive 3 specific recommendations with brief reasoning. Be direct and motivating.`;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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

  // ── Bad Day Reset ─────────────────────────────────────────────────────────
  const handleBadDayReset = () => {
    const pending = tasks.filter(t => !t.isCompleted && !t.isDeleted && ["P1","P2","P3"].includes(t.priority));
    if (pending.length === 0) { alert("No high-priority tasks to park — your list is already light! 💪"); return; }
    if (!window.confirm(`Bad Day Reset will park ${pending.length} high-priority task(s) (P1–P3) and show only easy P4 quick wins.\n\nYou can restore them from Parked Archive below.\n\nConfirm?`)) return;
    savePayload({ ...payload, tasks: tasks.map(t =>
      !t.isCompleted && !t.isDeleted && ["P1","P2","P3"].includes(t.priority)
        ? { ...t, isParked: true, isNowFocus: false }
        : t
    )});
    alert("Reset done. P4 quick wins unlocked. Start small. 💪");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const parkedTasks = tasks.filter(t => t.isParked && !t.isDeleted && !t.isCompleted);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* 1 ── Today's Intention */}
      <section className="card" style={{ background: "var(--accent)", textAlign: "center" }}>
        <p style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.06em", color: "var(--btn-text, #fff)", opacity: 0.75, textTransform: "uppercase", marginBottom: "6px" }}>
          Today's Intention
        </p>
        <p style={{ fontSize: "15px", fontWeight: "700", color: "var(--btn-text, #fff)", lineHeight: "1.4" }}>
          "{config.intentionMessage || "Focus on what matters most today."}"
        </p>
      </section>

      {/* 2 ── AI Mentor Chat */}
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

      {/* 4 ── Rescue Buttons */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <button className="btn"
          style={{ background: "var(--bg-card)", color: "var(--accent)", border: "1.5px solid var(--accent)", fontSize: "13px", minHeight: "52px" }}
          onClick={() => alert("STUCK RESCUE:\n\n1. Take 3 deep breaths\n2. Pick the SMALLEST physical action\n3. Do it for just 2 minutes\n\nAction builds dopamine. Go.")}>
          🚨 Stuck? Rescue
        </button>
        <button className="btn"
          style={{ background: "var(--bg-card)", color: "var(--danger)", border: "1.5px solid var(--border)", fontSize: "13px", minHeight: "52px" }}
          onClick={handleBadDayReset}>
          🌪️ Bad Day Reset
        </button>
      </section>

      {/* 5 ── AI Weekly Review */}
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
