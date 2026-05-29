import React, { useState } from "react";

export default function AddTaskDialog({ email, payload, savePayload, defaultHorizon, onClose }) {
  const [title, setTitle] = useState("");
  const [concreteStep, setConcreteStep] = useState("");
  const [horizonLevel, setHorizonLevel] = useState(defaultHorizon || "today");
  const [saved, setSaved] = useState(false);
  const [priority, setPriority] = useState("P3");
  const [category, setCategory] = useState("Personal");
  const [estimateMinutes, setEstimateMinutes] = useState(25);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const apiKey = localStorage.getItem("loci_gemini_key") || import.meta.env.VITE_GEMINI_KEY || "";

  const handleAiSuggest = async () => {
    if (!title.trim()) { setAiError("Type a rough task idea first, then tap Ask AI."); return; }
    if (!apiKey) { setAiError("No AI key available."); return; }
    setAiLoading(true);
    setAiError("");
    const config = payload.config || {};
    const challengeLabel =
      config.challengeType === "starting" ? "Overcoming Inertia" :
      config.challengeType === "focusing" ? "Protecting Focus" : "Action over Planning";
    const prompt = `You are an ADHD productivity coach. The user typed this rough task idea: "${title.trim()}".

Improve it into a clear, actionable task. Respond with ONLY valid JSON (no markdown, no code block), exactly:
{"title":"<clear task title, max 60 chars>","microStep":"<the single smallest first physical action, max 60 chars>","priority":"P2","estimateMinutes":25}

Rules:
- priority: P1 (urgent+important), P2 (important), P3 (normal), P4 (easy quick-win)
- estimateMinutes: one of 15, 25, 45, 60
- User's challenge: ${challengeLabel}
- Keep title and microStep concise and concrete`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.title) setTitle(parsed.title);
      if (parsed.microStep) setConcreteStep(parsed.microStep);
      if (["P1","P2","P3","P4"].includes(parsed.priority)) setPriority(parsed.priority);
      if ([15,25,45,60].includes(Number(parsed.estimateMinutes))) setEstimateMinutes(Number(parsed.estimateMinutes));
    } catch (err) {
      setAiError("AI suggestion failed — fill in manually.");
    } finally {
      setAiLoading(false);
    }
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
  const estimates = [15, 25, 45, 60];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    // Evening Guard window block logic
    const now = new Date();
    const hour = now.getHours();
    if (payload.config?.eveningGuardWindowActive && hour >= 20) {
      alert("Evening Guard is ACTIVE: To protect your evening recovery and sleep, new tasks cannot be added after 8:00 PM. Go rest! 🌙");
      return;
    }

    // Calculate orderIndex as size of active level tasks
    const currentLevelTasks = (payload.tasks || []).filter(
      (t) => t.horizonLevel === horizonLevel && !t.isDeleted
    );
    const orderIndex = currentLevelTasks.length;

    const freshTask = {
      id: Date.now(),
      userId: email,
      uuid: crypto.randomUUID(),
      title: title.trim(),
      concreteStep: concreteStep.trim() || "Do first tiny step",
      horizonLevel,
      priority,
      category,
      timeEstimateMinutes: Number(estimateMinutes),
      deadlineTimestamp: null,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      orderIndex,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: Date.now()
    };

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
          <h2 className="modal-title">Add Task</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Title + Ask AI */}
          <div className="form-group">
            <label className="form-label">WHAT DO YOU WANT TO DO? (REQUIRED)</label>
            <input
              type="text"
              className="text-input"
              placeholder="e.g. Write cover letter draft"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
            {apiKey && (
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
          </div>

          {/* Concrete Step */}
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

          {/* Horizon Level */}
          <div className="form-group">
            <label className="form-label">STRATEGIC PLANNING HORIZON</label>
            <div className="btn-group">
              {horizons.map((h) => (
                <button
                  key={h.key}
                  type="button"
                  className={`selector-btn ${horizonLevel === h.key ? "selected" : ""}`}
                  onClick={() => setHorizonLevel(h.key)}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className="form-group">
            <label className="form-label">ADHD TASK PRIORITY INDEX</label>
            <div className="btn-group">
              {priorities.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`priority-selector-btn ${priority === p ? `selected ${p.toLowerCase()}` : ""}`}
                  onClick={() => setPriority(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div className="form-group">
            <label className="form-label">LIFE HORIZON CATEGORY</label>
            <div className="btn-group">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`selector-btn ${category === c ? "selected" : ""}`}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Time Estimate */}
          <div className="form-group">
            <label className="form-label">DOPAMINE POMODORO ESTIMATE (MINUTES)</label>
            <div className="btn-group">
              {estimates.map((est) => (
                <button
                  key={est}
                  type="button"
                  className={`selector-btn ${estimateMinutes === est ? "selected" : ""}`}
                  onClick={() => setEstimateMinutes(est)}
                >
                  {est}m
                </button>
              ))}
            </div>
          </div>

          {/* Footer controls */}
          <div className="modal-footer" style={{ padding: "0", marginTop: "8px" }}>
            {saved ? (
              <div style={{ flex: 1, textAlign: "center", padding: "12px", background: "var(--success)", borderRadius: "var(--radius-sm)", color: "#fff", fontWeight: "700", fontSize: "14px" }}>
                ✓ Task added!
              </div>
            ) : (
              <>
                <button type="button" className="btn btn-cancel" onClick={onClose} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn" style={{ flex: 1 }}>
                  Add Task
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
