import React, { useState, useEffect, useRef } from "react";

export default function CoachTab({ payload, savePayload }) {
  const { tasks = [], config = {} } = payload;

  // Ritual State
  const [ritualActive, setRitualActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [ritualDone, setRitualDone] = useState(false);
  const timerRef = useRef(null);

  // AI Horizon Review State
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState("");
  const [apiKey, setApiKey] = useState(localStorage.getItem("loci_gemini_key") || "");

  // Update apiKey locally on tab mount/focus
  useEffect(() => {
    setApiKey(localStorage.getItem("loci_gemini_key") || "");
  }, []);

  const steps = [
    { name: "Hydrate — drink water", duration: 60, emoji: "💧" },
    { name: "Stand & stretch", duration: 90, emoji: "‍♀️" },
    { name: "Box breathing 4-4-4", duration: 90, emoji: "‍♂️" },
    { name: "Set one intention", duration: 60, emoji: "🎯" },
    { name: "Scan your task list", duration: 30, emoji: "🔍" },
    { name: "Start the first action immediately", duration: 30, emoji: "🚀" }
  ];

  // Ritual timer ticking logic
  useEffect(() => {
    if (ritualActive && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            // Move to next step automatically
            handleStepNext();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [ritualActive, currentStepIndex, timeLeft]);

  // Handle Step Advancement
  const handleStepNext = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (currentStepIndex < steps.length - 1) {
      const nextIndex = currentStepIndex + 1;
      setCurrentStepIndex(nextIndex);
      setTimeLeft(steps[nextIndex].duration);
    } else {
      setRitualActive(false);
      setRitualDone(true);
    }
  };

  // Safe useEffect triggering savePayload to avoid stale closures
  useEffect(() => {
    if (ritualDone) {
      const newXp = (config.totalXp || 0) + 80;
      savePayload({
        ...payload,
        config: {
          ...config,
          totalXp: newXp
        }
      });
      setRitualDone(false);
      alert("Morning Calibration complete! +80 XP granted. Have a highly focused day!");
    }
  }, [ritualDone, payload, savePayload, config]);

  const startRitual = () => {
    setRitualActive(true);
    setCurrentStepIndex(0);
    setTimeLeft(steps[0].duration);
    setRitualDone(false);
  };

  const abortRitual = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRitualActive(false);
    setCurrentStepIndex(0);
    setTimeLeft(0);
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // Bad Day Reset Action
  const handleBadDayReset = () => {
    const confirmReset = window.confirm(
      "Bad Day Reset: This will park all incomplete tasks (P1, P2, and P3) out of your Today view so you can clear cognitive overload. Your P4 low energy tasks remain untouched. Proceed?"
    );
    if (confirmReset) {
      const updatedTasks = tasks.map((task) => {
        if (!task.isCompleted && !task.isDeleted && (task.priority === "P1" || task.priority === "P2" || task.priority === "P3")) {
          return { ...task, isParked: true, isNowFocus: false };
        }
        return task;
      });
      savePayload({ ...payload, tasks: updatedTasks });
      alert("All P1-P3 tasks have been safely parked. Start fresh and focus on P4 or add a tiny action step!");
    }
  };

  // Stuck Rescue Action
  const handleStuckRescue = () => {
    alert("Take 3 deep breaths. Pick the smallest possible physical action. Do it for 2 minutes only.");
  };

  // Run AI Horizon Review
  const runAiReview = async () => {
    if (!apiKey) return;
    setReviewLoading(true);
    setReviewResult("");

    const activeTasks = tasks.filter((t) => !t.isCompleted && !t.isDeleted);
    const taskSummary = activeTasks
      .map((t) => `- [${t.priority}] ${t.title} (Horizon: ${t.horizonLevel || "today"})`)
      .join("\n");

    const prompt = `You are ${config.mentorName || "Yoda"}, speaking as an ADHD productivity mentor to ${config.userName || "User"}. Their active ADHD challenge is: ${config.challengeType || "general focus"}.
Here is their list of active commitments:
${taskSummary || "No active tasks found."}

Please group these tasks by their horizon level (today, week, month, etc.) with priority. Recommend exactly 3 tasks to pull into "today" with a brief, supportive, direct 1-sentence ADHD reasoning for each choice. Keep your entire response under 200 words, direct, and actionable.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        setReviewResult(text);
      } else {
        setReviewResult("Could not parse a recommendation. Check API key status or task contents.");
      }
    } catch (err) {
      setReviewResult(`Failed to load AI review: ${err.message}`);
    } finally {
      setReviewLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <h2 className="section-title">🎯 ADHD Coaching Center</h2>

      {/* 1. Today's Intention Banner */}
      <section className="card" style={{ borderLeft: "4px solid var(--accent)", background: "linear-gradient(135deg, #FEF3E8, #FDECEA)", display: "flex", flexDirection: "column", gap: "6px" }}>
        <span className="form-label" style={{ color: "var(--accent-dark)", fontSize: "10px", fontWeight: "800" }}>Today's Intention</span>
        <p style={{ fontStyle: "italic", fontSize: "14.5px", fontWeight: "600", color: "var(--text-primary)", lineHeight: "1.4" }}>
          "{config.intentionMessage || "Focus on what matters most today."}"
        </p>
      </section>

      {/* 2. Low Energy Mode Toggle */}
      <section className="card toggle-row">
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
          <span className="challenge-title" style={{ fontSize: "14px", fontWeight: "700" }}>🔋 Low Energy Mode</span>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.3" }}>
            When ON, only P4 easy tasks show in your Today feed.
          </p>
        </div>
        <label className="pill-toggle">
          <input 
            type="checkbox" 
            checked={!!config.isLowEnergyMode} 
            onChange={() => {
              savePayload({
                ...payload,
                config: {
                  ...config,
                  isLowEnergyMode: !config.isLowEnergyMode
                }
              });
            }} 
          />
          <span className="pill-slider"></span>
        </label>
      </section>

      {/* 3. Morning Ritual Starter Kit */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span className="challenge-title" style={{ fontSize: "15px", fontWeight: "700" }}>🌅 Morning Calibration Ritual</span>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.3" }}>
            A 6-step checklist to warm up your brain, crush inertia, and establish visual task clarity.
          </p>
        </div>

        {!ritualActive ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "var(--bg-primary)", padding: "12px", borderRadius: "8px", border: "1px solid var(--border)" }}>
              {steps.map((s, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                  <span>{s.emoji} {idx + 1}. {s.name}</span>
                  <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>{s.duration}s</span>
                </div>
              ))}
            </div>
            <button className="btn" onClick={startRitual} style={{ width: "100%" }}>
              Begin Morning Calibration (+80 XP)
            </button>
          </div>
        ) : (
          <div className="ritual-step-card">
            <span className="form-label" style={{ fontSize: "10px", fontWeight: "800", color: "var(--accent)" }}>
              Step {currentStepIndex + 1} of 6
            </span>
            <h3 style={{ fontSize: "18px", fontWeight: "700" }}>
              {steps[currentStepIndex].emoji} {steps[currentStepIndex].name}
            </h3>
            <div className="ritual-timer-display">{formatTime(timeLeft)}</div>
            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button 
                className="btn" 
                onClick={handleSkip} 
                style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              >
                Skip Step
              </button>
              <button 
                className="btn" 
                onClick={abortRitual} 
                style={{ flex: 1, background: "var(--danger)", color: "#fff" }}
              >
                Abort
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 4. Stuck Rescue & Bad Day Reset */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <button 
          className="btn" 
          onClick={handleStuckRescue} 
          style={{ background: "var(--bg-card)", color: "var(--accent)", border: "1.5px solid var(--accent)", fontSize: "13px", padding: "14px 10px" }}
        >
          🚨 stuck? rescue me
        </button>
        <button 
          className="btn" 
          onClick={handleBadDayReset} 
          style={{ background: "var(--bg-card)", color: "var(--danger)", border: "1.5px solid var(--border)", fontSize: "13px", padding: "14px 10px" }}
        >
          🌪️ bad day reset
        </button>
      </section>

      {/* 5. AI Weekly Horizon Review */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span className="challenge-title" style={{ fontSize: "15px", fontWeight: "700" }}>🤖 AI Weekly Horizon Review</span>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.3" }}>
            Let your AI mentor analyze all long-term planning piles and recommend which ones to capture today.
          </p>
        </div>

        {!apiKey ? (
          <div style={{ background: "rgba(217, 119, 87, 0.06)", border: "1px solid var(--accent-light)", padding: "12px", borderRadius: "8px", fontSize: "12px", color: "var(--accent-dark)", textAlign: "center" }}>
            Add your Gemini API key in the Mentor tab to enable AI features.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button className="btn" onClick={runAiReview} disabled={reviewLoading} style={{ width: "100%" }}>
              {reviewLoading ? "Analyzing Horizons..." : "Run AI Review"}
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
                  maxHeight: "250px", 
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
