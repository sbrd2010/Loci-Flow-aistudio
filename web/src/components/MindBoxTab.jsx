import React, { useState, useEffect, useRef } from "react";
import RescueMode from "./RescueMode";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { getAIKeys } from "../utils/aiCall";

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

      {/* ── Sub-view: 7-Day Progress */}
      {toolPanel === "progress" && (
        <>
          <div className="mindbox-subview-header">
            <button className="mindbox-back-btn" onClick={() => setToolPanel(null)}>← Back</button>
            <h2 className="mindbox-subview-title">📊 Progress</h2>
          </div>
          <div style={{ textAlign: "center", padding: "20px 0 28px" }}>
            <span style={{ fontSize: "clamp(52px, 16vw, 80px)", fontWeight: "900", color: "var(--accent)", lineHeight: "1", fontFamily: "var(--font-display)" }}>
              {config.visitStreakCount || 0}
            </span>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "6px", marginBottom: "28px" }}>
              day streak 🔥
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "10px" }}>
              {bentoDays.map((day, i) => {
                const isToday = i === 6;
                const done = day.count > 0;
                return (
                  <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                    <div style={{ width: isToday ? "36px" : "28px", height: isToday ? "36px" : "28px", borderRadius: "50%", background: done ? "var(--accent)" : "var(--bg-secondary)", border: isToday ? "2.5px solid var(--accent)" : "2px solid var(--border)", transition: "all 0.2s" }} />
                    <span style={{ fontSize: "9px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>{day.label}</span>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "600", marginTop: "4px" }}>Filled circle = tasks completed that day</p>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "16px 20px", display: "flex", justifyContent: "space-around", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: "24px", fontWeight: "900", color: "var(--accent)", fontFamily: "var(--font-display)" }}>{config.totalXp || 0}</div>
              <div style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px" }}>Total XP</div>
            </div>
            <div style={{ width: "1px", background: "var(--border)" }} />
            <div>
              <div style={{ fontSize: "24px", fontWeight: "900", color: "var(--success, #22c55e)", fontFamily: "var(--font-display)" }}>
                {tasks.filter(t => !t.isDeleted && t.isCompleted).length}
              </div>
              <div style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px" }}>Tasks Done</div>
            </div>
            <div style={{ width: "1px", background: "var(--border)" }} />
            <div>
              <div style={{ fontSize: "24px", fontWeight: "900", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                {bentoDays.filter(d => d.count > 0).length}
              </div>
              <div style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px" }}>Days This Week</div>
            </div>
          </div>
        </>
      )}

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
                  <span style={{ fontSize: "30px", fontWeight: "900", color: "var(--accent)", fontFamily: "var(--font-display)" }}>
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
            <h2 style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>Mind Box</h2>
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
              <span className="mindbox-card-icon">🚨</span>
              <span className="mindbox-card-title">Rescue Mode</span>
              <span className="mindbox-card-sub">I'm stuck</span>
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
            <h3 className="rescue-title">Executive Freeze Rescue Pod</h3>
            <span className="rescue-step-badge">Step {rescueStepIndex + 1} of {rescueSteps.length}</span>
            <p className="rescue-step-text">{rescueSteps[rescueStepIndex]}</p>
            <button className="btn" onClick={handleNextRescueStep} style={{ width: "100%", marginTop: "10px" }}>
              {rescueStepIndex === rescueSteps.length - 1 ? "I am ready to move the needle!" : "Next Step"}
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
