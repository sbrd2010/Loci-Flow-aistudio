import React, { useState } from "react";
import { callAI, getAIKeys, hasAIKey } from "../utils/aiCall";
import { safeUUID } from "../utils/uuid";
import { scheduleReminder, cancelReminder, formatReminderLabel } from "../utils/reminders";
import { applyAiRewriteToTask, CATEGORY_ICONS } from "../utils/taskOps";

function defaultReminderDateTime() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const dateStr = d.toISOString().slice(0, 10);
  const timeStr = `${String(d.getHours()).padStart(2, "0")}:00`;
  return { dateStr, timeStr };
}


export default function AddTaskDialog({ email, payload, savePayload, userProfile, defaultHorizon, onClose, editTask }) {
  const isEditMode = !!editTask;
  const [title, setTitle] = useState(editTask?.title || "");
  const [concreteStep, setConcreteStep] = useState(editTask?.concreteStep || "");
  const [horizonLevel, setHorizonLevel] = useState(editTask?.horizonLevel || defaultHorizon || "today");
  const [saved, setSaved] = useState(false);
  const [priority, setPriority] = useState(editTask?.priority || "P3");
  const [category, setCategory] = useState(editTask?.category || "Personal");
  const [estimateMinutes, setEstimateMinutes] = useState(editTask?.timeEstimateMinutes || 25);
  const [advancedOpen, setAdvancedOpen] = useState(isEditMode);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [subSteps, setSubSteps] = useState(editTask?.subSteps || []);
  const [formError, setFormError] = useState("");
  const [reminderOn, setReminderOn] = useState(!!editTask?.reminderAt);
  const [reminderDate, setReminderDate] = useState(() => {
    if (editTask?.reminderAt) {
      return new Date(editTask.reminderAt).toISOString().slice(0, 10);
    }
    return defaultReminderDateTime().dateStr;
  });
  const [reminderTime, setReminderTime] = useState(() => {
    if (editTask?.reminderAt) {
      const d = new Date(editTask.reminderAt);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    return defaultReminderDateTime().timeStr;
  });

  const { groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const hasAnyKey = hasAIKey();

  const handleAiSuggest = async () => {
    if (!title.trim()) { setAiError("Type a rough task idea first, then tap Ask AI."); return; }
    if (!hasAnyKey) { setAiError("No AI key — add one in Settings."); return; }
    setAiLoading(true);
    setAiError("");
    setAiSuggestion(null);
    const cfg = payload.config || {};
    const challengeLabel =
      cfg.challengeType === "overplanner"  ? "over-plans and researches but rarely starts (needs forced simplicity and an execution nudge)" :
      cfg.challengeType === "overwhelmed"  ? "feels overwhelmed and guilty about backlog (needs reassurance, recovery framing, and one clear next action)" :
      cfg.challengeType === "initiation"   ? "freezes before starting despite knowing what to do (needs scaffolding, micro-starts, and low-threshold first steps)" :
      cfg.challengeType === "momentum"     ? "needs a quick win to get rolling (needs P4 fast-finish tasks and visible forward movement)" :
      cfg.challengeType === "starting"     ? "struggles to start tasks (task initiation block)" :
      cfg.challengeType === "focusing"     ? "gets distracted mid-task (focus protection)" :
      cfg.challengeType === "tracking"     ? "has trouble tracking progress and staying accountable (needs visible checkpoints)" :
      "overthinks and delays finishing (perfectionism/action paralysis)";
    const existingTasks = (payload.tasks || []).filter(t => !t.isDeleted && !t.isCompleted).slice(0, 8)
      .map(t => `[${t.priority}] ${t.title}`).join(", ") || "none yet";
    const profile = userProfile;
    const profileNote = profile && profile.totalTasks >= 5
      ? `\nUser's task patterns: completion rate ${Math.round(profile.completionRate * 100)}%, dominant horizon "${profile.dominantHorizon}", avg estimate ${profile.avgEstimateMinutes}min. Use these to inform your horizon, priority, and estimate suggestions.`
      : "";
    const prompt = `You are an expert productivity coach specialising in focus, momentum, and execution support. The user typed this rough task idea: "${title.trim()}".

Transform it into a well-structured, focus-friendly task. The user's core challenge: ${challengeLabel}.${profileNote}

TASK DESIGN RULES:
- Title must be specific and outcome-oriented (not vague verbs like "work on" or "think about")
- microStep is the DOOR-HANDLE move — the single physical action that takes under 2 minutes and removes the initiation barrier
- Priority should account for the user's challenge: if they struggle to start, lean P3/P4 to reduce pressure
- Time estimate should be honest — tasks often take 1.5x expected time
- horizonLevel: "today" only if deadline is today or extremely urgent; "week" for most tasks; "month"/"quarter" for longer-term goals
- Never use the word "ADHD" in your response
- Their current tasks for context: ${existingTasks}
- subSteps: extract 2-4 key points or sub-tasks from the original input that would be lost in the shortened title. Use [] if the input is short or the title already captures everything.

Respond with ONLY valid JSON (no markdown, no code blocks), exactly this structure:
{"title":"<specific outcome-oriented title, max 60 chars>","microStep":"<single door-handle action, max 60 chars>","priority":"P2","estimateMinutes":25,"horizonLevel":"week","subSteps":[{"text":"key point 1"},{"text":"key point 2"}]}

priority options: P1 (urgent+must do today), P2 (important this week), P3 (normal queue), P4 (easy quick-win, under 15 min)
estimateMinutes options: 15, 25, 45, 60, 120, 240, 360
horizonLevel options: "today", "week" (default), "month", "quarter", "halfyear"`;

    try {
      const raw = await callAI({
        groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey,
        systemPrompt: "You are a productivity coach. Respond ONLY with valid JSON, no markdown.",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 350
      });
      let cleaned = raw.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error("No JSON");
      }
      setAiSuggestion({
        title: parsed.title || title.trim(),
        microStep: parsed.microStep || "",
        priority: parsed.priority,
        estimateMinutes: parsed.estimateMinutes,
        horizonLevel: parsed.horizonLevel,
        subSteps: Array.isArray(parsed.subSteps) ? parsed.subSteps.filter(s => s && s.text) : [],
      });
    } catch (err) {
      setAiError("AI suggestion failed — fill in manually.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAISuggestion = () => {
    if (!aiSuggestion) return;
    if (isEditMode) {
      // Rewrite mode: only update text content; preserve ALL planning metadata
      // (horizonLevel, priority, timeEstimate, uuid, id, dayMap fields, etc.)
      const merged = applyAiRewriteToTask(editTask, aiSuggestion);
      setTitle(merged.title);
      setConcreteStep(merged.concreteStep);
      setSubSteps(merged.subSteps || []);
      setAdvancedOpen(true);
    } else {
      // New task: AI may suggest all fields
      if (aiSuggestion.title) setTitle(aiSuggestion.title);
      if (aiSuggestion.microStep) { setConcreteStep(aiSuggestion.microStep); setAdvancedOpen(true); }
      if (["P1","P2","P3","P4"].includes(aiSuggestion.priority)) setPriority(aiSuggestion.priority);
      const est = Number(aiSuggestion.estimateMinutes);
      if ([15,25,45,60,120,240,360].includes(est)) setEstimateMinutes(est);
      if (["today","week","month","quarter","halfyear","office"].includes(aiSuggestion.horizonLevel)) setHorizonLevel(aiSuggestion.horizonLevel);
      if (aiSuggestion.subSteps.length > 0) {
        const now = Date.now();
        setSubSteps(aiSuggestion.subSteps.map((s, i) => ({ id: `ai-ss-${i}-${now}`, text: s.text, done: false })));
        setAdvancedOpen(true);
      }
    }
    setAiSuggestion(null);
  };

  const horizons = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "Month" },
    { key: "quarter", label: "Quarter" },
    { key: "halfyear", label: "6 Months" },
    { key: "office", label: "Work" }
  ];

  const priorities = ["P1", "P2", "P3", "P4"];
  const categories = ["Career", "Health", "Work", "Personal"];
  const estimates = [
    { min: 15, label: "15m" }, { min: 25, label: "25m" }, { min: 45, label: "45m" },
    { min: 60, label: "1h" }, { min: 120, label: "2h" }, { min: 240, label: "4h" }, { min: 360, label: "6h" }
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    // Evening Guard window block logic
    const now = new Date();
    const hour = now.getHours();
    if (payload.config?.eveningGuardWindowActive && hour >= 20) {
      setFormError("🌙 Evening Guard is active — no new tasks at or after 8 PM. Go rest!");
      return;
    }
    setFormError("");

    // Calculate orderIndex as size of active level tasks
    const currentLevelTasks = (payload.tasks || []).filter(
      (t) => t.horizonLevel === horizonLevel && !t.isDeleted
    );
    const orderIndex = currentLevelTasks.length;

    // Build reminderAt timestamp from picker values
    let reminderAt = null;
    if (reminderOn && reminderDate && reminderTime) {
      reminderAt = new Date(`${reminderDate}T${reminderTime}`).getTime();
      if (isNaN(reminderAt) || reminderAt <= Date.now()) reminderAt = null;
    }

    // Request notification permission if a reminder is set
    if (reminderAt && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    if (isEditMode) {
      // Mirror DayMap's own duration edit (DayMapPage.jsx's changeDuration), which
      // writes both fields — otherwise a stale dayMapDurationMinutes from an earlier
      // DayMap schedule keeps overriding this edit there (DayMap's getEstimate prefers
      // dayMapDurationMinutes over timeEstimateMinutes).
      const updatedTask = {
        ...editTask,
        title: title.trim(),
        concreteStep: concreteStep.trim() || editTask.concreteStep || "Do first tiny step",
        horizonLevel,
        priority,
        category,
        timeEstimateMinutes: Number(estimateMinutes),
        dayMapDurationMinutes: Number(estimateMinutes),
        reminderAt,
        lastUpdated: Date.now()
      };
      if (subSteps.length > 0) updatedTask.subSteps = subSteps;
      if (reminderAt && reminderAt !== editTask.reminderAt) scheduleReminder(updatedTask);
      if (!reminderAt && editTask.reminderAt) cancelReminder(editTask.uuid);
      savePayload({ ...payload, tasks: (payload.tasks || []).map(t => t.uuid === editTask.uuid ? updatedTask : t) });
      setSaved(true);
      setTimeout(onClose, 900);
      return;
    }

    const freshTask = {
      id: Date.now(),
      userId: email,
      uuid: safeUUID(),
      title: title.trim(),
      concreteStep: concreteStep.trim() || "Do first tiny step",
      horizonLevel,
      priority,
      category,
      timeEstimateMinutes: Number(estimateMinutes),
      deadlineTimestamp: null,
      reminderAt,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      orderIndex,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: Date.now(),
      ...(subSteps.length > 0 && { subSteps }),
    };

    if (reminderAt) scheduleReminder(freshTask);

    const updatedTasks = [...(payload.tasks || []), freshTask];
    savePayload({
      ...payload,
      tasks: updatedTasks
    });

    setSaved(true);
    setTimeout(onClose, 900);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEditMode ? "Edit Task" : "Add Task"}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Evening Guard upfront warning */}
          {payload.config?.eveningGuardWindowActive && new Date().getHours() >= 20 && (
            <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm)", padding: "10px 12px", fontSize: "12.5px", color: "var(--warning)", fontWeight: "600", lineHeight: "1.5", marginBottom: "4px" }}>
              🌙 Evening Guard is active. Adding tasks after 8 PM is blocked — go rest!
            </div>
          )}
          {/* Title + Ask AI */}
          <div className="form-group">
            <label className="form-label">WHAT DO YOU WANT TO DO? (REQUIRED)</label>
            <textarea
              className="text-input"
              data-testid="add-task-title"
              placeholder="e.g. Write cover letter draft"
              rows={3}
              maxLength={1000}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
            {hasAnyKey && (
              <button
                type="button"
                onClick={handleAiSuggest}
                disabled={aiLoading}
                style={{
                  marginTop: "8px", width: "100%", padding: "9px",
                  background: "var(--accent-ring)", color: "var(--accent)",
                  border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)",
                  fontSize: "13px", fontWeight: "700", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                }}
              >
                {aiLoading ? "✨ Thinking…" : "✨ Ask AI to improve this task"}
              </button>
            )}
            {aiError && (
              <p style={{ fontSize: "11.5px", color: "var(--danger)", marginTop: "4px" }}>{aiError}</p>
            )}
            {aiSuggestion && (
              <div style={{ background: "var(--accent-ring)", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", padding: "10px 12px", marginTop: "8px" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>✨ AI Suggestion — review before applying</div>
                <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "3px" }}>{aiSuggestion.title}</div>
                {aiSuggestion.microStep && <div style={{ fontSize: "11.5px", color: "var(--text-secondary)", marginBottom: "3px" }}>First step: {aiSuggestion.microStep}</div>}
                {aiSuggestion.subSteps.length > 0 && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" }}>{aiSuggestion.subSteps.length} key point{aiSuggestion.subSteps.length > 1 ? "s" : ""} saved as sub-steps</div>
                )}
                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  <button type="button" onClick={handleApplyAISuggestion} style={{ flex: 1, padding: "8px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Apply</button>
                  <button type="button" onClick={() => setAiSuggestion(null)} style={{ flex: 1, padding: "8px", background: "var(--bg-secondary)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Keep my text</button>
                </div>
              </div>
            )}
          </div>

          {/* Horizon Level */}
          <div className="form-group">
            <label className="form-label">HORIZON</label>
            <div className="horizons-grid" style={{ gap: "6px" }}>
              {horizons.map((h) => (
                <button
                  key={h.key}
                  type="button"
                  className={`selector-btn ${horizonLevel === h.key ? "selected" : ""}`}
                  style={{ padding: "6px 4px", fontSize: "11.5px" }}
                  onClick={() => setHorizonLevel(h.key)}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className="form-group">
            <label className="form-label">PRIORITY</label>
            <div style={{ display: "flex", gap: "6px" }}>
              {priorities.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`priority-selector-btn ${priority === p ? `selected ${p.toLowerCase()}` : ""}`}
                  style={{ padding: "7px 4px", fontSize: "12px" }}
                  onClick={() => setPriority(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Reminder picker */}
          <div style={{ marginBottom: "4px" }}>
            <button
              type="button"
              onClick={async () => {
                if (!reminderOn && typeof Notification !== "undefined" && Notification.permission === "default") {
                  await Notification.requestPermission();
                }
                setReminderOn(o => !o);
              }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", padding: "10px 14px",
                background: reminderOn ? "var(--accent-ring, rgba(99,102,241,0.08))" : "var(--bg-secondary)",
                border: reminderOn ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                borderRadius: "8px", cursor: "pointer", transition: "all 0.15s"
              }}
            >
              <span style={{ fontSize: "13px", fontWeight: "700", color: reminderOn ? "var(--accent)" : "var(--text-secondary)" }}>
                🔔 {reminderOn ? `Remind me: ${formatReminderLabel(new Date(`${reminderDate}T${reminderTime}`).getTime())}` : "Set a reminder"}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{reminderOn ? "✕ remove" : "+"}</span>
            </button>
            {reminderOn && (
              <div style={{ display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" }}>
                <input
                  type="date"
                  className="text-input"
                  value={reminderDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={e => setReminderDate(e.target.value)}
                  style={{ flex: 1.4 }}
                />
                <input
                  type="time"
                  className="text-input"
                  value={reminderTime}
                  onChange={e => setReminderTime(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
            )}
          </div>

          {/* Advanced toggle — Category + Time Estimate */}
          <div style={{ marginBottom: "4px" }}>
            <button type="button" onClick={() => setAdvancedOpen(o => !o)}
              style={{
                background: "var(--bg-secondary)", border: "1.5px solid var(--border)",
                color: "var(--text-secondary)", fontSize: "12.5px", fontWeight: "700",
                cursor: "pointer", padding: "8px 14px", borderRadius: "8px",
                display: "flex", alignItems: "center", gap: "6px", width: "100%"
              }}>
              {advancedOpen ? "▾" : "▸"} Advanced options
            </button>
          </div>
          {advancedOpen && (
            <>
              <div className="form-group">
                <label className="form-label">MICRO ACTION (FIRST TINY STEP)</label>
                <input
                  type="text"
                  className="text-input"
                  placeholder="e.g. Open Google Doc and write greeting line"
                  value={concreteStep}
                  onChange={(e) => setConcreteStep(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">TIME ESTIMATE</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
                  {estimates.map((est) => (
                    <button
                      key={est.min}
                      type="button"
                      className={`selector-btn ${estimateMinutes === est.min ? "selected" : ""}`}
                      style={{ padding: "6px 4px", fontSize: "11.5px" }}
                      onClick={() => setEstimateMinutes(est.min)}
                    >
                      {est.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">CATEGORY</label>
                <div className="btn-group" style={{ gap: "4px" }}>
                  {categories.map((c) => (
                    <button key={c} type="button"
                      className={`selector-btn ${category === c ? "selected" : ""}`}
                      style={{ padding: "6px 2px", fontSize: "11px", whiteSpace: "nowrap" }}
                      onClick={() => setCategory(c)}>{CATEGORY_ICONS[c]} {c}</button>
                  ))}
                </div>
              </div>
              {subSteps.length > 0 && (
                <div className="form-group">
                  <label className="form-label">SUB-STEPS ({subSteps.length})</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    {subSteps.map((s) => (
                      <div key={s.id} style={{ fontSize: "12px", color: "var(--text-secondary)", display: "flex", gap: "6px", padding: "3px 0" }}>
                        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>·</span>
                        <span>{s.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Footer controls */}
          {formError && (
            <p style={{ fontSize: "12.5px", color: "var(--danger)", fontWeight: "700", textAlign: "center", padding: "8px 12px", background: "rgba(248,113,113,0.08)", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger)" }}>
              {formError}
            </p>
          )}
          <div className="modal-footer" style={{ padding: "0", marginTop: "8px" }}>
            {saved ? (
              <div style={{ flex: 1, textAlign: "center", padding: "12px", background: "var(--success)", borderRadius: "var(--radius-sm)", color: "#fff", fontWeight: "700", fontSize: "14px" }}>
                {isEditMode ? "✓ Saved!" : "✓ Task added!"}
              </div>
            ) : (
              <>
                <button type="button" className="btn btn-cancel" onClick={onClose} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn" data-testid="add-task-submit" style={{ flex: 1 }}>
                  {isEditMode ? "Save" : "Add Task"}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
