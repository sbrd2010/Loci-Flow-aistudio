import React, { useState, useEffect, useRef } from "react";
import RescueMode from "./RescueMode";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { getAIKeys } from "../utils/aiCall";

export default function MindBoxTab({ payload, savePayload }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  // ── State ──────────────────────────────────────────────────────────────────
  const [toolPanel, setToolPanel] = useState(null);
  const [vizMode, setVizMode] = useState(() => localStorage.getItem("loci_viz") || "streak");
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
      message: "Park all active tasks for today?\n\nYou can restore them from the AI Coach tab.",
      confirmLabel: "Park all", cancelLabel: "Cancel",
      onConfirm: () => {
        savePayload({ ...payload, tasks: tasks.map(t => (!t.isCompleted && !t.isDeleted) ? { ...t, isParked: true, isNowFocus: false } : t) });
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
  return (
    <>
      {ritualSuccess && (
        <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", background: "var(--success)", color: "#fff", padding: "12px 24px", borderRadius: "20px", fontWeight: "700", fontSize: "14px", zIndex: 300, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
          Morning Ritual complete! +80 XP
        </div>
      )}

      {/* Page title */}
      <div style={{ padding: "0 0 16px 0" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>Mind Box</h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Your tools, streaks, and reset buttons.</p>
      </div>

      {/* ── Utility strip: inline (hidden when dock is active) */}
      {(config.toolsStyle || "inline") !== "dock" && <section style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
        <div className="habits-tools-row" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px" }}>
          {/* Streak + 7-day dots — tap to expand progress detail */}
          <button
            onClick={() => setToolPanel(p => p === "progress" ? null : "progress")}
            style={{ display: "flex", alignItems: "center", gap: "5px", flex: 1, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
          >
            <span style={{ fontSize: "12px", fontWeight: "800", color: "var(--accent)", whiteSpace: "nowrap" }}>
              {config.visitStreakCount || 0}d
            </span>
            <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
              {bentoDays.map((day, i) => (
                <div key={day.dateStr} style={{
                  width: i === 6 ? "10px" : "7px",
                  height: i === 6 ? "10px" : "7px",
                  borderRadius: "50%",
                  background: day.count > 0 ? "var(--accent)" : "var(--bg-secondary)",
                  border: i === 6 ? "2px solid var(--accent)" : "1px solid var(--border)",
                  flexShrink: 0
                }} />
              ))}
            </div>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{toolPanel === "progress" ? "▲" : "▼"}</span>
          </button>

          {/* Morning Ritual */}
          <button
            onClick={() => setToolPanel(p => p === "ritual" ? null : "ritual")}
            title="Morning Ritual"
            style={{
              fontSize: "15px", padding: "5px 9px",
              background: (ritualActive || toolPanel === "ritual") ? "var(--accent)" : "var(--bg-secondary)",
              color: (ritualActive || toolPanel === "ritual") ? "var(--btn-text, #fff)" : "var(--text-secondary)",
              border: ritualActive ? "2px solid var(--success)" : "1px solid var(--border)",
              borderRadius: "8px", cursor: "pointer", lineHeight: 1
            }}
          >
            🌅<span className="tool-btn-text">Ritual</span>
          </button>

          {/* Brain Dump */}
          <button
            onClick={() => setToolPanel(p => p === "dump" ? null : "dump")}
            title="Brain Dump"
            style={{
              fontSize: "15px", padding: "5px 9px", position: "relative",
              background: toolPanel === "dump" ? "var(--accent)" : "var(--bg-secondary)",
              color: toolPanel === "dump" ? "var(--btn-text, #fff)" : "var(--text-secondary)",
              border: "1px solid var(--border)", borderRadius: "8px", cursor: "pointer", lineHeight: 1
            }}
          >
            📝<span className="tool-btn-text">Dump</span>
            {dumpCount > 0 && (
              <span style={{ position: "absolute", top: "-5px", right: "-5px", background: "var(--accent)", color: "var(--btn-text, #fff)", fontSize: "8px", fontWeight: "800", borderRadius: "6px", padding: "1px 4px", lineHeight: 1.3 }}>
                {dumpCount}
              </span>
            )}
          </button>

          {/* Rescue */}
          <button onClick={openRescueMode} title="Rescue Mode"
            style={{ fontSize: "15px", padding: "5px 9px", background: "rgba(248,113,113,0.12)", border: "1px solid var(--danger)", borderRadius: "8px", color: "var(--danger)", cursor: "pointer", lineHeight: 1 }}>
            🚨<span className="tool-btn-text">Rescue</span>
          </button>

          {/* Bad Day Reset */}
          <button onClick={handleBadDayReset} title="Bad Day Reset"
            style={{ fontSize: "15px", padding: "5px 9px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-secondary)", cursor: "pointer", lineHeight: 1 }}>
            🌪️<span className="tool-btn-text">Reset</span>
          </button>
        </div>

        {/* Expandable: 7-Day Progress */}
        {toolPanel === "progress" && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                📊 7-Day Progress
              </h3>
              <div style={{ display: "flex", gap: "4px" }}>
                {[{ id: "streak", label: "🔥" }, { id: "dots", label: "●" }].map(v => (
                  <button key={v.id} onClick={() => { setVizMode(v.id); localStorage.setItem("loci_viz", v.id); }}
                    style={{ padding: "3px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "20px", cursor: "pointer", fontWeight: "700", background: vizMode === v.id ? "var(--accent)" : "var(--bg-secondary)", color: vizMode === v.id ? "var(--btn-text, #fff)" : "var(--text-muted)", transition: "all 0.15s" }}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            {vizMode === "streak" && (() => {
              const streak = config.visitStreakCount || 0;
              return (
                <div style={{ textAlign: "center" }}>
                  <div style={{ marginBottom: "14px" }}>
                    <span style={{ fontSize: "clamp(28px, 8vw, 44px)", fontWeight: "900", color: "var(--accent)", lineHeight: "1", fontFamily: "var(--font-display)" }}>
                      {streak}
                    </span>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "2px" }}>
                      day streak 🔥
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "8px" }}>
                    {bentoDays.map((day, i) => {
                      const isToday = i === 6;
                      const done = day.count > 0;
                      return (
                        <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                          <div style={{ width: isToday ? "28px" : "22px", height: isToday ? "28px" : "22px", borderRadius: "50%", background: done ? "var(--accent)" : "var(--bg-secondary)", border: isToday ? "2px solid var(--accent)" : "2px solid var(--border)", transition: "all 0.2s" }} />
                          <span style={{ fontSize: "8px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>
                            {day.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600" }}>Filled = tasks done that day</p>
                </div>
              );
            })()}
            {vizMode === "dots" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  {bentoDays.map((day, i) => {
                    const isToday = i === 6;
                    const done = day.count > 0;
                    return (
                      <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flex: 1 }}>
                        <span style={{ fontSize: "9px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>
                          {day.label}
                        </span>
                        <div style={{ width: isToday ? "32px" : "26px", height: isToday ? "32px" : "26px", borderRadius: "50%", background: done ? "var(--success, #22c55e)" : "var(--bg-secondary)", border: isToday ? "2.5px solid var(--accent)" : done ? "none" : "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                          {done && <span style={{ fontSize: "12px" }}>✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600", marginTop: "4px" }}>
                  Green ✓ = showed up · Today highlighted
                </p>
              </div>
            )}
          </div>
        )}

        {/* Expandable: Morning Ritual */}
        {toolPanel === "ritual" && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: ritualActive ? "10px" : 0 }}>
              <span style={{ fontSize: "16px" }}>🌅</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Morning Ritual</span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>7 min · +80 XP</span>
              </div>
              {!ritualActive ? (
                <button className="btn" onClick={handleBeginRitual} style={{ padding: "6px 16px", fontSize: "12px", fontWeight: "700" }}>
                  Begin
                </button>
              ) : (
                <button onClick={handleAbortRitual} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
                  Stop
                </button>
              )}
            </div>
            {ritualActive && (
              <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "10px", fontWeight: "800", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  STEP {ritualStepIndex + 1} OF {ritualSteps.length}
                </span>
                <p style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>
                  {ritualSteps[ritualStepIndex].name}
                </p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "20px", fontWeight: "800", color: "var(--accent)", fontFamily: "var(--font-display)" }}>
                    {formatRitualTime(ritualSecondsLeft)}
                  </span>
                  <button className="btn" onClick={handleAdvanceRitualStep} style={{ padding: "5px 14px", fontSize: "12px", background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                    Skip →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expandable: Brain Dump */}
        {toolPanel === "dump" && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h2 className="section-title" style={{ fontSize: "13px", margin: 0 }}>📝 Brain Dump</h2>
              {dumpCount > 0 && (
                <span style={{ fontSize: "11px", color: dumpCount >= 50 ? "var(--danger)" : "var(--text-muted)", fontWeight: "700" }}>
                  {dumpCount}/50
                </span>
              )}
            </div>
            {dumpCount >= 50 && (
              <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "8px", fontWeight: "600" }}>
                Inbox full (50/50). Go to the Roadmap tab to triage items first.
              </p>
            )}
            <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
              <input type="text" className="braindump-input"
                placeholder="Add anything on your mind."
                value={brainDumpText}
                onChange={e => setBrainDumpText(e.target.value)}
                disabled={dumpCount >= 50} />
              <button type="submit" className="braindump-submit" disabled={dumpCount >= 50}>➔</button>
            </form>
          </div>
        )}
      </section>}

      {/* ── Floating Bottom Dock (Concept 3) */}
      {config.toolsStyle === "dock" && (
        <>
          {/* Spacer so content isn't hidden behind the dock */}
          <div style={{ height: "72px" }} />

          {/* Backdrop */}
          {toolPanel && (
            <div className="tools-sheet-backdrop" onClick={() => setToolPanel(null)} />
          )}

          {/* Bottom Sheet content */}
          {toolPanel && (
            <div className="tools-bottom-sheet">
              <div className="tools-sheet-handle" />

              {toolPanel === "progress" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                      📊 7-Day Progress
                    </h3>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {[{ id: "streak", label: "🔥" }, { id: "dots", label: "●" }].map(v => (
                        <button key={v.id} onClick={() => { setVizMode(v.id); localStorage.setItem("loci_viz", v.id); }}
                          style={{ padding: "3px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "20px", cursor: "pointer", fontWeight: "700", background: vizMode === v.id ? "var(--accent)" : "var(--bg-secondary)", color: vizMode === v.id ? "var(--btn-text, #fff)" : "var(--text-muted)", transition: "all 0.15s" }}>
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {vizMode === "streak" && (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ marginBottom: "14px" }}>
                        <span style={{ fontSize: "clamp(28px, 8vw, 44px)", fontWeight: "900", color: "var(--accent)", lineHeight: "1", fontFamily: "var(--font-display)" }}>
                          {config.visitStreakCount || 0}
                        </span>
                        <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "2px" }}>day streak 🔥</div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "8px" }}>
                        {bentoDays.map((day, i) => {
                          const isToday = i === 6;
                          const done = day.count > 0;
                          return (
                            <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                              <div style={{ width: isToday ? "28px" : "22px", height: isToday ? "28px" : "22px", borderRadius: "50%", background: done ? "var(--accent)" : "var(--bg-secondary)", border: isToday ? "2px solid var(--accent)" : "2px solid var(--border)", transition: "all 0.2s" }} />
                              <span style={{ fontSize: "8px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>{day.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600" }}>Filled = tasks done that day</p>
                    </div>
                  )}
                  {vizMode === "dots" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        {bentoDays.map((day, i) => {
                          const isToday = i === 6;
                          const done = day.count > 0;
                          return (
                            <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flex: 1 }}>
                              <span style={{ fontSize: "9px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>{day.label}</span>
                              <div style={{ width: isToday ? "32px" : "26px", height: isToday ? "32px" : "26px", borderRadius: "50%", background: done ? "var(--success, #22c55e)" : "var(--bg-secondary)", border: isToday ? "2.5px solid var(--accent)" : done ? "none" : "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                                {done && <span style={{ fontSize: "12px" }}>✓</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600", marginTop: "4px" }}>Green ✓ = showed up · Today highlighted</p>
                    </div>
                  )}
                </div>
              )}

              {toolPanel === "ritual" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: ritualActive ? "10px" : 0 }}>
                    <span style={{ fontSize: "16px" }}>🌅</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Morning Ritual</span>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>7 min · +80 XP</span>
                    </div>
                    {!ritualActive ? (
                      <button className="btn" onClick={handleBeginRitual} style={{ padding: "6px 16px", fontSize: "12px", fontWeight: "700" }}>Begin</button>
                    ) : (
                      <button onClick={handleAbortRitual} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Stop</button>
                    )}
                  </div>
                  {ritualActive && (
                    <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px", display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>STEP {ritualStepIndex + 1} OF {ritualSteps.length}</span>
                      <p style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>{ritualSteps[ritualStepIndex].name}</p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "20px", fontWeight: "800", color: "var(--accent)", fontFamily: "var(--font-display)" }}>{formatRitualTime(ritualSecondsLeft)}</span>
                        <button className="btn" onClick={handleAdvanceRitualStep} style={{ padding: "5px 14px", fontSize: "12px", background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>Skip →</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {toolPanel === "dump" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <h2 className="section-title" style={{ fontSize: "13px", margin: 0 }}>📝 Brain Dump</h2>
                    {dumpCount > 0 && (
                      <span style={{ fontSize: "11px", color: dumpCount >= 50 ? "var(--danger)" : "var(--text-muted)", fontWeight: "700" }}>{dumpCount}/50</span>
                    )}
                  </div>
                  {dumpCount >= 50 && (
                    <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "8px", fontWeight: "600" }}>Inbox full (50/50). Go to Roadmap to triage first.</p>
                  )}
                  <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
                    <input type="text" className="braindump-input"
                      placeholder="Add anything on your mind."
                      value={brainDumpText}
                      onChange={e => setBrainDumpText(e.target.value)}
                      disabled={dumpCount >= 50} />
                    <button type="submit" className="braindump-submit" disabled={dumpCount >= 50}>➔</button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* The dock itself */}
          <div className="floating-tools-dock">
            <button
              onClick={() => setToolPanel(p => p === "progress" ? null : "progress")}
              style={{ display: "flex", alignItems: "center", gap: "5px", background: toolPanel === "progress" ? "rgba(255,255,255,0.1)" : "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "16px" }}
            >
              <span style={{ fontSize: "12px", fontWeight: "800", color: "var(--accent)", whiteSpace: "nowrap" }}>🔥 {config.visitStreakCount || 0}d</span>
              <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                {bentoDays.map((day, i) => (
                  <div key={day.dateStr} style={{ width: i === 6 ? "8px" : "6px", height: i === 6 ? "8px" : "6px", borderRadius: "50%", background: day.count > 0 ? "var(--accent)" : "rgba(255,255,255,0.15)", border: i === 6 ? "1.5px solid var(--accent)" : "1px solid rgba(255,255,255,0.2)", flexShrink: 0 }} />
                ))}
              </div>
            </button>

            <div style={{ width: "1px", height: "24px", background: "rgba(255,255,255,0.12)" }} />

            <button onClick={() => setToolPanel(p => p === "ritual" ? null : "ritual")}
              style={{ fontSize: "18px", padding: "6px", background: (ritualActive || toolPanel === "ritual") ? "rgba(255,255,255,0.15)" : "transparent", border: ritualActive ? "1.5px solid var(--success)" : "none", borderRadius: "10px", cursor: "pointer", lineHeight: 1, color: "inherit" }} title="Morning Ritual">
              🌅
            </button>

            <button onClick={() => setToolPanel(p => p === "dump" ? null : "dump")}
              style={{ fontSize: "18px", padding: "6px", background: toolPanel === "dump" ? "rgba(255,255,255,0.15)" : "transparent", border: "none", borderRadius: "10px", cursor: "pointer", lineHeight: 1, position: "relative" }} title="Brain Dump">
              📝
              {dumpCount > 0 && (
                <span style={{ position: "absolute", top: "2px", right: "2px", background: "var(--accent)", color: "#fff", fontSize: "7px", fontWeight: "800", borderRadius: "5px", padding: "1px 3px", lineHeight: 1.2 }}>{dumpCount}</span>
              )}
            </button>

            <button onClick={openRescueMode}
              style={{ fontSize: "18px", padding: "6px", background: "transparent", border: "none", borderRadius: "10px", cursor: "pointer", lineHeight: 1 }} title="Rescue Mode">
              🚨
            </button>

            <button onClick={handleBadDayReset}
              style={{ fontSize: "18px", padding: "6px", background: "transparent", border: "none", borderRadius: "10px", cursor: "pointer", lineHeight: 1 }} title="Bad Day Reset">
              🌪️
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
