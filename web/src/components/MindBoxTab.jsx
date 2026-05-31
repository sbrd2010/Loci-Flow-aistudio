import React, { useState, useEffect, useRef } from "react";
import RescueMode from "./RescueMode";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { getAIKeys, callAI } from "../utils/aiCall";

export default function MindBoxTab({ payload, savePayload }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  // ── State ──────────────────────────────────────────────────────────────────
  const [toolPanel, setToolPanel] = useState(null);
  const [ritualActive, setRitualActive] = useState(false);
  const [ritualStepIndex, setRitualStepIndex] = useState(-1);
  const [ritualSecondsLeft, setRitualSecondsLeft] = useState(0);
  const [ritualDone, setRitualDone] = useState(false);
  const [ritualSuccess, setRitualSuccess] = useState(false);
  const ritualIntervalRef = useRef(null);
  const [showRescue, setShowRescue] = useState(false);
  const [rescueStepIndex, setRescueStepIndex] = useState(0);
  const [rescueActive, setRescueActive] = useState(false);
  const [rescueTask, setRescueTask] = useState(null);
  const [brainDumpText, setBrainDumpText] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [organizeResults, setOrganizeResults] = useState([]);
  const [organizeSelected, setOrganizeSelected] = useState(new Set());
  const [organizeError, setOrganizeError] = useState("");
  const [organizeExpandedIndex, setOrganizeExpandedIndex] = useState(null);

  // ── Ritual data ────────────────────────────────────────────────────────────
  const ritualSteps = [
    { name: "Hydrate — drink a full glass of water", seconds: 60 },
    { name: "Stand & Stretch (touch toes)", seconds: 90 },
    { name: "Box Breathing (4-hold-4 cycle)", seconds: 90 },
    { name: "Write ONE intention for today", seconds: 60 },
    { name: "Scan your task list — pick 3 priorities", seconds: 30 },
    { name: "Pick your very first action NOW", seconds: 30 }
  ];
  const formatRitualTime = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  // ── Rescue steps ───────────────────────────────────────────────────────────
  const rescueSteps = [
    "Take one deep breath. Breathe in for 4, hold for 4, out for 4.",
    "What is the laughably smallest first step? A single sentence counts.",
    "Close all tabs that aren't this task right now.",
    "Commit to just 2 minutes. You can stop after that."
  ];

  // ── Ritual useEffects ──────────────────────────────────────────────────────
  useEffect(() => {
    if (ritualActive && ritualStepIndex >= 0 && ritualSecondsLeft > 0) {
      ritualIntervalRef.current = setInterval(() => {
        setRitualSecondsLeft(prev => prev <= 1 ? 0 : prev - 1);
      }, 1000);
    } else {
      clearInterval(ritualIntervalRef.current);
    }
    return () => clearInterval(ritualIntervalRef.current);
  }, [ritualActive, ritualStepIndex, ritualSecondsLeft > 0]);

  useEffect(() => {
    if (ritualActive && ritualStepIndex >= 0 && ritualSecondsLeft === 0) {
      handleAdvanceRitualStep();
    }
  }, [ritualSecondsLeft, ritualActive, ritualStepIndex]);

  useEffect(() => {
    if (ritualDone) {
      savePayload({ ...payload, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 80, lastUpdated: Date.now() } });
      setRitualDone(false);
      setRitualSuccess(true);
      setTimeout(() => setRitualSuccess(false), 3500);
    }
  }, [ritualDone]);

  // ── AI keys ────────────────────────────────────────────────────────────────
  const { groqKey, geminiKey } = getAIKeys();
  const hasAnyKey = !!(groqKey || geminiKey);

  // ── Helper data ────────────────────────────────────────────────────────────
  const getBentoDays = () => {
    const days = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const past = new Date(d);
      past.setDate(d.getDate() - i);
      const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
      const contr = contributions.find((c) => c.dateString === dateStr);
      days.push({ dateStr, label: past.toLocaleDateString("en-US", { weekday: "short" }).substring(0, 2), count: contr ? contr.count : 0 });
    }
    return days;
  };
  const bentoDays = getBentoDays();
  const dumpCount = (payload.brainDump || []).length;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const openRescueMode = () => {
    const pinned = tasks.find(t => !t.isDeleted && !t.isCompleted && t.isNowFocus);
    const first = tasks.find(t => !t.isDeleted && !t.isCompleted);
    setRescueTask(pinned || first || null);
    setRescueActive(true);
  };

  const handleBadDayReset = () => {
    setConfirmDialog({
      message: "Park all active tasks for today?\n\nThis is a restart without shame — everything moves to parked. You can restore tasks from the AI Coach tab whenever you're ready.",
      confirmLabel: "Yes, restart", cancelLabel: "Not now",
      onConfirm: () => {
        savePayload({ ...payload, tasks: tasks.map(t => (!t.isCompleted && !t.isDeleted) ? { ...t, isParked: true, isNowFocus: false } : t) });
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  const handleCleanSlate = () => {
    setConfirmDialog({
      message: "Move today's unfinished tasks to this week?\n\nNothing is lost — you'll find them in Roadmap → This Week. Fresh start, no shame.",
      confirmLabel: "Fresh start", cancelLabel: "Keep today",
      onConfirm: () => {
        savePayload({ ...payload, tasks: tasks.map(t =>
          (!t.isCompleted && !t.isDeleted && t.horizonLevel === "today")
            ? { ...t, horizonLevel: "week", lastUpdated: Date.now() } : t
        )});
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  const handleOrganizeDump = async () => {
    const dumpItems = (payload.brainDump || []).map(i => i.text);
    if (!dumpItems.length) return;
    setOrganizeLoading(true);
    setOrganizeResults([]);
    setOrganizeError("");
    setOrganizeSelected(new Set());
    setToolPanel("organize");

    const prompt = `Here are raw thoughts from a brain dump:\n${dumpItems.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nOrganize each thought into a structured task. For each one determine:\n- title: specific, outcome-oriented (max 60 chars)\n- horizonLevel: "today" (urgent/time-sensitive), "week" (most items), "month", or "quarter"\n- priority: "P1" (urgent), "P2" (important), "P3" (normal), "P4" (quick <15 min)\n- concreteStep: the single easiest first action to start it (max 60 chars)\n\nRules: default to "week" unless clearly urgent. Never use the word "ADHD".\n\nReturn ONLY a JSON array, no markdown:\n[{"title":"...","horizonLevel":"week","priority":"P3","concreteStep":"..."}]`;

    try {
      const raw = await callAI({
        groqKey, geminiKey,
        systemPrompt: "You are a productivity coach. Respond ONLY with a valid JSON array, no markdown.",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 800
      });
      const cleaned = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error("invalid");
      const valid = parsed
        .filter(t => t.title && ["today","week","month","quarter","halfyear"].includes(t.horizonLevel) && ["P1","P2","P3","P4"].includes(t.priority))
        .slice(0, 10);
      setOrganizeResults(valid);
      setOrganizeSelected(new Set(valid.map((_, i) => i)));
    } catch (_) {
      setOrganizeError("Couldn't organize — try again, or add tasks manually.");
    } finally {
      setOrganizeLoading(false);
    }
  };

  const updateOrganizeResult = (i, field, value) => {
    setOrganizeResults(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  };

  const moveOrganizeResult = (i, dir) => {
    const j = dir === "up" ? i - 1 : i + 1;
    setOrganizeResults(prev => {
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setOrganizeSelected(prev => {
      const j2 = dir === "up" ? i - 1 : i + 1;
      const next = new Set(prev);
      const iSel = prev.has(i), jSel = prev.has(j2);
      if (iSel) next.add(j2); else next.delete(j2);
      if (jSel) next.add(i); else next.delete(i);
      return next;
    });
    if (organizeExpandedIndex === i) setOrganizeExpandedIndex(dir === "up" ? i - 1 : i + 1);
    else if (organizeExpandedIndex === (dir === "up" ? i - 1 : i + 1)) setOrganizeExpandedIndex(i);
  };

  const handleAddOrganizedTasks = () => {
    const toAdd = organizeResults.filter((_, i) => organizeSelected.has(i));
    if (!toAdd.length) return;
    const baseCounts = {};
    const newTasks = toAdd.map((t, i) => {
      const hl = t.horizonLevel;
      if (baseCounts[hl] === undefined)
        baseCounts[hl] = (payload.tasks || []).filter(x => x.horizonLevel === hl && !x.isDeleted).length;
      const orderIndex = baseCounts[hl]++;
      return {
        id: Date.now() + i,
        userId: payload.config?.userId || "",
        uuid: safeUUID(),
        title: t.title,
        concreteStep: t.concreteStep || "Start with the first step",
        horizonLevel: hl,
        priority: t.priority,
        category: "Personal",
        timeEstimateMinutes: 25,
        deadlineTimestamp: null,
        reminderAt: null,
        isCompleted: false,
        isParked: false,
        isNowFocus: false,
        orderIndex,
        dateCompletedString: null,
        isDeleted: false,
        lastUpdated: Date.now()
      };
    });
    savePayload({ ...payload, tasks: [...(payload.tasks || []), ...newTasks] });
    setToolPanel(null);
    setOrganizeResults([]);
    setOrganizeSelected(new Set());
  };

  const handleBrainDumpSubmit = (e) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;
    const currentDump = payload.brainDump || [];
    if (currentDump.length >= 50) return;
    savePayload({ ...payload, brainDump: [...currentDump, { id: safeUUID(), text: brainDumpText.trim(), createdAt: Date.now() }] });
    setBrainDumpText("");
  };

  const handleNextRescueStep = () => {
    if (rescueStepIndex < rescueSteps.length - 1) setRescueStepIndex(rescueStepIndex + 1);
    else { setShowRescue(false); setRescueStepIndex(0); }
  };

  const handleAdvanceRitualStep = () => {
    if (ritualStepIndex < ritualSteps.length - 1) {
      const next = ritualStepIndex + 1;
      setRitualStepIndex(next);
      setRitualSecondsLeft(ritualSteps[next].seconds);
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
    setRitualDone(false);
  };

  const handleAbortRitual = () => {
    clearInterval(ritualIntervalRef.current);
    setRitualActive(false);
    setRitualStepIndex(-1);
    setRitualSecondsLeft(0);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const recentDump = [...(payload.brainDump || [])].slice(-3).reverse();

  const handleDeleteDumpItem = (id) => {
    savePayload({ ...payload, brainDump: (payload.brainDump || []).filter(item => item.id !== id) });
  };

  const formatRelTime = (ts) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  };

  return (
    <>
      {ritualSuccess && (
        <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", background: "var(--success)", color: "#fff", padding: "12px 24px", borderRadius: "20px", fontWeight: "700", fontSize: "14px", zIndex: 300, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
          Morning Ritual complete! +80 XP
        </div>
      )}

      {/* ── Sub-view: Brain Dump full list */}
      {toolPanel === "dump" && (
        <>
          <div className="mindbox-subview-header">
            <button className="mindbox-back-btn" onClick={() => setToolPanel(null)}>← Back</button>
            <h2 className="mindbox-subview-title">📝 Brain Dump</h2>
            {dumpCount > 0 && (
              <span style={{ fontSize: "11px", color: dumpCount >= 50 ? "var(--danger)" : "var(--text-muted)", fontWeight: "700", marginLeft: "auto" }}>{dumpCount}/50</span>
            )}
          </div>
          {dumpCount >= 50 && (
            <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "10px", fontWeight: "600" }}>Inbox full — delete some items or convert them to Roadmap tasks.</p>
          )}
          <form className="braindump-form" onSubmit={handleBrainDumpSubmit} style={{ marginBottom: "16px" }}>
            <input type="text" className="braindump-input"
              placeholder="Add anything on your mind."
              value={brainDumpText}
              onChange={e => setBrainDumpText(e.target.value)}
              disabled={dumpCount >= 50} />
            <button type="submit" className="braindump-submit" disabled={dumpCount >= 50}>➔</button>
          </form>
          {(payload.brainDump || []).length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center", padding: "32px 0" }}>Nothing captured yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[...(payload.brainDump || [])].reverse().map(item => (
                <div key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 12px" }}>
                  <p style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)", margin: 0, lineHeight: "1.5" }}>{item.text}</p>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{formatRelTime(item.createdAt)}</span>
                    <button onClick={() => handleDeleteDumpItem(item.id)} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "var(--text-muted)", padding: 0, lineHeight: 1 }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Sub-view: AI Organize Dump */}
      {toolPanel === "organize" && (
        <>
          <div className="mindbox-subview-header">
            <button className="mindbox-back-btn" onClick={() => { setToolPanel(null); setOrganizeResults([]); setOrganizeError(""); }}>← Back</button>
            <h2 className="mindbox-subview-title">✨ Organize Dump</h2>
          </div>
          {organizeLoading && (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <p style={{ fontSize: "15px", fontWeight: "700", color: "var(--accent)" }}>✨ Organizing your thoughts…</p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>This takes a few seconds</p>
            </div>
          )}
          {!organizeLoading && organizeError && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <p style={{ fontSize: "13px", color: "var(--danger)", fontWeight: "600" }}>{organizeError}</p>
              <button className="btn" onClick={handleOrganizeDump} style={{ marginTop: "16px", padding: "8px 24px" }}>Try again</button>
            </div>
          )}
          {!organizeLoading && !organizeError && organizeResults.length > 0 && (() => {
            const horizonOptions = ["today","week","month","quarter","halfyear"];
            const horizonLabel = { today: "Today", week: "This Week", month: "Month", quarter: "Quarter", halfyear: "6 Months" };
            const priorityOptions = ["P1","P2","P3","P4"];
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
                    Tap card to select · ✎ to edit · ↑↓ to reorder
                  </p>
                  <button
                    type="button"
                    onClick={() => { setOrganizeSelected(new Set(organizeResults.map((_, i) => i))); }}
                    style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", whiteSpace: "nowrap" }}
                  >Select all</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                  {organizeResults.map((t, i) => {
                    const isSelected = organizeSelected.has(i);
                    const isExpanded = organizeExpandedIndex === i;
                    return (
                      <div
                        key={i}
                        style={{
                          background: isSelected ? "var(--accent-ring, rgba(99,102,241,0.08))" : "var(--bg-card)",
                          border: `1.5px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                          borderRadius: "12px", overflow: "hidden", transition: "border-color 0.15s"
                        }}
                      >
                        {/* Card header row */}
                        <div
                          onClick={() => { const next = new Set(organizeSelected); isSelected ? next.delete(i) : next.add(i); setOrganizeSelected(next); }}
                          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "11px 12px", cursor: "pointer" }}
                        >
                          <span className={`priority-badge ${t.priority.toLowerCase()}`}>{t.priority}</span>
                          <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>{horizonLabel[t.horizonLevel] || t.horizonLevel}</span>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", flex: 1, lineHeight: "1.3", minWidth: 0 }}>{t.title}</span>
                          {/* Sort buttons */}
                          <button onClick={e => { e.stopPropagation(); moveOrganizeResult(i, "up"); }} disabled={i === 0}
                            style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", fontSize: "13px", color: i === 0 ? "var(--border)" : "var(--text-muted)", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>↑</button>
                          <button onClick={e => { e.stopPropagation(); moveOrganizeResult(i, "down"); }} disabled={i === organizeResults.length - 1}
                            style={{ background: "none", border: "none", cursor: i === organizeResults.length - 1 ? "default" : "pointer", fontSize: "13px", color: i === organizeResults.length - 1 ? "var(--border)" : "var(--text-muted)", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>↓</button>
                          {/* Edit toggle */}
                          <button onClick={e => { e.stopPropagation(); setOrganizeExpandedIndex(isExpanded ? null : i); }}
                            style={{ background: isExpanded ? "var(--accent-ring)" : "none", border: "none", cursor: "pointer", fontSize: "14px", color: isExpanded ? "var(--accent)" : "var(--text-muted)", padding: "2px 4px", borderRadius: "5px", lineHeight: 1, flexShrink: 0 }}>✎</button>
                          <span style={{ fontSize: "16px", color: isSelected ? "var(--accent)" : "var(--border)", flexShrink: 0 }}>{isSelected ? "✓" : "○"}</span>
                        </div>
                        {/* Concrete step (if any) */}
                        {t.concreteStep && !isExpanded && (
                          <p style={{ fontSize: "11.5px", color: "var(--text-muted)", margin: "0 12px 10px", lineHeight: "1.4" }}>⚡ {t.concreteStep}</p>
                        )}
                        {/* Inline edit panel */}
                        {isExpanded && (
                          <div style={{ borderTop: "1px solid var(--border)", padding: "12px", display: "flex", flexDirection: "column", gap: "10px", background: "var(--bg-secondary)" }}>
                            <input
                              className="text-input"
                              value={t.title}
                              onChange={e => updateOrganizeResult(i, "title", e.target.value)}
                              placeholder="Task title"
                              style={{ fontSize: "13px", marginBottom: 0 }}
                              onClick={e => e.stopPropagation()}
                            />
                            <input
                              className="text-input"
                              value={t.concreteStep || ""}
                              onChange={e => updateOrganizeResult(i, "concreteStep", e.target.value)}
                              placeholder="⚡ First action step (optional)"
                              style={{ fontSize: "12px", marginBottom: 0 }}
                              onClick={e => e.stopPropagation()}
                            />
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {priorityOptions.map(p => (
                                <button key={p} type="button" onClick={e => { e.stopPropagation(); updateOrganizeResult(i, "priority", p); }}
                                  style={{ padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "800", cursor: "pointer", border: t.priority === p ? "2px solid var(--accent)" : "1.5px solid var(--border)", background: t.priority === p ? "var(--accent)" : "var(--bg-card)", color: t.priority === p ? "#fff" : "var(--text-secondary)" }}>
                                  {p}
                                </button>
                              ))}
                              <span style={{ fontSize: "11px", color: "var(--text-muted)", alignSelf: "center", marginLeft: "4px" }}>priority</span>
                            </div>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {horizonOptions.map(h => (
                                <button key={h} type="button" onClick={e => { e.stopPropagation(); updateOrganizeResult(i, "horizonLevel", h); }}
                                  style={{ padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "700", cursor: "pointer", border: t.horizonLevel === h ? "2px solid var(--accent)" : "1.5px solid var(--border)", background: t.horizonLevel === h ? "var(--accent)" : "var(--bg-card)", color: t.horizonLevel === h ? "#fff" : "var(--text-secondary)" }}>
                                  {horizonLabel[h]}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  className="btn"
                  onClick={handleAddOrganizedTasks}
                  disabled={organizeSelected.size === 0}
                  style={{ width: "100%", fontSize: "14px", fontWeight: "700", padding: "13px" }}
                >
                  Add {organizeSelected.size} task{organizeSelected.size !== 1 ? "s" : ""} to my plan
                </button>
              </>
            );
          })()}
        </>
      )}

      {/* ── Sub-view: 7-Day Progress */}
      {toolPanel === "progress" && (() => {
        const currentXp = Number(config.totalXp) || 0;
        const xpInLevel = currentXp % 200;
        const levelNum = Math.floor(currentXp / 200) + 1;
        const levelProgress = (xpInLevel / 200) * 100;
        const levelTitles = ["Focus Seed", "Inertia Crusher", "Momentum Builder", "Flow Finder", "Deep Worker", "Focus Master"];
        const levelTitle = levelTitles[Math.min(levelNum - 1, levelTitles.length - 1)];
        const totalDone = tasks.filter(t => !t.isDeleted && t.isCompleted).length;
        const activeDays = bentoDays.filter(d => d.count > 0).length;
        return (
          <>
            <div className="mindbox-subview-header">
              <button className="mindbox-back-btn" onClick={() => setToolPanel(null)}>← Back</button>
              <h2 className="mindbox-subview-title">📊 7-Day Progress</h2>
            </div>

            {/* Streak + bento */}
            <div style={{ textAlign: "center", padding: "16px 0 20px" }}>
              <span style={{ fontSize: "clamp(48px, 14vw, 72px)", fontWeight: "700", color: "var(--accent)", lineHeight: "1", fontFamily: "var(--font-mono)" }}>
                {config.visitStreakCount || 0}
              </span>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "4px", marginBottom: "20px" }}>
                day streak 🔥
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "8px" }}>
                {bentoDays.map((day, i) => {
                  const isToday = i === 6;
                  const count = day.count;
                  const intensity = count === 0 ? 0 : count < 2 ? 0.45 : count < 4 ? 0.7 : 1;
                  return (
                    <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                      <div style={{
                        width: isToday ? "36px" : "28px", height: isToday ? "36px" : "28px",
                        borderRadius: "50%",
                        background: count > 0 ? `rgba(99,102,241,${intensity})` : "var(--bg-secondary)",
                        border: isToday ? "2.5px solid var(--accent)" : "2px solid var(--border)",
                        transition: "all 0.2s",
                        display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        {count > 0 && <span style={{ fontSize: "9px", fontWeight: "800", color: "#fff" }}>{count}</span>}
                      </div>
                      <span style={{ fontSize: "9px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>{day.label}</span>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>Each circle shows tasks completed that day</p>
            </div>

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "16px" }}>
              {[
                { label: "Total XP", value: currentXp, color: "var(--accent)" },
                { label: "Tasks Done", value: totalDone, color: "var(--success)" },
                { label: "Days Active", value: activeDays, color: "var(--text-primary)" }
              ].map(stat => (
                <div key={stat.label} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: "22px", fontWeight: "900", color: stat.color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>{stat.value}</div>
                  <div style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "4px" }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* XP Level card */}
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                <div>
                  <span style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-primary)" }}>{levelTitle}</span>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)", marginLeft: "6px" }}>L{levelNum}</span>
                </div>
                <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{xpInLevel}/200 XP</span>
              </div>
              <div className="progress-track" style={{ height: "7px", marginBottom: "12px" }}>
                <div className="progress-bar" style={{ width: `${levelProgress}%` }} />
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--text-muted)", lineHeight: "1.55" }}>
                <strong style={{ color: "var(--text-secondary)" }}>How you earn XP:</strong> Complete a task (+20 XP) · Complete a Roadmap task (+100 XP) · Finish Morning Ritual (+80 XP). Levels reset every 200 XP — your total keeps growing.
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Sub-view: Morning Ritual */}
      {toolPanel === "ritual" && (
        <>
          <div className="mindbox-subview-header">
            <button className="mindbox-back-btn" onClick={() => setToolPanel(null)}>← Back</button>
            <h2 className="mindbox-subview-title">🌅 Morning Ritual</h2>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ritualActive ? "20px" : "16px" }}>
              <div>
                <p style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)", margin: "0 0 3px" }}>Start your day with intention</p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>6 steps · ~7 min · +80 XP</p>
              </div>
              {!ritualActive ? (
                <button className="btn" onClick={handleBeginRitual} style={{ padding: "8px 22px", fontSize: "13px", fontWeight: "700", flexShrink: 0 }}>Begin</button>
              ) : (
                <button onClick={handleAbortRitual} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "13px", fontWeight: "700", cursor: "pointer", flexShrink: 0 }}>Stop</button>
              )}
            </div>
            {!ritualActive && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {ritualSteps.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "var(--text-muted)", minWidth: "18px", paddingTop: "2px" }}>{i + 1}.</span>
                    <div>
                      <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 2px", fontWeight: "600" }}>{step.name}</p>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{formatRitualTime(step.seconds)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ritualActive && (
              <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "10px", fontWeight: "800", color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    STEP {ritualStepIndex + 1} OF {ritualSteps.length}
                  </span>
                  <div style={{ display: "flex", gap: "5px" }}>
                    {ritualSteps.map((_, i) => (
                      <div key={i} style={{ width: "7px", height: "7px", borderRadius: "50%", background: i <= ritualStepIndex ? "var(--accent)" : "var(--border)" }} />
                    ))}
                  </div>
                </div>
                <p style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)", margin: 0, lineHeight: "1.45" }}>
                  {ritualSteps[ritualStepIndex].name}
                </p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "30px", fontWeight: "900", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    {formatRitualTime(ritualSecondsLeft)}
                  </span>
                  <button className="btn" onClick={handleAdvanceRitualStep} style={{ padding: "6px 18px", fontSize: "12px" }}>Skip →</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Main grid view */}
      {!toolPanel && (
        <>
          <div style={{ padding: "0 0 20px 0" }}>
            <h2 style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>Mind Box</h2>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Your tools, streaks, and reset buttons.</p>
          </div>

          {/* Brain Dump — always-live capture */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)" }}>📝 Brain Dump</span>
              {dumpCount > 0 && (
                <span style={{ fontSize: "11px", color: dumpCount >= 50 ? "var(--danger)" : "var(--text-muted)", fontWeight: "700" }}>{dumpCount}/50</span>
              )}
            </div>
            <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
              <input type="text" className="braindump-input"
                placeholder="What's on your mind?"
                value={brainDumpText}
                onChange={e => setBrainDumpText(e.target.value)}
                disabled={dumpCount >= 50} />
              <button type="submit" className="braindump-submit" disabled={dumpCount >= 50}>➔</button>
            </form>
            {dumpCount > 0 && hasAnyKey && (
              <button
                type="button"
                onClick={handleOrganizeDump}
                disabled={organizeLoading}
                style={{
                  marginTop: "10px", width: "100%", padding: "9px",
                  background: "var(--accent-ring, rgba(99,102,241,0.08))", color: "var(--accent)",
                  border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)",
                  fontSize: "13px", fontWeight: "700", cursor: "pointer"
                }}
              >
                ✨ Organize into tasks with AI
              </button>
            )}
            {recentDump.length > 0 && (
              <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "5px" }}>
                {recentDump.map(item => (
                  <p key={item.id} style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0, padding: "5px 8px", background: "var(--bg-secondary)", borderRadius: "6px", lineHeight: "1.4" }}>
                    {item.text}
                  </p>
                ))}
                {dumpCount > 3 && (
                  <button onClick={() => setToolPanel("dump")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: "var(--accent)", fontWeight: "700", textAlign: "left", padding: "2px 8px" }}>
                    See all {dumpCount} items →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 2×2 tool grid */}
          <div className="mindbox-grid">
            <button className="mindbox-card" onClick={() => setToolPanel("progress")}>
              <span className="mindbox-card-icon">📊</span>
              <span className="mindbox-card-title">Progress</span>
              <span className="mindbox-card-sub">{config.visitStreakCount || 0}d streak 🔥</span>
            </button>
            <button className="mindbox-card" onClick={() => setToolPanel("ritual")}>
              <span className="mindbox-card-icon">🌅</span>
              <span className="mindbox-card-title">Morning Ritual</span>
              <span className="mindbox-card-sub">7 min · +80 XP</span>
            </button>
            <button className="mindbox-card mindbox-card--rescue" onClick={openRescueMode}>
              <span className="mindbox-card-icon">🌊</span>
              <span className="mindbox-card-title">Rescue Mode</span>
              <span className="mindbox-card-sub">Step-by-step reset</span>
            </button>
            <button className="mindbox-card" onClick={handleBadDayReset}>
              <span className="mindbox-card-icon">🌪️</span>
              <span className="mindbox-card-title">Bad Day Reset</span>
              <span className="mindbox-card-sub">Restart without shame</span>
            </button>
            <button className="mindbox-card" onClick={handleCleanSlate} style={{ gridColumn: "span 2" }}>
              <span className="mindbox-card-icon">🌱</span>
              <span className="mindbox-card-title">Clean Slate</span>
              <span className="mindbox-card-sub">Move today's tasks to this week — nothing lost, fresh start</span>
            </button>
          </div>
        </>
      )}

      {/* ── Stuck Rescue Modal */}
      {showRescue && (
        <div className="rescue-overlay" onClick={() => setShowRescue(false)}>
          <div className="rescue-card card" onClick={e => e.stopPropagation()}>
            <span className="rescue-icon">⚠️</span>
            <h3 className="rescue-title">Rescue Mode</h3>
            <span className="rescue-step-badge">Step {rescueStepIndex + 1} of {rescueSteps.length}</span>
            <p className="rescue-step-text">{rescueSteps[rescueStepIndex]}</p>
            <button className="btn" onClick={handleNextRescueStep} style={{ width: "100%", marginTop: "10px" }}>
              {rescueStepIndex === rescueSteps.length - 1 ? "I'm ready to try again" : "Next →"}
            </button>
            <button className="btn btn-cancel" onClick={() => setShowRescue(false)} style={{ width: "100%" }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Rescue Mode v2 */}
      {rescueActive && (
        <RescueMode
          task={rescueTask}
          allTasks={tasks}
          firstName={(config.userName || "").split(" ")[0] || "friend"}
          apiKey={getAIKeys().geminiKey}
          onDismiss={() => setRescueActive(false)}
          onAccept={() => {
            setRescueActive(false);
            if (rescueTask) {
              savePayload({ ...payload, tasks: tasks.map(t => t.uuid === rescueTask.uuid ? { ...t, isNowFocus: true } : t) });
            }
          }}
        />
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </>
  );
}
