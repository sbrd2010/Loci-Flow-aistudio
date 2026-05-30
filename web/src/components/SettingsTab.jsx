import React, { useState, useEffect } from "react";
import ConfirmDialog from "./ConfirmDialog";

export default function SettingsTab({ payload, savePayload, saveSubPath, onSignOut }) {
  const { config = {} } = payload;

  // ── XP / Progress computed values ────────────────────────────────────────
  const tasks = payload.tasks || [];
  const contributions = payload.contributions || [];
  const completedTotal = tasks.filter(t => t.isCompleted && !t.isDeleted).length;
  const currentXp = Number(config.totalXp) || 0;
  const xpInLevel = currentXp % 200;
  const levelNum = Math.floor(currentXp / 200) + 1;
  const levelProgress = (xpInLevel / 200) * 100;
  const levelTitles = ["Focus Seed", "Inertia Crusher", "Momentum Builder", "Flow Finder", "Deep Worker", "Focus Master"];
  const levelTitle = `${levelTitles[Math.min(levelNum - 1, levelTitles.length - 1)]} (L${levelNum})`;

  // ── Profile form state ────────────────────────────────────────────────────
  const [editedName, setEditedName] = useState(config.userName || "");
  const [editedMentor, setEditedMentor] = useState(config.mentorName || "Marcus Aurelius");
  const [editedPomodoro, setEditedPomodoro] = useState(config.pomodoroDurationMinutes || 25);
  const [editedNagInterval, setEditedNagInterval] = useState(config.reminderNagIntervalMinutes || 15);
  const [editedEveningGuard, setEditedEveningGuard] = useState(!!config.eveningGuardWindowActive);
  const [editedChallenge, setEditedChallenge] = useState(config.challengeType || "starting");
  const [editedDayStart, setEditedDayStart] = useState(config.dayStartHour ?? 7);
  const [editedDayEnd, setEditedDayEnd] = useState(config.dayEndHour ?? 26);
  const [editedHeaderStyle, setEditedHeaderStyle] = useState(config.headerStyle || "full");
  const [editedToolsStyle, setEditedToolsStyle] = useState(config.toolsStyle || "inline");
  const [editedRoadmapStyle, setEditedRoadmapStyle] = useState(config.roadmapStyle || "compact");
  const [editedDeadlineLabel, setEditedDeadlineLabel] = useState(config.deadlineLabel || "");
  const [editedDeadlineDate, setEditedDeadlineDate] = useState(config.deadlineDate || "");

  useEffect(() => {
    setEditedName(config.userName || "");
    setEditedMentor(config.mentorName || "Marcus Aurelius");
    setEditedPomodoro(config.pomodoroDurationMinutes || 25);
    setEditedNagInterval(config.reminderNagIntervalMinutes || 15);
    setEditedEveningGuard(!!config.eveningGuardWindowActive);
    setEditedChallenge(config.challengeType || "starting");
    setEditedDayStart(config.dayStartHour ?? 7);
    setEditedDayEnd(config.dayEndHour ?? 26);
    setEditedHeaderStyle(config.headerStyle || "full");
    setEditedToolsStyle(config.toolsStyle || "inline");
    setEditedRoadmapStyle(config.roadmapStyle || "compact");
    setEditedDeadlineLabel(config.deadlineLabel || "");
    setEditedDeadlineDate(config.deadlineDate || "");
  }, [config.userName, config.mentorName, config.pomodoroDurationMinutes,
      config.reminderNagIntervalMinutes, config.eveningGuardWindowActive, config.challengeType,
      config.dayStartHour, config.dayEndHour, config.headerStyle, config.toolsStyle,
      config.roadmapStyle, config.deadlineLabel, config.deadlineDate]);

  const challengeOptions = [
    { key: "starting",   label: "Overcoming Inertia",    desc: "Can't get started on tasks.", icon: "🏁" },
    { key: "focusing",   label: "Protecting Focus",       desc: "Getting distracted mid-task.", icon: "🔵" },
    { key: "execution",  label: "Action over Planning",   desc: "Over-planning, under-doing.", icon: "⚡" },
    { key: "tracking",   label: "Time Awareness",         desc: "Losing track of time and deadlines.", icon: "🕐" }
  ];

  const [confirmDialog, setConfirmDialog] = useState(null);
  const [profileOpen, setProfileOpen] = useState(!config.userName);
  const [progressOpen, setProgressOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [aiKeysOpen, setAiKeysOpen] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);

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
        dayStartHour: editedDayStart,
        dayEndHour: editedDayEnd,
        headerStyle: editedHeaderStyle,
        toolsStyle: editedToolsStyle,
        roadmapStyle: editedRoadmapStyle,
        deadlineLabel: editedDeadlineLabel.trim(),
        deadlineDate: editedDeadlineDate,
        lastUpdated: Date.now()
      }
    });
    setSavedProfile(true);
    setTimeout(() => setSavedProfile(false), 2000);
  };

  // ── Groq API key ──────────────────────────────────────────────────────────
  const [groqInput, setGroqInput] = useState(localStorage.getItem("loci_groq_key") || "");
  const [savedGroq, setSavedGroq] = useState(false);
  const handleSaveGroq = (e) => {
    e.preventDefault();
    localStorage.setItem("loci_groq_key", groqInput.trim());
    setSavedGroq(true);
    setTimeout(() => { setSavedGroq(false); window.location.reload(); }, 1200);
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

  const groqPersonalKey = localStorage.getItem("loci_groq_key") || "";
  const groqBuiltinKey  = import.meta.env.VITE_GROQ_KEY || "";
  const groqKey         = groqPersonalKey || groqBuiltinKey;
  const personalKey     = localStorage.getItem("loci_gemini_key") || "";
  const defaultKey      = import.meta.env.VITE_GEMINI_KEY || "";
  const hasAnyKey       = !!(groqKey || personalKey || defaultKey);
  const keyStatusLabel  = groqPersonalKey
    ? "✓ Groq AI active — personal key"
    : groqBuiltinKey
    ? "✓ Groq AI active — built-in key (all users)"
    : personalKey
    ? "✓ Gemini AI active (personal key)"
    : defaultKey
    ? "✓ Gemini AI active (default key)"
    : "✗ No AI key — add Groq or Gemini below";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <section className="card">
        <button type="button" onClick={() => setProfileOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, marginBottom: profileOpen ? "16px" : 0 }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "2px", color: "var(--text-primary)" }}>
              👤 Your Profile
            </h2>
            {!profileOpen && config.userName && (
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                {config.userName} · {challengeOptions.find(o => o.key === (config.challengeType || "starting"))?.label}
              </div>
            )}
          </div>
          <span style={{ fontSize: "16px", color: "var(--text-secondary)", transition: "transform 0.2s", transform: profileOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, marginLeft: "8px" }}>▼</span>
        </button>

        {profileOpen && <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="settings-name">Your Name</label>
            <input id="settings-name" className="text-input" type="text"
              value={editedName} onChange={e => setEditedName(e.target.value)}
              placeholder="Your name" required />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="settings-mentor">AI Coach Name</label>
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
              {["Mark", "Steve", "Dianna", "Jenny"].map(name => (
                <button key={name} type="button" onClick={() => setEditedMentor(name)}
                  style={{
                    padding: "5px 16px", borderRadius: "20px", fontSize: "12.5px", fontWeight: "700",
                    cursor: "pointer", transition: "all 0.15s",
                    background: editedMentor === name ? "var(--accent)" : "var(--bg-secondary)",
                    color: editedMentor === name ? "var(--btn-text, #fff)" : "var(--text-secondary)",
                    border: editedMentor === name ? "2px solid var(--accent)" : "1.5px solid var(--border)"
                  }}>{name}</button>
              ))}
            </div>
            <input id="settings-mentor" className="text-input" type="text"
              value={editedMentor} onChange={e => setEditedMentor(e.target.value)}
              placeholder="Or type any name…" required />
          </div>

          <div className="form-group">
            <button
              type="button"
              onClick={() => setChallengeOpen(o => !o)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                width: "100%", background: "var(--bg-secondary)", border: "1.5px solid var(--border)",
                borderRadius: "var(--radius-sm)", padding: "12px 14px", cursor: "pointer",
                textAlign: "left"
              }}
            >
              <div>
                <div style={{ fontSize: "11px", fontWeight: "900", letterSpacing: "0.1em", color: "var(--text-primary)", textTransform: "uppercase" }}>
                  Your Focus Challenge
                </div>
                <div style={{ fontSize: "12px", color: "var(--accent)", fontWeight: "700", marginTop: "2px" }}>
                  {challengeOptions.find(o => o.key === editedChallenge)?.icon} {challengeOptions.find(o => o.key === editedChallenge)?.label}
                </div>
              </div>
              <span style={{ fontSize: "16px", color: "var(--text-secondary)", transition: "transform 0.2s", transform: challengeOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
            </button>
            {challengeOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                {challengeOptions.map(opt => {
                  const isSelected = editedChallenge === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => { setEditedChallenge(opt.key); setChallengeOpen(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        padding: "12px 14px", borderRadius: "var(--radius-sm)",
                        border: isSelected ? "2px solid var(--accent)" : "1.5px solid var(--border)",
                        background: isSelected ? "var(--accent-ring)" : "var(--bg-secondary)",
                        cursor: "pointer", textAlign: "left", width: "100%",
                        transition: "all 0.15s ease"
                      }}
                    >
                      <span style={{ fontSize: "20px", flexShrink: 0 }}>{opt.icon}</span>
                      <div>
                        <div style={{
                          fontSize: "13px", fontWeight: "800",
                          color: isSelected ? "var(--accent)" : "var(--text-primary)",
                          marginBottom: "2px"
                        }}>{opt.label}</div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{opt.desc}</div>
                      </div>
                      {isSelected && (
                        <span style={{ marginLeft: "auto", color: "var(--accent)", fontWeight: "800", fontSize: "16px" }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="form-group">
              <label className="form-label" htmlFor="settings-day-start">Day Starts</label>
              <select id="settings-day-start" className="text-input" value={editedDayStart}
                onChange={e => setEditedDayStart(Number(e.target.value))}>
                {[5, 6, 7, 8, 9, 10].map(h => (
                  <option key={h} value={h}>{h < 12 ? `${h}:00 AM` : "12:00 PM"}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="settings-day-end">Day Ends</label>
              <select id="settings-day-end" className="text-input" value={editedDayEnd}
                onChange={e => setEditedDayEnd(Number(e.target.value))}>
                {[17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map(h => {
                  const labels = { 17: "5 PM", 18: "6 PM", 19: "7 PM", 20: "8 PM", 21: "9 PM", 22: "10 PM", 23: "11 PM", 24: "12 AM", 25: "1 AM", 26: "2 AM", 27: "3 AM" };
                  return <option key={h} value={h}>{labels[h]}</option>;
                })}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Home Header Style</label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
              {[
                { key: "full", label: "Full card" },
                { key: "compact", label: "Compact (tap)" },
                { key: "frameless", label: "Frameless" },
                { key: "autohide", label: "Auto-hide" }
              ].map(({ key, label }) => (
                <button key={key} type="button"
                  onClick={() => setEditedHeaderStyle(key)}
                  style={{
                    padding: "6px 14px", borderRadius: "20px", fontSize: "12px", fontWeight: "700",
                    cursor: "pointer", transition: "all 0.15s",
                    background: editedHeaderStyle === key ? "var(--accent)" : "var(--bg-secondary)",
                    color: editedHeaderStyle === key ? "var(--btn-text, #fff)" : "var(--text-secondary)",
                    border: editedHeaderStyle === key ? "2px solid var(--accent)" : "1.5px solid var(--border)"
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Tools Layout</label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
              {[
                { key: "inline", label: "Inline (current)" },
                { key: "dock", label: "Floating Dock" }
              ].map(({ key, label }) => (
                <button key={key} type="button"
                  onClick={() => setEditedToolsStyle(key)}
                  style={{
                    padding: "6px 14px", borderRadius: "20px", fontSize: "12px", fontWeight: "700",
                    cursor: "pointer", transition: "all 0.15s",
                    background: editedToolsStyle === key ? "var(--accent)" : "var(--bg-secondary)",
                    color: editedToolsStyle === key ? "var(--btn-text, #fff)" : "var(--text-secondary)",
                    border: editedToolsStyle === key ? "2px solid var(--accent)" : "1.5px solid var(--border)"
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Plan Page Layout</label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
              {[
                { key: "compact", label: "Compact (pills)" },
                { key: "grid",    label: "Grid (columns)" }
              ].map(({ key, label }) => (
                <button key={key} type="button"
                  onClick={() => setEditedRoadmapStyle(key)}
                  style={{
                    padding: "6px 14px", borderRadius: "20px", fontSize: "12px", fontWeight: "700",
                    cursor: "pointer", transition: "all 0.15s",
                    background: editedRoadmapStyle === key ? "var(--accent)" : "var(--bg-secondary)",
                    color: editedRoadmapStyle === key ? "var(--btn-text, #fff)" : "var(--text-secondary)",
                    border: editedRoadmapStyle === key ? "2px solid var(--accent)" : "1.5px solid var(--border)"
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">📅 Key Deadline (home screen countdown)</label>
            <input className="text-input" type="text"
              value={editedDeadlineLabel}
              onChange={e => setEditedDeadlineLabel(e.target.value)}
              placeholder="e.g. Get a job · Exam · Birthday"
              style={{ marginBottom: "8px" }} />
            <input className="text-input" type="date"
              value={editedDeadlineDate}
              onChange={e => setEditedDeadlineDate(e.target.value)} />
            {editedDeadlineDate && (
              <button type="button"
                onClick={() => { setEditedDeadlineDate(""); setEditedDeadlineLabel(""); }}
                style={{ marginTop: "6px", fontSize: "11px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                ✕ Clear deadline
              </button>
            )}
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
        </form>}
      </section>

      {/* ── Your Progress ── */}
      <section className="card">
        <button type="button" onClick={() => setProgressOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, marginBottom: progressOpen ? "12px" : 0 }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "2px", color: "var(--text-primary)" }}>
              📈 Your Progress
            </h2>
            {!progressOpen && (
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                {levelTitle} · {xpInLevel}/200 XP
              </div>
            )}
          </div>
          <span style={{ fontSize: "16px", color: "var(--text-secondary)", transition: "transform 0.2s", transform: progressOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, marginLeft: "8px" }}>▼</span>
        </button>
        {progressOpen && <>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "14px" }}>
          XP earned by completing tasks. Levels reset every 200 XP.
        </p>
        <div style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-primary)" }}>{levelTitle}</span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{xpInLevel}/200 XP</span>
          </div>
          <div className="progress-track" style={{ height: "6px" }}>
            <div className="progress-bar" style={{ width: `${levelProgress}%` }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginTop: "12px" }}>
          {[
            { label: "Total XP", value: `⚡ ${currentXp}` },
            { label: "Completed", value: `✓ ${completedTotal}` },
            { label: "Day Streak", value: `🔥 ${config.visitStreakCount || 1}` }
          ].map(stat => (
            <div key={stat.label} style={{
              background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)",
              padding: "10px 8px", textAlign: "center"
            }}>
              <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "2px" }}>{stat.value}</div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{stat.label}</div>
            </div>
          ))}
        </div>
        </>}
      </section>

      {/* ── AI Keys ─────────────────────────────────────────────────────── */}
      <section className="card">
        <button
          type="button"
          onClick={() => setAiKeysOpen(o => !o)}
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            width: "100%", background: "none", border: "none", cursor: "pointer",
            textAlign: "left", padding: 0, marginBottom: aiKeysOpen ? "12px" : 0
          }}
        >
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "2px", color: "var(--text-primary)" }}>
              🤖 AI Keys
            </h2>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "4px 10px", borderRadius: "var(--radius-sm)",
              background: hasAnyKey ? "rgba(52, 211, 153, 0.08)" : "rgba(248, 113, 113, 0.08)",
              border: `1px solid ${hasAnyKey ? "var(--success)" : "var(--danger)"}`,
              fontSize: "11.5px", fontWeight: "600",
              color: hasAnyKey ? "var(--success)" : "var(--danger)"
            }}>
              {keyStatusLabel}
            </div>
          </div>
          <span style={{ fontSize: "16px", color: "var(--text-secondary)", transition: "transform 0.2s", transform: aiKeysOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, marginLeft: "8px" }}>▼</span>
        </button>

        {aiKeysOpen && (
          <>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
              Keys are stored only in this browser — never sent to Loci servers.
            </p>

            {/* Groq — recommended */}
            <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-primary)" }}>
                  🚀 Groq <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--success)", background: "rgba(52,211,153,0.12)", padding: "2px 6px", borderRadius: "4px", marginLeft: "4px" }}>RECOMMENDED</span>
                </span>
              </div>
              <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                Sub-200ms responses, 14,400 free requests/day. Get a key at{" "}
                <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: "600" }}>
                  console.groq.com
                </a> (free, no card needed).
              </p>
              <form onSubmit={handleSaveGroq} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input className="text-input" type="password"
                  value={groqInput} onChange={e => setGroqInput(e.target.value)}
                  placeholder="gsk_... (from Groq Console)" />
                <button className="btn" type="submit" style={{ width: "100%" }}>
                  {savedGroq ? "✓ Groq key saved — reloading..." : "Save Groq Key"}
                </button>
              </form>
            </div>

            {/* Gemini — fallback */}
            <div>
              <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-secondary)", marginBottom: "4px", display: "block" }}>
                Gemini (fallback)
              </span>
              <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                Free key from{" "}
                <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: "600" }}>
                  aistudio.google.com
                </a> — used if no Groq key is set.
              </p>
              <form onSubmit={handleSaveKey} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input className="text-input" type="password"
                  value={keyInput} onChange={e => setKeyInput(e.target.value)}
                  placeholder="AIzaSy... (from AI Studio)" />
                <button className="btn" type="submit" style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", boxShadow: "none" }}>
                  {savedKey ? "✓ Gemini key saved — reloading..." : "Save Gemini Key"}
                </button>
              </form>
            </div>
          </>
        )}
      </section>

      {/* ── Data Sync ────────────────────────────────────────────────────── */}
      <section className="card">
        <button type="button" onClick={() => setSyncOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, marginBottom: syncOpen ? "12px" : 0 }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "2px", color: "var(--text-primary)" }}>
              ☁️ Data Sync
            </h2>
            {!syncOpen && (
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                Last sync: {formatRelativeTime(payload.timestamp)}
              </div>
            )}
          </div>
          <span style={{ fontSize: "16px", color: "var(--text-secondary)", transition: "transform 0.2s", transform: syncOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, marginLeft: "8px" }}>▼</span>
        </button>
        {syncOpen && <>
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
        </>}
      </section>

      {/* ── Account ──────────────────────────────────────────────────────── */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "14px", color: "var(--text-primary)" }}>
          Account
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            className="btn"
            style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-secondary)", border: "1.5px solid var(--border)", boxShadow: "none", fontSize: "13px" }}
            onClick={() => setConfirmDialog({
              message: "Reset 7-day tracking data?\n\nThis clears the dots AND the streak counter on the Home tab. Cannot be undone.",
              confirmLabel: "Reset tracking", cancelLabel: "Cancel",
              onConfirm: () => { savePayload({ ...payload, contributions: [], config: { ...config, visitStreakCount: 0, lastUpdated: Date.now() } }); setConfirmDialog(null); },
              onCancel: () => setConfirmDialog(null)
            })}
          >
            🔄 Reset 7-day tracking data
          </button>
          <button
            className="btn"
            style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--danger)", border: "1.5px solid var(--border)", boxShadow: "none" }}
            onClick={() => setConfirmDialog({
              message: "Sign out? Your data stays saved.",
              confirmLabel: "Sign out", cancelLabel: "Cancel",
              onConfirm: () => { setConfirmDialog(null); onSignOut?.(); },
              onCancel: () => setConfirmDialog(null)
            })}
          >
            Sign out of Loci
          </button>
        </div>
      </section>

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  );
}
