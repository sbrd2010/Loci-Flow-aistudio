import React, { useEffect, useState, useRef } from "react";
import { callAI, getAIKeys, buildProviderOrder } from "../utils/aiCall";
import { buildLocalSafetyReply, buildOfflineRescueReply, buildRescuePrompt, filterApplicableRescueActions, parseRescueActionTags } from "../utils/rescueCoachPrompt";
import { buildRescueHandoffSummary } from "../utils/rescueHandoff";

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

function fmt(secs) {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export default function RescueMode({ task, onDismiss, onAccept, onSetNowFocus, onParkTask, onHandoffSummary, apiKey, firstName, allTasks, config = {}, entryPoint = "today", includeMemory = true, isSyncingFromCache = false, syncWarning = null }) {
  // Mirrors CoachTab's cloudSyncUnconfirmed gate: cached/pre-sync payload data
  // can't be trusted to mutate tasks against yet — see applyRescueActions.
  const cloudSyncUnconfirmed = isSyncingFromCache || syncWarning === "offline";
  const [step, setStep]       = useState("triage"); // triage | options | chat | timer
  const [reason, setReason]   = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [timerSecs, setTimerSecs] = useState(null);
  const endRef      = useRef(null);
  const inputRef    = useRef(null);
  const chatStarted = useRef(false);
  const sendingRef  = useRef(false);
  const userChattedRef = useRef(false);
  const handoffSavedRef = useRef(false);
  // A reply can resolve after the user has already exited Rescue (unmounting
  // this component) — without this guard, a late RESCUE_PARK_TASK/
  // RESCUE_SET_NOW_FOCUS tag would still reach onParkTask/onSetNowFocus and
  // mutate the parent's task list for a flow the user already canceled.
  const mountedRef  = useRef(true);
  // Sets true on every effect run (not just the initial useRef default) —
  // React 18 StrictMode's dev-only mount->cleanup->mount double-invocation
  // would otherwise leave this stuck false forever after the extra cleanup,
  // even though the component is genuinely still mounted.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (step === "chat") setTimeout(() => inputRef.current?.focus(), 100); }, [step]);

  // Countdown
  useEffect(() => {
    if (timerSecs === null || timerSecs <= 0) return;
    const t = setTimeout(() => setTimerSecs(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timerSecs]);

  const saveHandoff = (outcome = "dismissed") => {
    if (handoffSavedRef.current) return;
    // Writing config while cloud sync hasn't confirmed the first RTDB
    // snapshot yet would stamp a stale cached config as the "winner" once
    // that snapshot arrives, silently overwriting newer remote config from
    // another device — matching the same guard used for Coach's memory writes.
    if (cloudSyncUnconfirmed) return;
    const summary = buildRescueHandoffSummary({
      reason,
      task,
      entryPoint,
      outcome,
      chatted: userChattedRef.current || messages.some(m => m.role === "user"),
      config,
    });
    if (!summary) return;
    handoffSavedRef.current = true;
    onHandoffSummary?.(summary);
  };

  const dismissRescue = (outcome = "dismissed") => {
    saveHandoff(outcome);
    onDismiss?.();
  };

  const acceptRescue = () => {
    onAccept?.();
    saveHandoff("accepted");
  };

  const { groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const effectiveGeminiKey = geminiKey || (apiKey || "").trim();
  const pref = localStorage.getItem("loci_provider_pref") || "auto";
  const hasKey = buildProviderOrder(pref, groqKey, nvidiaKey, effectiveGeminiKey, cerebrasKey, zaiKey).length > 0;

  // Applies whichever actions filterApplicableRescueActions (rescueCoachPrompt.js)
  // let through, and reports whether a mutation was withheld specifically
  // because cloud sync hasn't confirmed yet, so the caller can tell the user
  // rather than let the model's narration imply it happened.
  const applyRescueActions = (actions = [], lastUserText = "") => {
    const { applicable, suppressedForSync } = filterApplicableRescueActions(actions, { lastUserText, cloudSyncUnconfirmed });
    applicable.forEach(action => {
      if (action.type === "RESCUE_SET_NOW_FOCUS") {
        (onSetNowFocus || onAccept)?.();
        saveHandoff("accepted");
      } else if (action.type === "RESCUE_PARK_TASK") {
        onParkTask?.();
        saveHandoff("parked");
      } else if (action.type === "RESCUE_START_TIMER") {
        setTimerSecs(action.minutes * 60);
        setStep("timer");
        saveHandoff("timer_started");
      }
    });
    return suppressedForSync;
  };

  const aiCall = async (r, history) => {
    setLoading(true);
    try {
      // history is [{role: "user"|"ai", text}] — convert to OpenAI format
      const messages = history.map(m => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text || m.parts?.[0]?.text || ""
      })).filter(m => m.content);

      const lastUserText = [...messages].reverse().find(m => m.role === "user")?.content || "";
      const localSafetyReply = buildLocalSafetyReply(lastUserText, firstName);
      if (localSafetyReply) {
        setMessages(prev => [...prev, { role: "ai", text: localSafetyReply }]);
        return;
      }

      const reply = await callAI({
        groqKey,
        nvidiaKey,
        cerebrasKey,
        zaiKey,
        geminiKey: effectiveGeminiKey,
        systemPrompt: buildRescuePrompt({ reason: r, firstName, task, allTasks, config, entryPoint, includeMemory }),
        messages: messages.length > 0 ? messages : [{ role: "user", content: "I'm stuck and need help." }],
        maxTokens: 200
      });
      if (!mountedRef.current) return;
      const { cleanText, actions } = parseRescueActionTags(reply);
      // The model's narration above (e.g. "Setting this as your focus...") describes
      // a mutation that was NOT applied below when sync is unconfirmed — replace it
      // entirely so the user doesn't believe it happened (mirrors CoachTab.jsx).
      const suppressedForSync = applyRescueActions(actions, lastUserText);
      const displayText = suppressedForSync
        ? "Hold on — still syncing your latest data. Mind asking that again in a moment?"
        : (cleanText || "Done.");
      setMessages(prev => [...prev, { role: "ai", text: displayText }]);
    } catch (err) {
      if (!mountedRef.current) return;
      const hint = err.message === "429" ? " (rate limit — wait a moment)" : err.message === "503" ? " (server busy)" : "";
      const lastUserText = history.map(m => (m.role === "user" ? (m.text || m.parts?.[0]?.text || "") : "")).filter(Boolean).at(-1) || "";
      setMessages(prev => [...prev, { role: "ai", text: `AI unavailable${hint}. ${buildOfflineRescueReply(r, firstName, lastUserText)}` }]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        sendingRef.current = false;
      }
    }
  };

  const openChat = (r) => {
    // Always navigate to the chat screen — chatStarted only guards the
    // opener message below. Without this split, a user who reaches "chat"
    // via an AI-started timer (RESCUE_START_TIMER sets step to "timer" while
    // chatStarted is already true) and then taps "Skip timer" -> "Talk to AI
    // Coach" would have this bail out on the guard and never return to chat.
    setStep("chat");
    if (chatStarted.current) return;
    chatStarted.current = true;
    if (!hasKey) {
      setMessages([{ role: "ai", text: buildOfflineRescueReply(r, firstName) }]);
      return;
    }
    sendingRef.current = true;
    aiCall(r, [{ role: "user", text: "I'm stuck and need help." }]);
  };

  const handleSend = async () => {
    if (!input.trim() || sendingRef.current) return;
    sendingRef.current = true;
    const msg = input.trim();
    userChattedRef.current = true;
    setInput("");
    const updated = [...messages, { role: "user", text: msg }];
    setMessages(updated);
    if (!hasKey) {
      setMessages(prev => [...prev, { role: "ai", text: buildOfflineRescueReply(reason, firstName, msg) }]);
      sendingRef.current = false;
      return;
    }
    await aiCall(reason, updated);
  };

  const handleOption = (optId) => {
    if (optId === "chat")     { openChat(reason); return; }
    if (optId === "single")   { acceptRescue(); return; }
    if (optId === "easy")     { acceptRescue(); return; }
    if (optId === "braindump"){ dismissRescue("dismissed"); return; }
    if (TIMER_DURATIONS[optId]) { setTimerSecs(TIMER_DURATIONS[optId]); setStep("timer"); return; }
    acceptRescue();
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
    <button onClick={() => dismissRescue("dismissed")} style={{ background: "none", border: "none",
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
          <button onClick={acceptRescue} style={{ width: "100%", maxWidth: "360px", height: "64px",
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
