import React, { useEffect, useState, useRef } from "react";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=";

const REASONS = [
  { id: "overwhelmed", emoji: "😵", label: "Too much going on",     color: "#f59e0b" },
  { id: "tired",       emoji: "😴", label: "Low energy / fog",      color: "#60a5fa" },
  { id: "anxious",     emoji: "😬", label: "Anxious / can't start", color: "#a78bfa" },
  { id: "distracted",  emoji: "📱", label: "Got distracted",         color: "#34d399" },
];

const OPTIONS = {
  overwhelmed: [
    { id: "single",    icon: "🎯", label: "Just one task",       desc: "Your pinned task — nothing else exists" },
    { id: "braindump", icon: "🗒️", label: "Brain dump first",    desc: "Write it all out, then pick one thing" },
    { id: "chat",      icon: "💬", label: "Talk to AI Coach",    desc: "Let's untangle this together" },
  ],
  tired: [
    { id: "break",  icon: "⏱️", label: "5-min break",         desc: "Short rest, then restart" },
    { id: "water",  icon: "💧", label: "Water + stretch",      desc: "Physical reset in 2 mins" },
    { id: "easy",   icon: "🪶", label: "Easiest task first",   desc: "Build momentum with a quick win" },
    { id: "chat",   icon: "💬", label: "Talk to AI Coach",     desc: "Find the smallest possible start" },
  ],
  anxious: [
    { id: "chat",    icon: "💬", label: "Talk it through",      desc: "AI check-in — no pressure, just chat" },
    { id: "breathe", icon: "🌬️", label: "2-min breathing",      desc: "Box breathing: 4 in · 4 hold · 4 out" },
    { id: "single",  icon: "🎯", label: "Just 2 minutes",       desc: "Set a timer — stop if needed after" },
  ],
  distracted: [
    { id: "single",   icon: "✊", label: "Start right now",      desc: "Close everything else, begin the task" },
    { id: "pomodoro", icon: "🍅", label: "25-min focus lock",    desc: "Commit to one Pomodoro" },
    { id: "chat",     icon: "💬", label: "Talk to AI Coach",     desc: "What pulled you away?" },
  ],
};

const TIMER_DURATIONS = { break: 5 * 60, water: 2 * 60, breathe: 2 * 60, pomodoro: 25 * 60 };

function getRescuePrompt(reason, firstName, task) {
  const name = firstName || "friend";
  const ctx = task ? `The user is stuck on: "${task.title}".` : "The user has tasks to do but is stuck.";
  const base = `You are a compassionate ADHD rescue coach. ${ctx} Keep ALL replies under 3 sentences. Be warm, not clinical. No bullet lists. Ask at most one short question per message. Address the user as ${name}.`;
  return {
    overwhelmed: `${base} ${name} is overwhelmed by too many things. Help them pick ONE task right now and name the single door-handle first step (something so small it takes 30 seconds).`,
    tired: `${base} ${name} is low energy or brain fog. Validate it — this is a real ADHD symptom. Suggest a physical reset (water, 2 deep breaths) OR the absolute smallest task start.`,
    anxious: `${base} ${name} is anxious and frozen. Validate their feeling in one sentence. Ask one gentle question like "What feels scary about starting?" — nothing more.`,
    distracted: `${base} ${name} got distracted — completely normal for ADHD. Be non-judgmental. Give one specific re-entry instruction like "Open the task and read the first line right now."`,
  }[reason] || base;
}

function fmt(secs) {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export default function RescueMode({ task, onDismiss, onAccept, apiKey, firstName }) {
  const [step, setStep]       = useState("triage"); // triage | options | chat | timer
  const [reason, setReason]   = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [timerSecs, setTimerSecs] = useState(null);
  const endRef  = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (step === "chat") setTimeout(() => inputRef.current?.focus(), 100); }, [step]);

  // Countdown
  useEffect(() => {
    if (timerSecs === null || timerSecs <= 0) return;
    const t = setTimeout(() => setTimerSecs(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timerSecs]);

  const key = (apiKey || import.meta.env.VITE_GEMINI_KEY || "").trim();

  const aiCall = async (r, history, openingMsg) => {
    setLoading(true);
    try {
      const res = await fetch(`${GEMINI_URL}${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: getRescuePrompt(r, firstName, task) }] },
          contents: history,
        }),
      });
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
        || `Hey ${firstName || "friend"}, I'm here. What's happening right now?`;
      setMessages(prev => [...prev, { role: "ai", text: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: `I'm here, ${firstName || "friend"}. What's one tiny thing you could do right now?` }]);
    } finally {
      setLoading(false);
    }
  };

  const openChat = (r) => {
    setStep("chat");
    if (!key) {
      setMessages([{ role: "ai", text: `Hey ${firstName || "friend"}, I'm here with you. What's going on right now?` }]);
      return;
    }
    aiCall(r, [{ role: "user", parts: [{ text: "I'm stuck and need help." }] }], true);
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput("");
    const updated = [...messages, { role: "user", text: msg }];
    setMessages(updated);
    if (!key) return;
    await aiCall(reason, updated.map(m => ({ role: m.role === "ai" ? "model" : "user", parts: [{ text: m.text }] })));
  };

  const handleOption = (optId) => {
    if (optId === "chat")     { openChat(reason); return; }
    if (optId === "single")   { onAccept(); return; }
    if (optId === "easy")     { onAccept(); return; }
    if (optId === "braindump"){ onDismiss(); return; }
    if (TIMER_DURATIONS[optId]) { setTimerSecs(TIMER_DURATIONS[optId]); setStep("timer"); return; }
    onAccept();
  };

  // ─── shared elements ────────────────────────────────────────────────────────
  const overlay = { position: "fixed", inset: 0, background: "#000", zIndex: 9999,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    fontFamily: "'Inter', system-ui, sans-serif", padding: "24px", overflowY: "auto" };

  const badge = (
    <div style={{ background: "#fecb00", color: "#000", padding: "4px 14px", fontSize: "10px",
      fontWeight: "800", letterSpacing: "0.12em", textTransform: "uppercase",
      marginBottom: "28px", borderRadius: "2px", flexShrink: 0 }}>
      ⚠ Rescue Mode
    </div>
  );

  const corners = ["tl","tr","bl","br"].map(c => (
    <div key={c} style={{ position: "fixed",
      top: c[0]==="t" ? 20 : "auto", bottom: c[0]==="b" ? 20 : "auto",
      left: c[1]==="l" ? 20 : "auto", right: c[1]==="r" ? 20 : "auto",
      width: 28, height: 28,
      borderTop:    c[0]==="t" ? "2px solid rgba(255,255,255,0.1)" : "none",
      borderBottom: c[0]==="b" ? "2px solid rgba(255,255,255,0.1)" : "none",
      borderLeft:   c[1]==="l" ? "2px solid rgba(255,255,255,0.1)" : "none",
      borderRight:  c[1]==="r" ? "2px solid rgba(255,255,255,0.1)" : "none",
    }} />
  ));

  const exitBtn = (
    <button onClick={onDismiss} style={{ background: "none", border: "none",
      color: "rgba(255,255,255,0.2)", fontSize: "11px", cursor: "pointer",
      letterSpacing: "0.06em", textTransform: "uppercase", marginTop: "20px", flexShrink: 0 }}>
      Exit rescue mode
    </button>
  );

  // ─── STEP: TRIAGE ───────────────────────────────────────────────────────────
  if (step === "triage") return (
    <div style={overlay}>
      {corners}{badge}
      <h2 style={{ color: "#fff", fontSize: "clamp(18px,5vw,28px)", fontWeight: "900",
        marginBottom: "8px", textAlign: "center" }}>
        What's happening right now?
      </h2>
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px", marginBottom: "28px", textAlign: "center" }}>
        Tap to get personalized help
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", width: "100%", maxWidth: "380px" }}>
        {REASONS.map(r => (
          <button key={r.id} onClick={() => { setReason(r.id); setStep("options"); }}
            style={{ background: "rgba(255,255,255,0.05)", border: "2px solid rgba(255,255,255,0.1)",
              borderRadius: "12px", padding: "20px 12px", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
              transition: "border-color 0.15s, background 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = r.color; e.currentTarget.style.background = `${r.color}18`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}>
            <span style={{ fontSize: "32px" }}>{r.emoji}</span>
            <span style={{ color: "#fff", fontSize: "12px", fontWeight: "700", textAlign: "center", lineHeight: "1.3" }}>{r.label}</span>
          </button>
        ))}
      </div>
      {exitBtn}
    </div>
  );

  // ─── STEP: OPTIONS ──────────────────────────────────────────────────────────
  if (step === "options") {
    const r = REASONS.find(x => x.id === reason);
    const opts = OPTIONS[reason] || [];
    return (
      <div style={overlay}>
        {corners}{badge}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
          <span style={{ fontSize: "28px" }}>{r?.emoji}</span>
          <div>
            <div style={{ color: r?.color, fontSize: "10px", fontWeight: "800", letterSpacing: "0.1em", textTransform: "uppercase" }}>You're feeling</div>
            <div style={{ color: "#fff", fontSize: "17px", fontWeight: "800" }}>{r?.label}</div>
          </div>
        </div>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px", marginBottom: "16px", textAlign: "center" }}>
          Choose what helps most right now:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", maxWidth: "380px" }}>
          {opts.map(opt => (
            <button key={opt.id} onClick={() => handleOption(opt.id)}
              style={{ background: opt.id === "chat" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                border: opt.id === "chat" ? "2px solid rgba(255,255,255,0.25)" : "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px", padding: "14px 16px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "14px", textAlign: "left",
                transition: "border-color 0.15s, background 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = r?.color; e.currentTarget.style.background = `${r?.color}15`; }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = opt.id === "chat" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)";
                e.currentTarget.style.background   = opt.id === "chat" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)";
              }}>
              <span style={{ fontSize: "22px", flexShrink: 0 }}>{opt.icon}</span>
              <div>
                <div style={{ color: "#fff", fontSize: "14px", fontWeight: "700" }}>{opt.label}</div>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "12px", marginTop: "2px" }}>{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
        <button onClick={() => setStep("triage")} style={{ background: "none", border: "none",
          color: "rgba(255,255,255,0.2)", fontSize: "11px", cursor: "pointer",
          letterSpacing: "0.06em", textTransform: "uppercase", marginTop: "14px" }}>
          ← Back
        </button>
        {exitBtn}
      </div>
    );
  }

  // ─── STEP: CHAT ─────────────────────────────────────────────────────────────
  if (step === "chat") {
    const r = REASONS.find(x => x.id === reason);
    return (
      <div style={{ ...overlay, justifyContent: "flex-start", padding: "16px" }}>
        {corners}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", maxWidth: "500px", marginBottom: "12px", flexShrink: 0 }}>
          {badge}
          <button onClick={() => setStep("options")} style={{ background: "none", border: "none",
            color: "rgba(255,255,255,0.3)", fontSize: "12px", cursor: "pointer",
            letterSpacing: "0.06em", textTransform: "uppercase" }}>
            ← Back
          </button>
        </div>
        <div style={{ width: "100%", maxWidth: "500px", marginBottom: "10px",
          color: "rgba(255,255,255,0.4)", fontSize: "12px", flexShrink: 0 }}>
          {r?.emoji} Rescue chat — {r?.label}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, width: "100%", maxWidth: "500px", overflowY: "auto",
          display: "flex", flexDirection: "column", gap: "10px", minHeight: 0, paddingBottom: "8px" }}>
          {loading && messages.length === 0 && (
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px", textAlign: "center", paddingTop: "40px" }}>
              Your coach is here…
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "85%", padding: "12px 16px", borderRadius: "16px",
                background: m.role === "user" ? "#ff5545" : "rgba(255,255,255,0.1)",
                color: "#fff", fontSize: "14px", lineHeight: "1.65",
                borderBottomRightRadius: m.role === "user" ? "4px" : "16px",
                borderBottomLeftRadius:  m.role === "ai"   ? "4px" : "16px" }}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && messages.length > 0 && (
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "18px", paddingLeft: "4px", letterSpacing: "4px" }}>···</div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div style={{ display: "flex", gap: "8px", width: "100%", maxWidth: "500px",
          marginTop: "10px", flexShrink: 0 }}>
          <input ref={inputRef} value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Tell me what's going on…"
            style={{ flex: 1, background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px",
              padding: "12px 16px", color: "#fff", fontSize: "14px", outline: "none" }} />
          <button onClick={handleSend} disabled={loading || !input.trim()}
            style={{ background: "#ff5545", border: "none", borderRadius: "10px",
              padding: "0 18px", color: "#fff", fontSize: "18px", cursor: "pointer",
              opacity: loading || !input.trim() ? 0.4 : 1 }}>
            ↑
          </button>
        </div>
        {exitBtn}
      </div>
    );
  }

  // ─── STEP: TIMER ────────────────────────────────────────────────────────────
  if (step === "timer") {
    const done = timerSecs === 0;
    return (
      <div style={overlay}>
        {corners}{badge}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{ fontSize: "clamp(64px,16vw,96px)", fontWeight: "900", color: "#fff",
            fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
            {done ? "✓" : fmt(timerSecs)}
          </div>
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px", marginTop: "8px" }}>
            {done ? "Time's up — ready to start?" : "Relax. You'll start when this ends."}
          </div>
        </div>
        {done ? (
          <button onClick={onAccept} style={{ width: "100%", maxWidth: "360px", height: "64px",
            background: "#ff5545", border: "none", borderRadius: "8px",
            color: "#fff", fontSize: "16px", fontWeight: "900",
            letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer" }}>
            Start the task now ✊
          </button>
        ) : (
          <button onClick={() => setStep("options")}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "8px", padding: "12px 28px",
              color: "rgba(255,255,255,0.4)", fontSize: "12px", cursor: "pointer",
              letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Skip timer
          </button>
        )}
        {exitBtn}
      </div>
    );
  }

  return null;
}
