import React, { useState, useEffect, useRef } from "react";

export default function MentorTab({ payload, savePayload, saveSubPath }) {
  const { tasks = [], config = {} } = payload;

  // Hybrid API key resolution
  const DEFAULT_GEMINI_KEY = ""; // Baked-in fallback key placeholder
  const apiKey = localStorage.getItem("loci_gemini_key") || DEFAULT_GEMINI_KEY;

  // 1. Profile Settings Form States
  const [editedName, setEditedName] = useState(config.userName || "Anonymous");
  const [editedMentor, setEditedMentor] = useState(config.mentorName || "Mentor");
  const [editedPomodoro, setEditedPomodoro] = useState(config.pomodoroDurationMinutes || 25);
  const [editedNagInterval, setEditedNagInterval] = useState(config.reminderNagIntervalMinutes || 15);
  const [editedEveningGuard, setEditedEveningGuard] = useState(!!config.eveningGuardWindowActive);
  const [editedChallenge, setEditedChallenge] = useState(config.challengeType || "starting");

  // Sync form states with Firebase payload updates
  useEffect(() => {
    setEditedName(config.userName || "Anonymous");
    setEditedMentor(config.mentorName || "Mentor");
    setEditedPomodoro(config.pomodoroDurationMinutes || 25);
    setEditedNagInterval(config.reminderNagIntervalMinutes || 15);
    setEditedEveningGuard(!!config.eveningGuardWindowActive);
    setEditedChallenge(config.challengeType || "starting");
  }, [
    config.userName,
    config.mentorName,
    config.pomodoroDurationMinutes,
    config.reminderNagIntervalMinutes,
    config.eveningGuardWindowActive,
    config.challengeType
  ]);

  // Challenge options matching the specific original layout, text, descriptions, and icons
  const challengeOptions = [
    { key: "starting", label: "Overcoming Inertia", desc: "Struggling to start new tasks or clear executive freeze.", icon: "🏁" },
    { key: "focusing", label: "Protecting Focus", desc: "Getting distracted midway, multi-tasking, or losing tracking.", icon: "🔵" },
    { key: "execution", label: "Action over Planning", desc: "Falling into \"productive procrastination\" through excessive planning lists.", icon: "⚡" }
  ];

  // 2. AI Mentor Chat (exclusively synced with Firebase Realtime Database)
  const challengeLabel =
    config.challengeType === "starting"
      ? "Overcoming Inertia"
      : config.challengeType === "focusing"
      ? "Protecting Focus Sessions"
      : "Action over Perfectionism";

  const defaultWelcome = [
    {
      text: `Hello ${config.userName || "my friend"}. I am ${config.mentorName || "Mentor"}. As you struggle with "${challengeLabel}", how can I guide your focus today?`,
      isUser: false
    }
  ];

  const chatHistory = payload.chatHistory && payload.chatHistory.length > 0
    ? payload.chatHistory
    : defaultWelcome;

  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  // Smooth scroll chat to bottom inside its container (prevents full window scrolling)
  useEffect(() => {
    if (chatBottomRef.current) {
      const container = chatBottomRef.current.parentElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [chatHistory, chatLoading]);

  // 3. API Key Connection Local States
  const [keyInput, setKeyInput] = useState(localStorage.getItem("loci_gemini_key") || "");

  const handleSaveSettings = (e) => {
    e.preventDefault();
    const updated = {
      ...config,
      userName: editedName,
      mentorName: editedMentor,
      challengeType: editedChallenge,
      pomodoroDurationMinutes: parseInt(editedPomodoro) || 25,
      reminderNagIntervalMinutes: parseInt(editedNagInterval) || 15,
      eveningGuardWindowActive: editedEveningGuard
    };
    savePayload({ ...payload, config: updated });
    alert("Settings saved and synced to Firebase Realtime Database!");
  };

  /**
   * FIX (Step 6): handleSendChat now uses saveSubPath() for atomic chatHistory writes.
   * This prevents the AI reply (arriving 3-5s later) from overwriting any task/config 
   * changes made by the user during that window.
   */
  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !apiKey || chatLoading) return;

    const userText = chatInput.trim();
    setChatInput("");

    // Fix #22: Cap chat history at 40 messages to prevent unbounded payload growth
    const MAX_CHAT_HISTORY = 40;
    const trimmedHistory = chatHistory.length >= MAX_CHAT_HISTORY
      ? chatHistory.slice(chatHistory.length - MAX_CHAT_HISTORY + 1)
      : chatHistory;

    // Append user message directly to sub-path (safe merge — won't stomp tasks)
    const withUserMessage = [...trimmedHistory, { text: userText, isUser: true }];
    saveSubPath("chatHistory", withUserMessage);
    setChatLoading(true);

    // AI Configuration and Prompt Construction exactly as specified
    const challengeDesc = {
      starting: "Overcoming inertia and getting started",
      focusing: "Protecting deep focus sessions",
      execution: "Favoring action over perfectionism"
    }[config.challengeType] || "managing focus";

    const systemPrompt = `You are ${config.mentorName || 'Mentor'}, speaking to ${config.userName || 'Anonymous'}. They struggle with ${challengeDesc}. 
Respond in the voice of ${config.mentorName || 'Mentor'}. Be direct, wise, concise. Max 2-3 sentences. No flowery text.`;

    // Fix #23: Include last 6 messages for conversation memory
    const recentHistory = withUserMessage.slice(-7, -1); // last 6 before the current message
    const historyContext = recentHistory.length > 0
      ? "\n\nRecent conversation:\n" + recentHistory
          .map(m => `${m.isUser ? config.userName || 'User' : config.mentorName || 'Mentor'}: ${m.text}`)
          .join("\n")
      : "";

    const prompt = `${systemPrompt}${historyContext}\n\nUser message: "${userText}"\n\nRespond now:`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        throw new Error(`Chat error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const mentorReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I hear you. Keep going.";

      // Write reply directly to chatHistory sub-path — safe from task write races
      saveSubPath("chatHistory", [...withUserMessage, { text: mentorReply.trim(), isUser: false }]);
    } catch (err) {
      saveSubPath("chatHistory", [...withUserMessage, { text: `Error connecting to AI: ${err.message}`, isUser: false }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSaveKey = (e) => {
    e.preventDefault();
    localStorage.setItem("loci_gemini_key", keyInput.trim());
    alert("Key saved ✓");
    window.location.reload(); // Refresh to update hybrid fallback resolving state
  };

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return "Never";
    const diff = Date.now() - timestamp;
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 1. Profile Settings Form Section */}
      <section className="card">
        <h3 className="challenge-title" style={{ fontSize: "15px", fontWeight: "700", marginBottom: "14px" }}>
          Profile & Mentor Settings
        </h3>
        <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          
          <div className="form-group">
            <label className="form-label" htmlFor="name-input">Your Name</label>
            <input 
              id="name-input"
              className="text-input" 
              type="text" 
              value={editedName} 
              onChange={(e) => setEditedName(e.target.value)} 
              placeholder="Your Name"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="mentor-input">Mentor Name</label>
            <input 
              id="mentor-input"
              className="text-input" 
              type="text" 
              value={editedMentor} 
              onChange={(e) => setEditedMentor(e.target.value)} 
              placeholder="Mentor Name"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">ADHD Focus Challenge</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {challengeOptions.map((opt) => (
                <div 
                  key={opt.key}
                  className={`challenge-option ${editedChallenge === opt.key ? "selected" : ""}`}
                  onClick={() => setEditedChallenge(opt.key)}
                  style={{ 
                    display: "grid", 
                    gridTemplateColumns: "120px 1fr", 
                    alignItems: "center", 
                    gap: "16px",
                    cursor: "pointer",
                    padding: "12px 16px"
                  }}
                >
                  <span className="challenge-title" style={{ fontSize: "13px", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px", color: "var(--text-primary)" }}>
                    {opt.icon} {opt.label}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.4", textAlign: "left" }}>
                    {opt.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="pomodoro-duration-input">Pomodoro (min) — max 120</label>
            <input 
              id="pomodoro-duration-input"
              className="text-input" 
              type="number" 
              min="1"
              max="120"
              value={editedPomodoro} 
              onChange={(e) => setEditedPomodoro(Math.min(120, Math.max(1, Number(e.target.value) || 25)))} 
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="nag-interval-input">Nag Interval (min) — max 60</label>
            <input 
              id="nag-interval-input"
              className="text-input" 
              type="number" 
              min="1"
              max="60"
              value={editedNagInterval} 
              onChange={(e) => setEditedNagInterval(Math.min(60, Math.max(1, Number(e.target.value) || 15)))} 
              required
            />
          </div>

          <div 
            className="toggle-row" 
            onClick={() => setEditedEveningGuard(!editedEveningGuard)}
            style={{ cursor: "pointer", padding: "4px 0" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span className="challenge-title" style={{ fontSize: "13.5px", fontWeight: "700" }}>🌙 Evening Guard Window</span>
              <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", lineHeight: "1.3" }}>
                Protects the last hour of your day from high-stress tasks.
              </p>
            </div>
            <input 
              type="checkbox" 
              className="pill-toggle"
              checked={editedEveningGuard}
              readOnly
            />
          </div>

          <button className="btn" type="submit" style={{ width: "100%", marginTop: "4px" }}>
            Save Settings
          </button>
        </form>
      </section>

      {/* 2. AI Mentor Chat Section */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 className="challenge-title" style={{ fontSize: "15px", fontWeight: "700" }}>
            Chat with {config.mentorName || "Mentor"}...
          </h3>
          {payload.chatHistory && payload.chatHistory.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm("Are you sure you want to clear your chat history?")) {
                  saveSubPath("chatHistory", null);
                }
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--danger)",
                fontSize: "11px",
                fontWeight: "700",
                cursor: "pointer",
                padding: "2px 6px"
              }}
            >
              🗑️ Clear Chat
            </button>
          )}
        </div>

        <div className="chat-window">
          {chatHistory.map((m, idx) => (
            <div 
              key={idx} 
              className={`chat-bubble ${m.isUser ? "chat-bubble-user" : "chat-bubble-mentor"}`}
              style={{ alignSelf: m.isUser ? "flex-end" : "flex-start" }}
            >
              <span>{m.text}</span>
              <div className="chat-sender" style={{ color: m.isUser ? "rgba(255,255,255,0.7)" : "var(--text-muted)" }}>
                {m.isUser ? "You" : config.mentorName || "Mentor"}
              </div>
            </div>
          ))}

          {chatLoading && (
            <div className="chat-bubble chat-bubble-mentor" style={{ fontStyle: "italic", color: "var(--text-muted)", alignSelf: "flex-start" }}>
              <span>{config.mentorName || "Mentor"} is typing...</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {!apiKey ? (
          <div style={{ background: "rgba(217, 119, 87, 0.06)", border: "1px solid var(--accent-light)", padding: "12px", borderRadius: "8px", fontSize: "12px", color: "var(--accent-dark)", textAlign: "center" }}>
            🔑 Add your Gemini API key below to chat with your mentor.
          </div>
        ) : (
          <form onSubmit={handleSendChat} className="chat-input-row">
            <input 
              className="text-input" 
              type="text" 
              value={chatInput} 
              onChange={(e) => setChatInput(e.target.value)} 
              placeholder={`Speak to ${config.mentorName || "Mentor"}...`} 
              disabled={chatLoading}
              required
            />
            {chatLoading ? (
              <span style={{ fontSize: "12px", color: "var(--text-muted)", padding: "0 10px" }}>Sending...</span>
            ) : (
              <button className="btn" type="submit" disabled={chatLoading || !chatInput.trim()}>
                Send
              </button>
            )}
          </form>
        )}
      </section>

      {/* 3. Gemini API Key Settings Section — BYOK Local Mode (Step 7) */}
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <h3 className="challenge-title" style={{ fontSize: "15px", fontWeight: "700" }}>
            🔑 Bring Your Own Key (BYOK) — Local Mode
          </h3>
        </div>
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", marginBottom: "12px", fontSize: "11.5px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
          <strong>🔒 Privacy Note:</strong> Your API key is stored exclusively in <em>this browser's localStorage</em>. It is never sent to any Loci server — only to Google's Generative Language API on your behalf. Clearing browser data removes the key.
          <br/>
          <span style={{ color: "var(--text-muted)", fontSize: "10.5px" }}>Step 8 note: The key is sent as a URL query parameter to the Gemini REST API, which is standard for client-side BYOK apps. Use a project-scoped key from AI Studio to limit exposure.</span>
        </div>
        <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: "1.4" }}>
          Get a free Gemini API key at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: "600" }}>https://aistudio.google.com</a>
        </p>
        <form onSubmit={handleSaveKey} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="gemini-key-input">Gemini API Key</label>
            <input 
              id="gemini-key-input"
              className="text-input" 
              type="password" 
              value={keyInput} 
              onChange={(e) => setKeyInput(e.target.value)} 
              placeholder="AIzaSy... (from AI Studio)"
              required
            />
          </div>
          <button className="btn" type="submit" style={{ width: "100%", marginTop: "4px" }}>
            Save Key Locally
          </button>
        </form>
      </section>

      {/* 4. Sync Status Info Section */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h3 className="challenge-title" style={{ fontSize: "14px", fontWeight: "700" }}>
          Data Sync Status
        </h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
          ✓ All tasks, settings, and focus state sync automatically via Firebase Realtime Database.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>Email</span>
            <span style={{ color: "var(--text-primary)", fontWeight: "700" }}>{config.userId || "Active User"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>Last Sync</span>
            <span style={{ color: "var(--text-primary)", fontWeight: "700" }}>{formatRelativeTime(payload.timestamp)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>Tasks</span>
            <span style={{ color: "var(--text-primary)", fontWeight: "700" }}>{(payload.tasks || []).filter(t => !t.isDeleted).length} active</span>
          </div>
        </div>
        <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          Changes on Android and Web stay in sync instantly.
        </p>
      </section>
    </div>
  );
}
