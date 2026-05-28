import React, { useState, useEffect, useRef } from "react";

export default function CoachTab({ payload, savePayload }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  // Hybrid API key resolution
  const DEFAULT_GEMINI_KEY = ""; // Baked-in fallback key placeholder
  const apiKey = localStorage.getItem("loci_gemini_key") || DEFAULT_GEMINI_KEY;

  // Ritual state variables exactly as specified
  const [ritualActive, setRitualActive] = useState(false);
  const [ritualStepIndex, setRitualStepIndex] = useState(-1); // -1 = not started
  const [ritualSecondsLeft, setRitualSecondsLeft] = useState(0);
  const [ritualMaxSeconds, setRitualMaxSeconds] = useState(0);
  const [ritualDone, setRitualDone] = useState(false);
  const timerIntervalRef = useRef(null);

  // AI Weekly Review State
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState("");

  // Morning ritual steps exactly as specified
  const ritualSteps = [
    { name: "Hydrate: Drink water", seconds: 60 },
    { name: "Stand & Stretch (touch toes)", seconds: 90 },
    { name: "Box Breathing (4-4-4 cycle)", seconds: 90 },
    { name: "Write ONE intention", seconds: 60 },
    { name: "Scan today's task list", seconds: 30 },
    { name: "Pick first action NOW", seconds: 30 }
  ];

  // Timer countdown logic
  useEffect(() => {
    if (ritualActive && ritualStepIndex >= 0 && ritualSecondsLeft > 0) {
      timerIntervalRef.current = setInterval(() => {
        setRitualSecondsLeft((prev) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [ritualActive, ritualStepIndex, ritualSecondsLeft > 0]);

  // Handle Morning Calibration Timer Advancements Side-Effect
  useEffect(() => {
    if (ritualActive && ritualStepIndex >= 0 && ritualSecondsLeft === 0) {
      handleAdvanceStep();
    }
  }, [ritualSecondsLeft, ritualActive, ritualStepIndex]);

  // Handle auto-advancing or manual skip
  const handleAdvanceStep = () => {
    if (ritualStepIndex < ritualSteps.length - 1) {
      const nextIndex = ritualStepIndex + 1;
      setRitualStepIndex(nextIndex);
      setRitualSecondsLeft(ritualSteps[nextIndex].seconds);
      setRitualMaxSeconds(ritualSteps[nextIndex].seconds);
    } else {
      // Completed all steps!
      setRitualActive(false);
      setRitualStepIndex(-1);
      setRitualSecondsLeft(0);
      setRitualDone(true);
    }
  };

  // Safe useEffect to grant +80 XP to avoid stale closures with setInterval
  useEffect(() => {
    if (ritualDone) {
      const newXp = (config.totalXp || 0) + 80;
      const updated = { ...config, totalXp: newXp };
      savePayload({ ...payload, config: updated });
      setRitualDone(false);
      alert("Ritual complete! +80 XP 🎉");
    }
  }, [ritualDone, payload, savePayload, config]);

  const handleBeginRitual = () => {
    setRitualActive(true);
    setRitualStepIndex(0);
    setRitualSecondsLeft(ritualSteps[0].seconds);
    setRitualMaxSeconds(ritualSteps[0].seconds);
    setRitualDone(false);
  };

  const handleSkipStep = () => {
    handleAdvanceStep();
  };

  const handleAbortRitual = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    setRitualActive(false);
    setRitualStepIndex(-1);
    setRitualSecondsLeft(0);
    setRitualMaxSeconds(0);
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // Stuck Rescue Button Action
  const handleStuckRescue = () => {
    alert(
      "STUCK RESCUE:\n\n1. Take 3 deep breaths\n2. Pick the SMALLEST physical action\n3. Do it for 2 minutes only\n\nAction builds dopamine. Go."
    );
  };

  // Bad Day Reset Button Action
  const handleBadDayReset = () => {
    const updatedTasks = tasks.map((task) => {
      if (!task.isCompleted && !task.isDeleted && (task.priority === "P1" || task.priority === "P2" || task.priority === "P3")) {
        return { ...task, isParked: true, isNowFocus: false };
      }
      return task;
    });
    savePayload({ ...payload, tasks: updatedTasks });
    alert("Reset complete. P4 quick wins unlocked. Start small. 💪");
  };

  // AI Weekly Review Action
  const handleAiReview = async () => {
    if (!apiKey) return;
    setReviewLoading(true);
    setReviewResult("");

    const challengeTypeDesc =
      config.challengeType === "starting"
        ? "Overcoming Inertia"
        : config.challengeType === "focusing"
        ? "Protecting Focus Sessions"
        : "Action over Perfectionism";

    const prompt = `You are ${config.mentorName || 'a wise mentor'}. Review this person's task backlog and recommend 3 priority tasks to focus on TODAY.

User: ${config.userName || 'friend'}
Current Challenge: ${challengeTypeDesc}

BACKLOG (non-completed):
${tasks
  .filter(t => !t.isDeleted && !t.isCompleted)
  .map(t => `[${t.priority}] ${t.title} (${t.horizonLevel}) - est ${t.timeEstimateMinutes}min`)
  .join('\n')}

Give 3 specific task recommendations with brief reasoning. Be direct and motivating.`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
      setReviewResult(result);
    } catch (err) {
      setReviewResult(`Failed to run AI Horizon Review: ${err.message}`);
    } finally {
      setReviewLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 1. Intention Banner Section */}
      <section 
        className="card" 
        style={{ 
          background: "var(--accent)", 
          cursor: "pointer", 
          transition: "var(--transition)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          textAlign: "center"
        }}
        onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(0.95)"}
        onMouseLeave={(e) => e.currentTarget.style.filter = "none"}
      >
        <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.05em", color: "var(--btn-text, #ffffff)", opacity: 0.8 }}>
          TODAY'S INTENTION
        </span>
        <p style={{ fontSize: "16px", fontWeight: "700", color: "var(--btn-text, #ffffff)", lineHeight: "1.4" }}>
          "{config.intentionMessage || "Focus on what matters most today."}"
        </p>
      </section>

      {/* 2. Low Energy Mode Toggle Section */}
      <section className="card">
        <h3 className="challenge-title" style={{ fontSize: "15px", fontWeight: "700", marginBottom: "6px" }}>
          Dopamine & Energy Mode
        </h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.4" }}>
          When ON, only P4 easy quick-win tasks appear in your Today list. Perfect for executive dysfunction days.
        </p>
        <div className="toggle-row">
          <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-secondary)", letterSpacing: "0.02em" }}>
            {config.isLowEnergyMode ? "LOW ENERGY MODE ACTIVE" : "STANDARD FULL FOCUS ACTIVE"}
          </span>
          <input 
            type="checkbox" 
            className="pill-toggle"
            checked={!!config.isLowEnergyMode}
            onChange={() => {
              const updated = { ...config, isLowEnergyMode: !config.isLowEnergyMode };
              savePayload({ ...payload, config: updated });
            }}
          />
        </div>
      </section>

      {/* 3. Morning Ritual Starter Kit Section */}
      <section className="card">
        <h3 className="challenge-title" style={{ fontSize: "15px", fontWeight: "700", marginBottom: "4px" }}>
          Morning Ritual Calibration (7 minutes)
        </h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.4" }}>
          6 micro-habits to clear executive fog and build momentum. +80 XP on completion.
        </p>

        {!ritualActive ? (
          <button className="btn" onClick={handleBeginRitual} style={{ width: "100%" }}>
            Begin Morning Calibration (+80 XP)
          </button>
        ) : (
          <div className="ritual-step-card">
            <span style={{ fontSize: "10px", fontWeight: "800", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              STEP {ritualStepIndex + 1} of 6
            </span>
            <h4 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>
              {ritualSteps[ritualStepIndex].name}
            </h4>
            <div className="ritual-timer-display">
              {formatTime(ritualSecondsLeft)}
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button 
                className="btn" 
                onClick={handleSkipStep} 
                style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", padding: "10px" }}
              >
                Skip Step
              </button>
              <button 
                className="btn" 
                onClick={handleAbortRitual} 
                style={{ flex: 1, background: "var(--danger)", color: "#fff", padding: "10px" }}
              >
                Abort Ritual
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 4. Stuck Rescue + Bad Day Reset */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <button 
          className="btn" 
          onClick={handleStuckRescue} 
          style={{ background: "var(--bg-card)", color: "var(--accent)", border: "1.5px solid var(--accent)", fontSize: "12.5px", padding: "12px 6px" }}
        >
          🚨 Stuck? Rescue Me
        </button>
        <button 
          className="btn" 
          onClick={handleBadDayReset} 
          style={{ background: "var(--bg-card)", color: "var(--danger)", border: "1.5px solid var(--border)", fontSize: "12.5px", padding: "12px 6px" }}
        >
          🌪️ Bad Day Reset
        </button>
      </section>

      {/* 5. AI Weekly Horizon Review Section */}
      <section className="card">
        <h3 className="challenge-title" style={{ fontSize: "15px", fontWeight: "700", marginBottom: "4px" }}>
          AI Weekly Horizon Review
        </h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px", lineHeight: "1.4" }}>
          Your AI mentor scans your backlog and recommends 3 tasks to focus on today.
        </p>

        {!apiKey ? (
          <div style={{ background: "rgba(217, 119, 87, 0.06)", border: "1px solid var(--accent-light)", padding: "12px", borderRadius: "8px", fontSize: "12px", color: "var(--accent-dark)", textAlign: "center" }}>
            🔑 Add your Gemini API key in the Mentor tab to enable AI features.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button className="btn" onClick={handleAiReview} disabled={reviewLoading} style={{ width: "100%" }}>
              {reviewLoading ? "Running AI Review..." : "Run AI Review"}
            </button>

            {reviewResult && (
              <div 
                style={{ 
                  background: "var(--bg-secondary)", 
                  border: "1px solid var(--border)", 
                  borderRadius: "8px", 
                  padding: "12px", 
                  fontSize: "12.5px", 
                  lineHeight: "1.5", 
                  maxHeight: "200px", 
                  overflowY: "auto", 
                  whiteSpace: "pre-line",
                  color: "var(--text-primary)"
                }}
              >
                {reviewResult}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
