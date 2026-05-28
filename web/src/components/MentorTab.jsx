import React, { useState, useEffect, useRef } from "react";

export default function MentorTab({ payload, savePayload }) {
  const { config = {} } = payload;

  // 1. Profile Settings Local States
  const [userName, setUserName] = useState(config.userName || "");
  const [mentorName, setMentorName] = useState(config.mentorName || "Yoda");
  const [challengeType, setChallengeType] = useState(config.challengeType || "Overcoming Inertia");
  const [pomodoroDuration, setPomodoroDuration] = useState(config.pomodoroDurationMinutes || 25);
  const [eveningGuard, setEveningGuard] = useState(!!config.eveningGuardWindowActive);

  // Synchronize state when config from Firebase sync triggers
  useEffect(() => {
    setUserName(config.userName || "");
    setMentorName(config.mentorName || "Yoda");
    setChallengeType(config.challengeType || "Overcoming Inertia");
    setPomodoroDuration(config.pomodoroDurationMinutes || 25);
    setEveningGuard(!!config.eveningGuardWindowActive);
  }, [config]);

  // 2. AI Mentor Chat States
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([
    {
      sender: "mentor",
      text: `Hello ${config.userName || "my friend"}. I am ${config.mentorName || "Yoda"}. As you work on "${config.challengeType || "Overcoming Inertia"}", how can I guide your focus today?`
    }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  // Sync initial welcome message if settings change
  useEffect(() => {
    if (messages.length === 1) {
      setMessages([
        {
          sender: "mentor",
          text: `Hello ${userName || "my friend"}. I am ${mentorName}. As you work on "${challengeType}", how can I guide your focus today?`
        }
      ]);
    }
  }, [userName, mentorName, challengeType]);

  // Auto scroll to chat bottom
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, chatLoading]);

  // 3. API Key local states
  const [apiKey, setApiKey] = useState(localStorage.getItem("loci_gemini_key") || "");
  const [tempKey, setTempKey] = useState(localStorage.getItem("loci_gemini_key") || "");

  const handleSaveSettings = (e) => {
    e.preventDefault();
    savePayload({
      ...payload,
      config: {
        ...config,
        userName,
        mentorName,
        challengeType,
        pomodoroDurationMinutes: Number(pomodoroDuration),
        eveningGuardWindowActive: eveningGuard
      }
    });
    alert("Profile settings synchronized and saved to Firebase Realtime Database!");
  };

  const handleSaveKey = (e) => {
    e.preventDefault();
    localStorage.setItem("loci_gemini_key", tempKey.trim());
    setApiKey(tempKey.trim());
    alert("Gemini API Key saved locally in browser storage.");
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !apiKey || chatLoading) return;

    const userText = chatInput.trim();
    setChatInput("");
    
    // Append user message
    const updatedMessages = [...messages, { sender: "user", text: userText }];
    setMessages(updatedMessages);
    setChatLoading(true);

    // Format tasks context
    const activeTodayTasks = (payload.tasks || []).filter(
      (t) => t.horizonLevel === "today" && !t.isCompleted && !t.isDeleted
    );
    const tasksSummary = activeTodayTasks.map((t) => t.title).join(", ");

    // Dialogue history serialization for continuous memory
    const historyContext = updatedMessages
      .slice(-6) // take last few messages for token economy & context
      .map((m) => `${m.sender === "user" ? userName || "User" : mentorName}: ${m.text}`)
      .join("\n");

    const systemPrompt = `You are ${mentorName}, a direct, wise, empathetic, and ADHD-friendly advisor speaking to ${userName || "User"}.
Their active ADHD challenge: ${challengeType}.
Their target commitments for today: ${tasksSummary || "None committed yet"}.

Instructions: Respond to the user's message in the voice, cadence, and personality of ${mentorName}. Keep your answer extremely brief, direct, and actionable — 2 to 3 sentences maximum. Focus on encouraging physical action and reducing cognitive freeze. Never break character.

Conversation history:
${historyContext}
${mentorName}:`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }]
        })
      });

      if (!response.ok) {
        throw new Error(`Chat error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (answer) {
        setMessages((prev) => [...prev, { sender: "mentor", text: answer.trim() }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: "mentor", text: "I struggled to process that. Please try rephrasing." }
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: "mentor", text: `Connection failure: ${err.message}` }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <h2 className="section-title">🧠 Mentor Settings & AI Dialogue</h2>

      {/* 1. Profile Settings Card */}
      <section className="card">
        <h3 style={{ fontSize: "15px", fontWeight: "700", marginBottom: "14px" }}>👤 Profile Settings</h3>
        <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          
          <div className="form-group">
            <label className="form-label" htmlFor="username-input">Your Name</label>
            <input 
              id="username-input"
              className="text-input" 
              type="text" 
              value={userName} 
              onChange={(e) => setUserName(e.target.value)} 
              placeholder="e.g. Rohan"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="mentorname-input">Mentor Avatar</label>
            <input 
              id="mentorname-input"
              className="text-input" 
              type="text" 
              value={mentorName} 
              onChange={(e) => setMentorName(e.target.value)} 
              placeholder="e.g. Yoda, Marcus Aurelius, Iron Man"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">ADHD Focus Challenge</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div 
                className={`challenge-option ${challengeType === "Overcoming Inertia" ? "selected" : ""}`}
                onClick={() => setChallengeType("Overcoming Inertia")}
              >
                <span className="challenge-title">🏁 Overcoming Inertia</span>
                <span className="challenge-desc">Struggling to start new tasks or clear executive freeze.</span>
              </div>
              <div 
                className={`challenge-option ${challengeType === "Protecting Focus" ? "selected" : ""}`}
                onClick={() => setChallengeType("Protecting Focus")}
              >
                <span className="challenge-title">🛡️ Protecting Focus</span>
                <span className="challenge-desc">Getting distracted midway, multi-tasking, or losing tracking.</span>
              </div>
              <div 
                className={`challenge-option ${challengeType === "Action over Planning" ? "selected" : ""}`}
                onClick={() => setChallengeType("Action over Planning")}
              >
                <span className="challenge-title">⚡ Action over Planning</span>
                <span className="challenge-desc">Falling into "productive procrastination" through excessive planning lists.</span>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="pomodoro-input">Default Pomodoro (Minutes)</label>
            <input 
              id="pomodoro-input"
              className="text-input" 
              type="number" 
              min="5" 
              max="120"
              value={pomodoroDuration} 
              onChange={(e) => setPomodoroDuration(e.target.value)} 
              required
            />
          </div>

          <div className="toggle-row">
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span className="challenge-title" style={{ fontSize: "13px" }}>🌙 Evening Guard Window</span>
              <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Protects the last hour of your day from high-stress tasks.</p>
            </div>
            <label className="pill-toggle">
              <input 
                type="checkbox" 
                checked={eveningGuard} 
                onChange={() => setEveningGuard(!eveningGuard)} 
              />
              <span className="pill-slider"></span>
            </label>
          </div>

          <button className="btn" type="submit" style={{ width: "100%", marginTop: "4px" }}>
            Save Profile Settings
          </button>
        </form>
      </section>

      {/* 2. AI Mentor Chat */}
      <section className="card">
        <h3 style={{ fontSize: "15px", fontWeight: "700", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>💬 Dialogue: {mentorName}</span>
          <span style={{ fontSize: "11px", fontWeight: "500", color: "var(--accent)", background: "rgba(217, 119, 87, 0.08)", padding: "2px 8px", borderRadius: "10px" }}>AI Mentor</span>
        </h3>

        <div className="chat-window">
          {messages.map((m, idx) => (
            <div 
              key={idx} 
              className={`chat-bubble ${m.sender === "user" ? "chat-bubble-user" : "chat-bubble-mentor"}`}
            >
              <span>{m.text}</span>
              <span className="chat-sender">
                {m.sender === "user" ? userName || "You" : mentorName}
              </span>
            </div>
          ))}

          {chatLoading && (
            <div className="chat-bubble chat-bubble-mentor" style={{ fontStyle: "italic", color: "var(--text-muted)", display: "flex", flexDirection: "row", gap: "4px" }}>
              <span>{mentorName} is formulating wisdom...</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {!apiKey ? (
          <div style={{ background: "rgba(217, 119, 87, 0.06)", border: "1px solid var(--accent-light)", padding: "12px", borderRadius: "8px", fontSize: "12px", color: "var(--accent-dark)", textAlign: "center" }}>
            Enter your Gemini API key below to chat with your mentor.
          </div>
        ) : (
          <form onSubmit={handleSendChat} className="chat-input-row">
            <input 
              className="text-input" 
              type="text" 
              value={chatInput} 
              onChange={(e) => setChatInput(e.target.value)} 
              placeholder={`Speak to ${mentorName}...`} 
              disabled={chatLoading}
              required
            />
            <button className="btn" type="submit" disabled={chatLoading} style={{ padding: "12px 18px" }}>
              Send
            </button>
          </form>
        )}
      </section>

      {/* 3. Gemini API Key Settings */}
      <section className="card">
        <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "8px" }}>🔑 Gemini API Connection</h3>
        <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: "1.4" }}>
          Loci Web runs local requests directly to Google Gemini Flash. Your key stays in this browser and is never uploaded anywhere. Get a free key at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: "600" }}>aistudio.google.com</a>.
        </p>
        <form onSubmit={handleSaveKey} style={{ display: "flex", gap: "10px" }}>
          <input 
            className="text-input" 
            type="password" 
            value={tempKey} 
            onChange={(e) => setTempKey(e.target.value)} 
            placeholder="AI Studio API Key (AIzaSy...)"
            required
          />
          <button className="btn" type="submit" style={{ padding: "12px 20px" }}>
            Save Key
          </button>
        </form>
      </section>

      {/* 4. Sync Status */}
      <section className="card" style={{ display: "flex", alignItems: "center", gap: "12px", background: "linear-gradient(135deg, var(--bg-card) 0%, var(--bg-secondary) 100%)" }}>
        <span style={{ fontSize: "24px" }}>🔄</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-primary)" }}>Active Sync Engine Connected</span>
          <p style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.3" }}>
            Your changes sync automatically with Firebase Realtime Database. All updates stay in sync with your Android app.
          </p>
        </div>
      </section>
    </div>
  );
}
