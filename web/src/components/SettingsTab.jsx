import React, { useState, useEffect } from "react";

export default function SettingsTab({ payload, savePayload, saveSubPath }) {
  const { config = {} } = payload;

  // ── Profile form state ────────────────────────────────────────────────────
  const [editedName, setEditedName] = useState(config.userName || "");
  const [editedMentor, setEditedMentor] = useState(config.mentorName || "Marcus Aurelius");
  const [editedPomodoro, setEditedPomodoro] = useState(config.pomodoroDurationMinutes || 25);
  const [editedNagInterval, setEditedNagInterval] = useState(config.reminderNagIntervalMinutes || 15);
  const [editedEveningGuard, setEditedEveningGuard] = useState(!!config.eveningGuardWindowActive);
  const [editedChallenge, setEditedChallenge] = useState(config.challengeType || "starting");

  useEffect(() => {
    setEditedName(config.userName || "");
    setEditedMentor(config.mentorName || "Marcus Aurelius");
    setEditedPomodoro(config.pomodoroDurationMinutes || 25);
    setEditedNagInterval(config.reminderNagIntervalMinutes || 15);
    setEditedEveningGuard(!!config.eveningGuardWindowActive);
    setEditedChallenge(config.challengeType || "starting");
  }, [config.userName, config.mentorName, config.pomodoroDurationMinutes,
      config.reminderNagIntervalMinutes, config.eveningGuardWindowActive, config.challengeType]);

  const challengeOptions = [
    { key: "starting",   label: "Overcoming Inertia",    desc: "Can't get started on tasks.", icon: "🏁" },
    { key: "focusing",   label: "Protecting Focus",       desc: "Getting distracted mid-task.", icon: "🔵" },
    { key: "execution",  label: "Action over Planning",   desc: "Over-planning, under-doing.", icon: "⚡" }
  ];

  const [savedProfile, setSavedProfile] = useState(false);
  const handleSaveSettings = (e) => {
    e.preventDefault();
    savePayload({
      ...payload,
      config: {
        ...config,
        userName: editedName.trim(),
        mentorName: editedMentor.trim(),
        challengeType: editedChallenge,
        pomodoroDurationMinutes: Math.min(120, Math.max(1, parseInt(editedPomodoro) || 25)),
        reminderNagIntervalMinutes: Math.min(60, Math.max(1, parseInt(editedNagInterval) || 15)),
        eveningGuardWindowActive: editedEveningGuard,
        lastUpdated: Date.now()
      }
    });
    setSavedProfile(true);
    setTimeout(() => setSavedProfile(false), 2000);
  };

  // ── Gemini API key ────────────────────────────────────────────────────────
  const [keyInput, setKeyInput] = useState(localStorage.getItem("loci_gemini_key") || "");
  const [savedKey, setSavedKey] = useState(false);
  const handleSaveKey = (e) => {
    e.preventDefault();
    localStorage.setItem("loci_gemini_key", keyInput.trim());
    setSavedKey(true);
    setTimeout(() => { setSavedKey(false); window.location.reload(); }, 1200);
  };

  // ── Sync status ───────────────────────────────────────────────────────────
  const formatRelativeTime = (ts) => {
    if (!ts) return "Never";
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  const hasApiKey = !!localStorage.getItem("loci_gemini_key");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "4px", color: "var(--text-primary)" }}>
          Your Profile
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "18px" }}>
          Personalise your name, coaching mentor and focus settings.
        </p>

        <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="settings-name">Your Name</label>
            <input id="settings-name" className="text-input" type="text"
              value={editedName} onChange={e => setEditedName(e.target.value)}
              placeholder="Your name" required />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="settings-mentor">AI Mentor Name</label>
            <input id="settings-mentor" className="text-input" type="text"
              value={editedMentor} onChange={e => setEditedMentor(e.target.value)}
              placeholder="e.g. Marcus Aurelius" required />
          </div>

          <div className="form-group">
            <label className="form-label">Your Biggest ADHD Challenge</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {challengeOptions.map(opt => (
                <div
                  key={opt.key}
                  className={`challenge-option ${editedChallenge === opt.key ? "selected" : ""}`}
                  onClick={() => setEditedChallenge(opt.key)}
                  style={{ cursor: "pointer", padding: "10px 14px" }}
                >
                  <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
                    {opt.icon} {opt.label}
                  </span>
                  <span style={{ fontSize: "11.5px", color: "var(--text-secondary)", display: "block", marginTop: "2px" }}>
                    {opt.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="form-group">
              <label className="form-label" htmlFor="settings-pomodoro">Focus Timer (min)</label>
              <input id="settings-pomodoro" className="text-input" type="number"
                min="1" max="120" value={editedPomodoro}
                onChange={e => setEditedPomodoro(Math.min(120, Math.max(1, Number(e.target.value) || 25)))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="settings-nag">Reminder (min)</label>
              <input id="settings-nag" className="text-input" type="number"
                min="1" max="60" value={editedNagInterval}
                onChange={e => setEditedNagInterval(Math.min(60, Math.max(1, Number(e.target.value) || 15)))} />
            </div>
          </div>

          <div
            className="toggle-row"
            onClick={() => setEditedEveningGuard(!editedEveningGuard)}
            style={{ cursor: "pointer" }}
          >
            <div>
              <span style={{ fontSize: "13.5px", fontWeight: "700", color: "var(--text-primary)" }}>
                🌙 Evening Guard (after 8 PM)
              </span>
              <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
                Blocks adding new tasks after 8 PM to protect your wind-down.
              </p>
            </div>
            <input type="checkbox" className="pill-toggle" checked={editedEveningGuard} readOnly />
          </div>

          <button className="btn" type="submit" style={{ width: "100%", marginTop: "4px" }}>
            {savedProfile ? "✓ Saved!" : "Save Profile"}
          </button>
        </form>
      </section>

      {/* ── AI API Key ───────────────────────────────────────────────────── */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "4px", color: "var(--text-primary)" }}>
          🔑 AI Mentor Key
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
          The AI mentor chat on the Coach tab uses Gemini. Add your free API key from{" "}
          <a href="https://aistudio.google.com" target="_blank" rel="noreferrer"
            style={{ color: "var(--accent)", fontWeight: "600" }}>
            aistudio.google.com
          </a>
        </p>

        <div style={{
          background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)",
          padding: "10px 12px", marginBottom: "14px",
          fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.5"
        }}>
          🔒 Stored only in <em>this browser</em>. Never sent to Loci servers — only to Google's API on your behalf.
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px",
          padding: "8px 12px", borderRadius: "var(--radius-sm)",
          background: hasApiKey ? "rgba(52, 211, 153, 0.08)" : "rgba(248, 113, 113, 0.08)",
          border: `1px solid ${hasApiKey ? "var(--success)" : "var(--danger)"}`,
          fontSize: "12px", fontWeight: "600",
          color: hasApiKey ? "var(--success)" : "var(--danger)"
        }}>
          {hasApiKey ? "✓ API key connected" : "✗ No key — AI features disabled"}
        </div>

        <form onSubmit={handleSaveKey} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="gemini-key">Gemini API Key</label>
            <input id="gemini-key" className="text-input" type="password"
              value={keyInput} onChange={e => setKeyInput(e.target.value)}
              placeholder="AIzaSy... (from AI Studio)" />
          </div>
          <button className="btn" type="submit" style={{ width: "100%" }}>
            {savedKey ? "✓ Key saved — reloading..." : "Save Key"}
          </button>
        </form>
      </section>

      {/* ── Data Sync ────────────────────────────────────────────────────── */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "4px", color: "var(--text-primary)" }}>
          Data Sync
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px" }}>
          Your tasks sync instantly with Firebase across all your devices.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {[
            { label: "Account", value: config.userId || "Active User" },
            { label: "Last Sync", value: formatRelativeTime(payload.timestamp) },
            { label: "Active Tasks", value: `${(payload.tasks || []).filter(t => !t.isDeleted && !t.isCompleted).length} tasks` },
            { label: "Total XP", value: `${Number(config.totalXp) || 0} XP` }
          ].map(row => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px" }}>
              <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>{row.label}</span>
              <span style={{ color: "var(--text-primary)", fontWeight: "700" }}>{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "14px", color: "var(--text-primary)" }}>
          Account
        </h2>
        <button
          className="btn"
          style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--danger)", border: "1.5px solid var(--border)", boxShadow: "none" }}
          onClick={() => {
            if (window.confirm("Sign out? Your data stays saved in Firebase.")) {
              localStorage.removeItem("loci_email");
              window.location.reload();
            }
          }}
        >
          Sign Out
        </button>
      </section>

    </div>
  );
}
