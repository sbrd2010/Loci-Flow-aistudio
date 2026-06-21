import React, { useState, useEffect } from "react";
import ConfirmDialog from "./ConfirmDialog";
import PrivacyPolicy from "./PrivacyPolicy";
import { db, auth } from "../firebase";
import { ref, push } from "firebase/database";
import { exportPayloadAsJson, exportTasksAsCsv } from "../utils/exportTasks";
import { parseTimeToMinutes } from "../utils/focusWindows";
import { COACH_PERSONAS, normalizeCoachPersona } from "../utils/coachPersona";
import { COACH_PROFILE_NOTE_MAX_LENGTH } from "../utils/coachProfile";
import { clearAllMemory, isMemoryEnabled, removePinnedFact, removeRecentObservation } from "../utils/coachMemory";

export default function SettingsTab({ payload, savePayload, saveSubPath, saveConfigPatch, lastSyncedAt, onSignOut }) {
  const { config = {} } = payload;
  const pinnedFacts = config.coachMemory?.pinnedFacts || [];
  const recentObservations = config.coachMemory?.recentObservations || [];
  const coachMemoryEnabled = isMemoryEnabled(config);

  // ── XP / Progress computed values ────────────────────────────────────────
  const contributions = payload.contributions || [];

  const normalizeChallengeKey = (key) => {
    const legacy = { starting: "initiation", focusing: "momentum", execution: "overplanner", tracking: "overwhelmed" };
    return legacy[key] || key || "overplanner";
  };


  // ── Profile form state ────────────────────────────────────────────────────
  const [editedName, setEditedName] = useState(config.userName || "");
  const [editedMentor, setEditedMentor] = useState(config.mentorName || "Marcus Aurelius");
  const [editedPomodoro, setEditedPomodoro] = useState(config.pomodoroDurationMinutes || 25);
  const [editedNagInterval, setEditedNagInterval] = useState(config.reminderNagIntervalMinutes || 15);
  const [editedEveningGuard, setEditedEveningGuard] = useState(!!config.eveningGuardWindowActive);
  const [editedChallenge, setEditedChallenge] = useState(() => normalizeChallengeKey(config.challengeType));
  const [editedFocusWindows, setEditedFocusWindows] = useState(config.focusWindows || []);
  const [editedMorningRitualStart, setEditedMorningRitualStart] = useState(config.morningRitualWindowStart || "05:00");
  const [editedMorningRitualEnd, setEditedMorningRitualEnd] = useState(config.morningRitualWindowEnd || "11:00");
  const [editedMorningRitualEnabled, setEditedMorningRitualEnabled] = useState(config.morningRitualEnabled !== false);
  const [editedCoachNudgesEnabled, setEditedCoachNudgesEnabled] = useState(config.coachNudgesEnabled !== false);
  const [editedCoachPersona, setEditedCoachPersona] = useState(() => normalizeCoachPersona(config.coachPersona));
  const [editedCoachPersonaNote, setEditedCoachPersonaNote] = useState(config.coachPersonaNote || "");
  const [editedCoachProfileNote, setEditedCoachProfileNote] = useState(config.coachProfileNote || "");
  const [editedHeaderStyle, setEditedHeaderStyle] = useState(
    config.headerStyle === "autohide" ? "frameless" : (config.headerStyle || "full")
  );
  const [editedToolsStyle, setEditedToolsStyle] = useState(config.toolsStyle || "inline");
  const [editedDeadlineLabel, setEditedDeadlineLabel] = useState(config.deadlineLabel || "");
  const [editedDeadlineDate, setEditedDeadlineDate] = useState(config.deadlineDate || "");
  const [editedDeadlineStartDate, setEditedDeadlineStartDate] = useState(config.deadlineStartDate || "");
  const [editedDeadlineAction, setEditedDeadlineAction] = useState(config.deadlineAction || "");

  useEffect(() => {
    setEditedName(config.userName || "");
    setEditedMentor(config.mentorName || "Marcus Aurelius");
    setEditedPomodoro(config.pomodoroDurationMinutes || 25);
    setEditedNagInterval(config.reminderNagIntervalMinutes || 15);
    setEditedEveningGuard(!!config.eveningGuardWindowActive);
    setEditedChallenge(normalizeChallengeKey(config.challengeType));
    setEditedFocusWindows(config.focusWindows || []);
    setEditedMorningRitualStart(config.morningRitualWindowStart || "05:00");
    setEditedMorningRitualEnd(config.morningRitualWindowEnd || "11:00");
    setEditedMorningRitualEnabled(config.morningRitualEnabled !== false);
    setEditedCoachNudgesEnabled(config.coachNudgesEnabled !== false);
    setEditedCoachPersona(normalizeCoachPersona(config.coachPersona));
    setEditedCoachPersonaNote(config.coachPersonaNote || "");
    setEditedCoachProfileNote(config.coachProfileNote || "");
    setEditedHeaderStyle(config.headerStyle === "autohide" ? "frameless" : (config.headerStyle || "full"));
    setEditedToolsStyle(config.toolsStyle || "inline");
    setEditedDeadlineLabel(config.deadlineLabel || "");
    setEditedDeadlineDate(config.deadlineDate || "");
    setEditedDeadlineStartDate(config.deadlineStartDate || "");
    setEditedDeadlineAction(config.deadlineAction || "");
  }, [config.userName, config.mentorName, config.pomodoroDurationMinutes,
      config.reminderNagIntervalMinutes, config.eveningGuardWindowActive, config.challengeType,
      config.focusWindows,
      config.morningRitualWindowStart, config.morningRitualWindowEnd, config.morningRitualEnabled, config.coachNudgesEnabled, config.headerStyle, config.toolsStyle,
      config.deadlineLabel, config.deadlineDate,
      config.deadlineStartDate, config.deadlineAction,
      config.coachPersona, config.coachPersonaNote, config.coachProfileNote]);

  // ── Focus window editing helpers ─────────────────────────────────────────
  const handleAddFocusWindow = () => {
    setEditedFocusWindows([...editedFocusWindows, { start: "09:00", end: "17:00" }]);
  };

  const handleRemoveFocusWindow = (idx) => {
    setEditedFocusWindows(editedFocusWindows.filter((_, i) => i !== idx));
  };

  const handleFocusWindowChange = (idx, field, value) => {
    setEditedFocusWindows(editedFocusWindows.map((w, i) => i === idx ? { ...w, [field]: value } : w));
  };

  const challengeOptions = [
    {
      key: "overplanner", icon: "🎯",
      label: "Help me decide what to work on",
      desc: "AI Coach focuses on priority clarity. You'll get prompts to narrow down to the one thing that matters right now."
    },
    {
      key: "initiation", icon: "🧊",
      label: "Help me just start",
      desc: "Coach uses micro-commitments and tiny first steps. Tasks get broken down to reduce the friction of starting."
    },
    {
      key: "momentum", icon: "⚡",
      label: "Keep me moving forward",
      desc: "Coach tracks wins and streaks. Reminders focus on sustaining energy and building on each completed task."
    },
    {
      key: "overwhelmed", icon: "🌱",
      label: "Help me recover and catch up",
      desc: "Coach uses gentle, shame-free prompts. Clean Slate and Bad Day Reset tools are always front and center."
    }
  ];

  const [confirmDialog, setConfirmDialog] = useState(null);
  const [profileOpen, setProfileOpen] = useState(!config.userName);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // ── Bug report form ──────────────────────────────────────────────────────
  const [showBugForm, setShowBugForm] = useState(false);
  const [bugWhat, setBugWhat] = useState("");
  const [bugSteps, setBugSteps] = useState("");
  const [bugDevice, setBugDevice] = useState("");
  const [bugSubmitting, setBugSubmitting] = useState(false);
  const [bugSuccess, setBugSuccess] = useState(false);
  const [bugError, setBugError] = useState("");

  const handleBugSubmit = async (e) => {
    e.preventDefault();
    if (!bugWhat.trim()) return;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setBugError("Couldn't submit - check your connection and try again.");
      return;
    }
    setBugSubmitting(true);
    setBugError("");
    try {
      await push(ref(db, "bugReports"), {
        what: bugWhat.trim(),
        steps: bugSteps.trim(),
        device: bugDevice.trim(),
        userId: uid,
        userEmail: auth.currentUser?.email || null,
        appVersion: import.meta.env.VITE_APP_VERSION || "dev",
        submittedAt: Date.now()
      });
      setBugSuccess(true);
      setBugWhat(""); setBugSteps(""); setBugDevice("");
      setTimeout(() => { setBugSuccess(false); setShowBugForm(false); }, 2500);
    } catch (_) {
      setBugError("Couldn't submit - check your connection and try again.");
    } finally {
      setBugSubmitting(false);
    }
  };

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifPermission, setNotifPermission] = useState(() =>
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  const requestNotifPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  };
  const [syncOpen, setSyncOpen] = useState(false);
  const [aiKeysOpen, setAiKeysOpen] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [exportError, setExportError] = useState("");

  const [savedProfile, setSavedProfile] = useState(false);
  const handleSaveSettings = (e) => {
    e.preventDefault();
    const morningRitualStart = parseTimeToMinutes(editedMorningRitualStart);
    const morningRitualEnd = parseTimeToMinutes(editedMorningRitualEnd);
    const morningRitualValid = morningRitualStart !== null && morningRitualEnd !== null && morningRitualStart < morningRitualEnd;
    saveSubPath("config", {
      ...config,
      userName: editedName.trim(),
      mentorName: editedMentor.trim(),
      challengeType: editedChallenge,
      pomodoroDurationMinutes: Math.min(120, Math.max(1, parseInt(editedPomodoro) || 25)),
      reminderNagIntervalMinutes: Math.min(60, Math.max(1, parseInt(editedNagInterval) || 15)),
      eveningGuardWindowActive: editedEveningGuard,
      focusWindows: editedFocusWindows.filter(w => w.start && w.end && w.start !== w.end),
      morningRitualWindowStart: morningRitualValid ? editedMorningRitualStart : "05:00",
      morningRitualWindowEnd: morningRitualValid ? editedMorningRitualEnd : "11:00",
      morningRitualEnabled: editedMorningRitualEnabled,
      coachNudgesEnabled: editedCoachNudgesEnabled,
      coachPersona: editedCoachPersona,
      coachPersonaNote: editedCoachPersonaNote.trim().slice(0, 300),
      coachProfileNote: editedCoachProfileNote.trim().slice(0, COACH_PROFILE_NOTE_MAX_LENGTH),
      headerStyle: editedHeaderStyle,
      toolsStyle: editedToolsStyle,
      roadmapStyle: "compact",
      deadlineLabel: editedDeadlineLabel.trim(),
      deadlineDate: editedDeadlineDate,
      deadlineStartDate: editedDeadlineStartDate,
      deadlineAction: editedDeadlineAction.trim(),
      deadlineCardStyle: "compact",
      lastUpdated: Date.now()
    });
    setSavedProfile(true);
    setTimeout(() => { setSavedProfile(false); setProfileOpen(false); }, 2000);
  };

  // ── Groq API key ──────────────────────────────────────────────────────────
  const [groqInput, setGroqInput] = useState(localStorage.getItem("loci_groq_key") || "");
  const [savedGroq, setSavedGroq] = useState(false);
  const handleSaveGroq = (e) => {
    e.preventDefault();
    try { localStorage.setItem("loci_groq_key", groqInput.trim()); } catch (_) {}
    setSavedGroq(true);
    setTimeout(() => setSavedGroq(false), 2000);
  };

  // ── Gemini API key ────────────────────────────────────────────────────────
  const [keyInput, setKeyInput] = useState(localStorage.getItem("loci_gemini_key") || "");
  const [savedKey, setSavedKey] = useState(false);
  const handleSaveKey = (e) => {
    e.preventDefault();
    try { localStorage.setItem("loci_gemini_key", keyInput.trim()); } catch (_) {}
    setSavedKey(true);
    setTimeout(() => setSavedKey(false), 2000);
  };

  // ── NVIDIA API key ────────────────────────────────────────────────────────
  const [nvidiaInput, setNvidiaInput] = useState(localStorage.getItem("loci_nvidia_key") || "");
  const [savedNvidia, setSavedNvidia] = useState(false);
  const handleSaveNvidia = (e) => {
    e.preventDefault();
    try { localStorage.setItem("loci_nvidia_key", nvidiaInput.trim()); } catch (_) {}
    setSavedNvidia(true);
    setTimeout(() => setSavedNvidia(false), 2000);
  };

  // ── Cerebras API key ──────────────────────────────────────────────────────
  const [cerebrasInput, setCerebrasInput] = useState(localStorage.getItem("loci_cerebras_key") || "");
  const [savedCerebras, setSavedCerebras] = useState(false);
  const handleSaveCerebras = (e) => {
    e.preventDefault();
    try { localStorage.setItem("loci_cerebras_key", cerebrasInput.trim()); } catch (_) {}
    setSavedCerebras(true);
    setTimeout(() => setSavedCerebras(false), 2000);
  };

  // ── Z.ai API key ──────────────────────────────────────────────────────────
  const [zaiInput, setZaiInput] = useState(localStorage.getItem("loci_zai_key") || "");
  const [savedZai, setSavedZai] = useState(false);
  const handleSaveZai = (e) => {
    e.preventDefault();
    try { localStorage.setItem("loci_zai_key", zaiInput.trim()); } catch (_) {}
    setSavedZai(true);
    setTimeout(() => setSavedZai(false), 2000);
  };

  // ── Provider preference ───────────────────────────────────────────────────
  const [providerPref, setProviderPref] = useState(localStorage.getItem("loci_provider_pref") || "auto");
  const handleProviderPref = (pref) => {
    setProviderPref(pref);
    try { localStorage.setItem("loci_provider_pref", pref); } catch (_) {}
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

  const groqPersonalKey     = localStorage.getItem("loci_groq_key")     || "";
  const groqBuiltinKey      = import.meta.env.VITE_GROQ_KEY             || "";
  const nvidiaPersonalKey   = localStorage.getItem("loci_nvidia_key")   || "";
  const nvidiaBuiltinKey    = import.meta.env.VITE_NVIDIA_KEY           || "";
  const geminiPersonalKey   = localStorage.getItem("loci_gemini_key")   || "";
  const geminiBuiltinKey    = import.meta.env.VITE_GEMINI_KEY           || "";
  const cerebrasPersonalKey = localStorage.getItem("loci_cerebras_key") || "";
  const cerebrasBuiltinKey  = import.meta.env.VITE_CEREBRAS_KEY         || "";
  const zaiPersonalKey      = localStorage.getItem("loci_zai_key")      || "";
  const zaiBuiltinKey       = import.meta.env.VITE_ZAI_KEY              || "";
  const effectiveGroqKey     = groqPersonalKey     || groqBuiltinKey;
  const effectiveNvidiaKey   = nvidiaPersonalKey   || nvidiaBuiltinKey;
  const effectiveGeminiKey   = geminiPersonalKey   || geminiBuiltinKey;
  const effectiveCerebrasKey = cerebrasPersonalKey || cerebrasBuiltinKey;
  const effectiveZaiKey      = zaiPersonalKey      || zaiBuiltinKey;
  const hasAnyKey          = !!(effectiveGroqKey || effectiveNvidiaKey || effectiveGeminiKey || effectiveCerebrasKey || effectiveZaiKey);

  const prefOrders = {
    auto:     ["groq", "cerebras", "zai", "gemini"],
    groq:     ["groq", "cerebras", "zai", "gemini"],
    cerebras: ["cerebras", "groq", "zai", "gemini"],
    zai:      ["zai", "groq", "cerebras", "gemini"],
    gemini:   ["gemini", "groq", "cerebras", "zai"],
    nvidia:   ["nvidia", "groq", "cerebras", "zai", "gemini"],
  };
  const effectiveKeyMap  = { groq: effectiveGroqKey, nvidia: effectiveNvidiaKey, gemini: effectiveGeminiKey, cerebras: effectiveCerebrasKey, zai: effectiveZaiKey };
  const personalKeyMap   = { groq: groqPersonalKey, nvidia: nvidiaPersonalKey, gemini: geminiPersonalKey, cerebras: cerebrasPersonalKey, zai: zaiPersonalKey };
  const providerNameMap  = { groq: "Groq", nvidia: "NVIDIA", gemini: "Gemini", cerebras: "Cerebras", zai: "Z.ai" };
  const activeProvider   = (prefOrders[providerPref] || prefOrders.auto).find(p => effectiveKeyMap[p]) || null;
  const keyStatusLabel   = activeProvider
    ? `✓ ${providerNameMap[activeProvider]} active — ${personalKeyMap[activeProvider] ? "your key" : "built-in"}`
    : "✗ No AI key — add one below";

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
                {config.userName} · {challengeOptions.find(o => o.key === normalizeChallengeKey(config.challengeType))?.label}
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
            <label className="form-label">Coach Tone</label>
            <div style={{ display: "flex", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
              {COACH_PERSONAS.map(p => (
                <button key={p.key} type="button" onClick={() => setEditedCoachPersona(p.key)}
                  style={{
                    padding: "5px 16px", borderRadius: "20px", fontSize: "12.5px", fontWeight: "700",
                    cursor: "pointer", transition: "all 0.15s",
                    background: editedCoachPersona === p.key ? "var(--accent)" : "var(--bg-secondary)",
                    color: editedCoachPersona === p.key ? "var(--btn-text, #fff)" : "var(--text-secondary)",
                    border: editedCoachPersona === p.key ? "2px solid var(--accent)" : "1.5px solid var(--border)"
                  }}>{p.icon} {p.label}</button>
              ))}
            </div>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginBottom: "8px" }}>
              {COACH_PERSONAS.find(p => p.key === editedCoachPersona)?.desc}
            </p>
            <label className="form-label" htmlFor="settings-persona-note" style={{ fontSize: "12px" }}>
              Tone notes (style only)
            </label>
            <input id="settings-persona-note" className="text-input" type="text"
              value={editedCoachPersonaNote}
              onChange={e => setEditedCoachPersonaNote(e.target.value)}
              placeholder="e.g. Keep it short and skip the cheerleading. (style only — for facts about you, use Coach Profile below)"
              maxLength={300} />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="settings-coach-profile">Coach Profile</label>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginBottom: "8px" }}>
              Stable background about you that helps the coach personalize advice. You control this directly.
            </p>
            <textarea
              id="settings-coach-profile"
              className="text-input"
              value={editedCoachProfileNote}
              onChange={e => setEditedCoachProfileNote(e.target.value)}
              placeholder="e.g. I am a polymer scientist in Arnhem, currently focused on job-search momentum and low-shame execution."
              maxLength={COACH_PROFILE_NOTE_MAX_LENGTH}
              rows={3}
              style={{ resize: "vertical", minHeight: "72px", fontFamily: "var(--font-sans)" }}
            />
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

          <div className="form-group">
            <label className="form-label">Focus Windows</label>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px", marginBottom: "8px" }}>
              Add one or more time ranges for when you want to focus. If an end time is earlier than its start time, that window crosses midnight. Defaults to 7:00 AM-2:00 AM if none are set.
            </p>
            {editedFocusWindows.map((w, idx) => (
              <div key={idx} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
                <input
                  type="time"
                  className="text-input"
                  value={w.start || ""}
                  onChange={e => handleFocusWindowChange(idx, "start", e.target.value)}
                  aria-label={`Focus window ${idx + 1} start time`}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <span style={{ fontSize: "12px", color: "var(--text-muted)", flexShrink: 0 }}>to</span>
                <input
                  type="time"
                  className="text-input"
                  value={w.end || ""}
                  onChange={e => handleFocusWindowChange(idx, "end", e.target.value)}
                  aria-label={`Focus window ${idx + 1} end time`}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveFocusWindow(idx)}
                  aria-label={`Remove focus window ${idx + 1}`}
                  style={{
                    flexShrink: 0, width: "32px", height: "32px", padding: 0,
                    borderRadius: "8px", border: "1.5px solid var(--border)",
                    background: "var(--bg-secondary)", color: "var(--text-muted)",
                    fontSize: "14px", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={handleAddFocusWindow}
              style={{
                width: "100%", padding: "10px", borderRadius: "var(--radius-sm)",
                border: "1.5px dashed var(--border)", background: "none",
                color: "var(--accent)", fontSize: "12.5px", fontWeight: "700", cursor: "pointer"
              }}
            >
              + Add focus window
            </button>
          </div>

          <div
            className="toggle-row"
            onClick={() => setEditedMorningRitualEnabled(!editedMorningRitualEnabled)}
            style={{ cursor: "pointer" }}
          >
            <div>
              <span style={{ fontSize: "13.5px", fontWeight: "700", color: "var(--text-primary)" }}>
                🌅 Morning Ritual popup
              </span>
              <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
                A daily motivational nudge (with a rotating quote and a link to your Mind Box morning ritual) on your first app open of the day.
              </p>
            </div>
            <input type="checkbox" className="pill-toggle" checked={editedMorningRitualEnabled} readOnly />
          </div>

          <div
            className="toggle-row"
            onClick={() => setEditedCoachNudgesEnabled(!editedCoachNudgesEnabled)}
            style={{ cursor: "pointer" }}
          >
            <div>
              <span style={{ fontSize: "13.5px", fontWeight: "700", color: "var(--text-primary)" }}>
                🤖 Proactive coach nudges
              </span>
              <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
                Let your coach speak up first — a once-a-day banner on Today when it notices something worth flagging (a missed deadline move, a pinned focus task, an overloaded day). Skipped during Low Energy Mode and Evening Guard.
              </p>
            </div>
            <input type="checkbox" className="pill-toggle" checked={editedCoachNudgesEnabled} readOnly />
          </div>

          <div className="form-group">
            <label className="form-label">Morning Ritual Window</label>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px", marginBottom: "8px" }}>
              When today's Morning Ritual motivational nudge can appear on your first app open of the day. Independent of your Focus Windows. Defaults to 5:00 AM-11:00 AM.
            </p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="time"
                className="text-input"
                value={editedMorningRitualStart}
                onChange={e => setEditedMorningRitualStart(e.target.value)}
                aria-label="Morning Ritual window start time"
                style={{ flex: 1, minWidth: 0 }}
              />
              <span style={{ fontSize: "12px", color: "var(--text-muted)", flexShrink: 0 }}>to</span>
              <input
                type="time"
                className="text-input"
                value={editedMorningRitualEnd}
                onChange={e => setEditedMorningRitualEnd(e.target.value)}
                aria-label="Morning Ritual window end time"
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Home Header Style</label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
              {[
                { key: "full", label: "Full card" },
                { key: "compact", label: "Compact (tap)" },
                { key: "frameless", label: "Frameless" }
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
            <label className="form-label">📅 Key Deadline (home screen countdown)</label>
            <input className="text-input" type="text"
              value={editedDeadlineLabel}
              onChange={e => setEditedDeadlineLabel(e.target.value)}
              placeholder="e.g. Get a job · Exam · Birthday"
              style={{ marginBottom: "8px" }} />
            <input className="text-input" type="date"
              value={editedDeadlineDate}
              onChange={e => setEditedDeadlineDate(e.target.value)}
              style={{ marginBottom: "8px" }} />
            <input className="text-input" type="date"
              value={editedDeadlineStartDate}
              onChange={e => setEditedDeadlineStartDate(e.target.value)}
              placeholder="Start date (for progress bar)"
              title="Start date — sets the full width of the shrinking progress bar"
              style={{ marginBottom: "8px" }} />
            <input className="text-input" type="text"
              value={editedDeadlineAction}
              onChange={e => setEditedDeadlineAction(e.target.value)}
              placeholder="Daily action nudge (e.g. Complete one application step today)"
              style={{ marginBottom: "8px" }} />
            {editedDeadlineDate && (
              <button type="button"
                onClick={() => {
                  setEditedDeadlineDate(""); setEditedDeadlineLabel(""); setEditedDeadlineStartDate(""); setEditedDeadlineAction("");
                  saveSubPath("config", { ...config, deadlineLabel: "", deadlineDate: "", deadlineStartDate: "", deadlineAction: "", deadlineCardStyle: "compact", lastUpdated: Date.now() });
                }}
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
            <input type="checkbox" className="pill-toggle" checked={editedEveningGuard} onChange={() => setEditedEveningGuard(v => !v)} />
          </div>

          <button className="btn" type="submit" style={{ width: "100%", marginTop: "4px" }}>
            {savedProfile ? "✓ Saved!" : "Save Profile"}
          </button>
        </form>}
      </section>

      {/* ── Coach Memory ─────────────────────────────────────────────────── */}
      <section className="card">
        <button type="button" onClick={() => setMemoryOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, marginBottom: memoryOpen ? "16px" : 0 }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "2px", color: "var(--text-primary)" }}>
              🧠 Coach Memory
            </h2>
            {!memoryOpen && (
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                {coachMemoryEnabled
                  ? `${pinnedFacts.length} pinned fact${pinnedFacts.length === 1 ? "" : "s"} · ${recentObservations.length} recent note${recentObservations.length === 1 ? "" : "s"}`
                  : "Off"}
              </div>
            )}
          </div>
          <span style={{ fontSize: "16px", color: "var(--text-secondary)", transition: "transform 0.2s", transform: memoryOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, marginLeft: "8px" }}>▼</span>
        </button>

        {memoryOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)" }}>
              Your coach can pick up on durable facts and recent notes during chat so it doesn't start from scratch each time. Remove anything that's wrong or no longer relevant, or turn memory off entirely.
            </p>

            <div
              className="toggle-row"
              onClick={() => saveConfigPatch((latestConfig) => ({ coachMemoryEnabled: !isMemoryEnabled(latestConfig) }))}
              style={{ cursor: "pointer" }}
            >
              <div>
                <span style={{ fontSize: "13.5px", fontWeight: "700", color: "var(--text-primary)" }}>
                  Coach Memory
                </span>
                <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
                  Let your coach save and recall facts and notes across conversations. Turning this off stops new memories from being saved and keeps existing ones out of the chat — they're still listed below until you delete or clear them.
                </p>
              </div>
              <input type="checkbox" className="pill-toggle" checked={coachMemoryEnabled} readOnly />
            </div>

            {pinnedFacts.length === 0 && recentObservations.length === 0 ? (
              <p style={{ fontSize: "11.5px", color: "var(--text-secondary)" }}>
                Nothing saved yet. As you chat, your coach may remember a durable fact (Pinned Fact) or a short-term note (Recent Note) here — you can review, delete, or clear them anytime.
              </p>
            ) : (
              <>
                {pinnedFacts.length > 0 && (
                  <div className="form-group">
                    <label className="form-label">Pinned facts</label>
                    {pinnedFacts.map((f, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", padding: "8px 0", borderBottom: idx < pinnedFacts.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <span style={{ fontSize: "12.5px", color: "var(--text-primary)" }}>{f.text}</span>
                        <button type="button" onClick={() => saveConfigPatch((latestConfig) => ({ coachMemory: removePinnedFact(latestConfig.coachMemory, idx) }))}
                          aria-label="Remove pinned fact"
                          style={{ flexShrink: 0, width: "28px", height: "28px", padding: 0, borderRadius: "8px", border: "1.5px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-muted)", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {recentObservations.length > 0 && (
                  <div className="form-group">
                    <label className="form-label">Recent notes</label>
                    {recentObservations.map((o, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", padding: "8px 0", borderBottom: idx < recentObservations.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <span style={{ fontSize: "12.5px", color: "var(--text-primary)" }}>
                          {o.text}
                          {o.lociDayStr && <span style={{ color: "var(--text-muted)" }}> — {o.lociDayStr}</span>}
                        </span>
                        <button type="button" onClick={() => saveConfigPatch((latestConfig) => ({ coachMemory: removeRecentObservation(latestConfig.coachMemory, idx) }))}
                          aria-label="Remove recent note"
                          style={{ flexShrink: 0, width: "28px", height: "28px", padding: 0, borderRadius: "8px", border: "1.5px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-muted)", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="btn"
                  style={{ width: "100%", background: "rgba(239,68,68,0.08)", color: "var(--danger)", border: "1.5px solid var(--border)", boxShadow: "none", fontSize: "12.5px" }}
                  onClick={() => setConfirmDialog({
                    message: "Clear all coach memory?\n\nThis removes every pinned fact and recent note. Cannot be undone.",
                    confirmLabel: "Clear memory", cancelLabel: "Cancel",
                    onConfirm: () => { saveConfigPatch((latestConfig) => ({ coachMemory: clearAllMemory(latestConfig.coachMemory) })); setConfirmDialog(null); },
                    onCancel: () => setConfirmDialog(null)
                  })}
                >
                  Clear all memory
                </button>
              </>
            )}
          </div>
        )}
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
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginBottom: "14px" }}>
              Built-in private-alpha AI may be preconfigured. You can also add your own key below. Your own keys are stored only in this browser.
            </p>

            {/* Provider preference */}
            <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-secondary)", marginBottom: "8px", display: "block", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                AI Provider
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {[
                  { key: "auto",     label: "Auto",     chain: "Groq → Cerebras → Z.ai → Gemini" },
                  { key: "groq",     label: "Groq",     chain: "Groq → Cerebras → Z.ai → Gemini" },
                  { key: "cerebras", label: "Cerebras", chain: "Cerebras → Groq → Z.ai → Gemini" },
                  { key: "zai",      label: "Z.ai",     chain: "Z.ai → Groq → Cerebras → Gemini" },
                  { key: "gemini",   label: "Gemini",   chain: "Gemini → Groq → Cerebras → Z.ai" },
                  { key: "nvidia",   label: "NVIDIA",   chain: "NVIDIA → Groq → Cerebras → Z.ai → Gemini" },
                ].map(opt => {
                  const isSelected = providerPref === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => handleProviderPref(opt.key)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 14px", borderRadius: "var(--radius-sm)", textAlign: "left",
                        background: isSelected ? "var(--accent)" : "var(--bg-secondary)",
                        color: isSelected ? "var(--btn-text, #fff)" : "var(--text-primary)",
                        border: isSelected ? "2px solid var(--accent)" : "1.5px solid var(--border)",
                        cursor: "pointer"
                      }}
                    >
                      <div>
                        <span style={{ fontSize: "13px", fontWeight: "700" }}>
                          {opt.label}{opt.key === "auto" && <span style={{ fontSize: "10px", fontWeight: "600", opacity: 0.75, marginLeft: "6px" }}>recommended</span>}
                        </span>
                        {isSelected && (
                          <div style={{ fontSize: "11px", opacity: 0.8, marginTop: "2px", fontWeight: "400" }}>{opt.chain}</div>
                        )}
                      </div>
                      {isSelected && <span style={{ fontSize: "14px", fontWeight: "800", flexShrink: 0, marginLeft: "12px" }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Groq — recommended */}
            <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-primary)" }}>
                  🚀 Groq
                  <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--success)", background: "rgba(52,211,153,0.12)", padding: "2px 6px", borderRadius: "4px", marginLeft: "6px" }}>RECOMMENDED</span>
                </span>
                <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ fontSize: "11.5px", color: "var(--accent)", fontWeight: "600" }}>Get key ↗</a>
              </div>
              <form onSubmit={handleSaveGroq} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input className="text-input" type="password"
                  value={groqInput} onChange={e => setGroqInput(e.target.value)}
                  placeholder="gsk_..." />
                <button className="btn" type="submit" style={{ width: "100%" }}>
                  {savedGroq ? "✓ Saved" : "Save Groq Key"}
                </button>
              </form>
            </div>

            {/* Cerebras */}
            <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Cerebras</span>
                <a href="https://cloud.cerebras.ai" target="_blank" rel="noreferrer" style={{ fontSize: "11.5px", color: "var(--accent)", fontWeight: "600" }}>Get key ↗</a>
              </div>
              <form onSubmit={handleSaveCerebras} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input className="text-input" type="password"
                  value={cerebrasInput} onChange={e => setCerebrasInput(e.target.value)}
                  placeholder="csk-..." />
                <button className="btn" type="submit" style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", boxShadow: "none" }}>
                  {savedCerebras ? "✓ Saved" : "Save Cerebras Key"}
                </button>
              </form>
            </div>

            {/* Z.ai */}
            <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
                  Z.ai
                  <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: "4px", marginLeft: "6px" }}>EMERGENCY FALLBACK / FREE-TIER</span>
                </span>
                <a href="https://z.ai" target="_blank" rel="noreferrer" style={{ fontSize: "11.5px", color: "var(--accent)", fontWeight: "600" }}>Get key ↗</a>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                Z.ai free fallback has low concurrency, so it is used only when earlier providers fail.
              </p>
              <form onSubmit={handleSaveZai} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input className="text-input" type="password"
                  value={zaiInput} onChange={e => setZaiInput(e.target.value)}
                  placeholder="API key" />
                <button className="btn" type="submit" style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", boxShadow: "none" }}>
                  {savedZai ? "✓ Saved" : "Save Z.ai Key"}
                </button>
              </form>
            </div>

            {/* NVIDIA */}
            <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>NVIDIA Nemotron</span>
                <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" style={{ fontSize: "11.5px", color: "var(--accent)", fontWeight: "600" }}>Get key ↗</a>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                Manual/experimental — not part of the Auto, Groq, or Cerebras chains right now.
              </p>
              <form onSubmit={handleSaveNvidia} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input className="text-input" type="password"
                  value={nvidiaInput} onChange={e => setNvidiaInput(e.target.value)}
                  placeholder="nvapi-..." />
                <button className="btn" type="submit" style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", boxShadow: "none" }}>
                  {savedNvidia ? "✓ Saved" : "Save NVIDIA Key"}
                </button>
              </form>
            </div>

            {/* Gemini */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Gemini</span>
                <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ fontSize: "11.5px", color: "var(--accent)", fontWeight: "600" }}>Get key ↗</a>
              </div>
              <form onSubmit={handleSaveKey} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input className="text-input" type="password"
                  value={keyInput} onChange={e => setKeyInput(e.target.value)}
                  placeholder="AIzaSy..." />
                <button className="btn" type="submit" style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", boxShadow: "none" }}>
                  {savedKey ? "✓ Saved" : "Save Gemini Key"}
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
                Last sync: {formatRelativeTime(lastSyncedAt || payload.timestamp)}
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
              { label: "Last Sync", value: formatRelativeTime(lastSyncedAt || payload.timestamp) },
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

      {/* ── Data Backup ─────────────────────────────────────────────────── */}
      <section className="card">
        <button type="button" onClick={() => { setBackupOpen(o => !o); setExportError(""); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, marginBottom: backupOpen ? "12px" : 0 }}>
          <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
            💾 Data Backup
          </h2>
          <span style={{ fontSize: "16px", color: "var(--text-secondary)", transition: "transform 0.2s", transform: backupOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, marginLeft: "8px" }}>▼</span>
        </button>
        {backupOpen && (
          <>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.5" }}>
              Download a copy of all your Loci tasks. This only creates a local file on your device — it does not change, delete, or re-sync any of your tasks.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                className="btn"
                type="button"
                style={{ width: "100%" }}
                onClick={() => {
                  setExportError("");
                  try { exportPayloadAsJson(payload); }
                  catch (_) { setExportError("Export failed. Your tasks were not changed."); }
                }}
              >
                ⬇ Download JSON Backup
              </button>
              <button
                className="btn"
                type="button"
                style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1.5px solid var(--border)", boxShadow: "none" }}
                onClick={() => {
                  setExportError("");
                  try { exportTasksAsCsv(payload.tasks || []); }
                  catch (_) { setExportError("Export failed. Your tasks were not changed."); }
                }}
              >
                ⬇ Download CSV Backup
              </button>
              {exportError && (
                <p style={{ fontSize: "12px", color: "var(--danger)", fontWeight: "600", margin: 0 }}>{exportError}</p>
              )}
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
                Includes all tasks across all horizons — active, completed, and parked. JSON preserves all fields; CSV is readable in Excel and Google Sheets.
              </p>
            </div>
          </>
        )}
      </section>

      {/* ── Notifications ────────────────────────────────────────────────── */}
      <section className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "800", fontFamily: "var(--font-display)", marginBottom: "10px", color: "var(--text-primary)" }}>
          🔔 Notifications
        </h2>
        {notifPermission === "granted" && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "12px", color: "var(--success)", fontWeight: "700" }}>✓ Notifications allowed</span>
          </div>
        )}
        {notifPermission === "denied" && (
          <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "10px" }}>
            Notifications are blocked. Go to browser Settings → Site settings → Notifications → allow for this site.
          </p>
        )}
        {notifPermission !== "granted" && notifPermission !== "denied" && (
          <button className="btn" style={{ width: "100%", marginBottom: "10px" }} onClick={requestNotifPermission}>
            Allow notifications
          </button>
        )}
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
          Reminders are set <strong>per task</strong> — tap <strong>+ Add Task</strong> or <strong>✏ Edit</strong> a task and tap <strong>🔔 Set a reminder</strong> to choose the exact date and time.
        </p>
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
              message: "Reset 7-day tracking data?\n\nThis clears the dots AND the streak counter on the Mind Box tab. Cannot be undone.",
              confirmLabel: "Reset tracking", cancelLabel: "Cancel",
              onConfirm: () => { saveSubPath("contributions", []); saveSubPath("config", { ...config, visitStreakCount: 0, lastUpdated: Date.now() }); setConfirmDialog(null); },
              onCancel: () => setConfirmDialog(null)
            })}
          >
            🔄 Reset 7-day tracking data
          </button>
          <button
            className="btn"
            style={{ width: "100%", background: "rgba(239,68,68,0.08)", color: "var(--danger)", border: "1.5px solid var(--border)", boxShadow: "none" }}
            onClick={() => setShowBugForm(true)}
          >
            🐛 Report a bug
          </button>
          <button
            className="btn"
            style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-muted)", border: "1.5px solid var(--border)", boxShadow: "none", fontSize: "12px" }}
            onClick={() => setShowPrivacy(true)}
          >
            Privacy Policy
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
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}

      {/* ── Bug Report Modal ─────────────────────────────────────────────── */}
      {showBugForm && (
        <>
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 400, backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
            onClick={() => { if (!bugSubmitting) setShowBugForm(false); }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "calc(100% - 32px)", maxWidth: "420px",
            background: "var(--bg-card)", borderRadius: "20px",
            padding: "24px 22px 28px", zIndex: 401,
            boxShadow: "0 12px 48px rgba(0,0,0,0.3)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "800", margin: 0, color: "var(--text-primary)" }}>🐛 Report a Bug</h3>
              {!bugSubmitting && (
                <button onClick={() => setShowBugForm(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "var(--text-muted)", padding: "2px 4px", lineHeight: 1 }}>×</button>
              )}
            </div>
            {bugSuccess ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: "36px", marginBottom: "10px" }}>✅</div>
                <p style={{ fontSize: "14px", fontWeight: "700", color: "var(--success)" }}>Bug report submitted!</p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>Thank you — we'll look into it.</p>
              </div>
            ) : (
              <form onSubmit={handleBugSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="bug-what">What happened? *</label>
                  <textarea
                    id="bug-what"
                    className="text-input"
                    placeholder="Describe the issue clearly — what did you expect vs what actually happened?"
                    value={bugWhat}
                    onChange={e => setBugWhat(e.target.value)}
                    rows={3}
                    style={{ resize: "vertical", minHeight: "72px", fontFamily: "var(--font-sans)" }}
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="bug-steps">Steps to reproduce (optional)</label>
                  <textarea
                    id="bug-steps"
                    className="text-input"
                    placeholder="1. Go to… 2. Tap… 3. See error"
                    value={bugSteps}
                    onChange={e => setBugSteps(e.target.value)}
                    rows={2}
                    style={{ resize: "vertical", minHeight: "50px", fontFamily: "var(--font-sans)" }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="bug-device">Device / browser (optional)</label>
                  <input
                    id="bug-device"
                    className="text-input"
                    placeholder="e.g. iPhone 14, Safari · Android, Chrome"
                    value={bugDevice}
                    onChange={e => setBugDevice(e.target.value)}
                  />
                </div>
                {bugError && <p style={{ fontSize: "12px", color: "var(--danger)", fontWeight: "600" }}>{bugError}</p>}
                <button className="btn" type="submit" disabled={bugSubmitting || !bugWhat.trim()} style={{ width: "100%", marginTop: "4px" }}>
                  {bugSubmitting ? "Submitting…" : "Submit Bug Report"}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
