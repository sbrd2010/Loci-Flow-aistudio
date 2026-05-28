import React, { useState } from "react";

export default function AddTaskDialog({ email, payload, savePayload, defaultHorizon, onClose }) {
  const [title, setTitle] = useState("");
  const [concreteStep, setConcreteStep] = useState("");
  const [horizonLevel, setHorizonLevel] = useState(defaultHorizon || "today");
  const [priority, setPriority] = useState("P3");
  const [category, setCategory] = useState("Personal");
  const [estimateMinutes, setEstimateMinutes] = useState(25);

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

    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Pin Strategic Path Action</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Title */}
          <div className="form-group">
            <label className="form-label">WHAT COMMIT TO FOCUS ON? (REQUIRED)</label>
            <input
              type="text"
              className="text-input"
              placeholder="e.g. Write cover letter draft"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          {/* Concrete Step */}
          <div className="form-group">
            <label className="form-label">MICRO ACTION (FIRST TINY ACTION STEP)</label>
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
            <button type="button" className="btn btn-cancel" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button type="submit" className="btn" style={{ flex: 1 }}>
              Add Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
