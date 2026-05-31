import React, { useState } from "react";

const TOUR_SLIDES = [
  {
    icon: "🎯",
    tab: "Today",
    color: "#3b82f6",
    title: "Today — your daily task list",
    desc: "Add what you want to get done today. Pin the most important one to start a focus timer. Complete tasks one by one."
  },
  {
    icon: "🗺",
    tab: "Roadmap",
    color: "#10b981",
    title: "Roadmap — plan ahead",
    desc: "Add tasks for this week, this month, or long-term. Drag them to Today when you're ready to act on them."
  },
  {
    icon: "🧠",
    tab: "Mind Box",
    color: "#8b5cf6",
    title: "Mind Box — tools & resets",
    desc: "Track your streaks, do the morning ritual, brain-dump anything on your mind, or hit the rescue button when you're overwhelmed."
  },
  {
    icon: "🤖",
    tab: "Coach",
    color: "#ec4899",
    title: "Coach — your AI partner",
    desc: "Get unstuck with AI-powered coaching personalised to your focus style. Ask anything."
  }
];

export default function OnboardingWizard({ payload, savePayload }) {
  const { config = {} } = payload;
  const [currentStep, setCurrentStep] = useState(1);
  const [userName, setUserName] = useState("");
  const [selectedChallenge, setSelectedChallenge] = useState("starting");
  const [selectedMentor, setSelectedMentor] = useState("Mark");
  const [customMentor, setCustomMentor] = useState("");
  const [tourSlide, setTourSlide] = useState(0);

  const challenges = [
    { key: "starting", label: "Starting Inertia (Getting started on tasks)" },
    { key: "focusing", label: "Focus & Distractions (Staying focused once)" },
    { key: "execution", label: "Consistent Execution (Following through)" },
    { key: "tracking", label: "Calendar Overload (Keeping track of time)" }
  ];

  const mentors = ["Mark", "Steve", "Dianna", "Jenny"];
  const effectiveMentor = customMentor.trim() || selectedMentor;

  const handleFinish = () => {
    savePayload({
      ...payload,
      config: {
        ...config,
        userName: userName.trim(),
        mentorName: effectiveMentor,
        challengeType: selectedChallenge,
        isOnboardingCompleted: true,
        pomodoroDurationMinutes: config.pomodoroDurationMinutes || 25,
        reminderNagIntervalMinutes: config.reminderNagIntervalMinutes || 15,
        eveningGuardWindowActive: config.eveningGuardWindowActive !== undefined ? config.eveningGuardWindowActive : true,
        totalXp: (Number(config.totalXp) > 0) ? Number(config.totalXp) : 150,
        lastUpdated: Date.now()
      }
    });
  };

  const totalSteps = 5;

  return (
    <div className="signin-overlay" style={{ background: "rgba(26, 25, 21, 0.65)", backdropFilter: "blur(8px)" }}>
      <div className="signin-card card" style={{ maxWidth: "440px", padding: "30px 24px" }}>

        {/* Progress bar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
          <div className="progress-track" style={{ height: "6px", marginBottom: "0" }}>
            <div className="progress-bar" style={{ width: `${(currentStep / totalSteps) * 100}%` }} />
          </div>
          <span style={{ fontSize: "11px", fontWeight: "800", color: "var(--accent)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Step {currentStep} of {totalSteps}
          </span>
        </div>

        {/* Step 1 — name */}
        {currentStep === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
            <span className="signin-emoji" style={{ fontSize: "40px" }}>🧠</span>
            <h2 style={{ fontSize: "20px", fontWeight: "800" }}>Welcome to Loci Focus</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.5" }}>
              A mindful workspace for focus-driven people.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="onboard-name-input">What should Loci call you?</label>
              <input
                id="onboard-name-input"
                type="text"
                className="text-input"
                placeholder="Your name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && userName.trim()) { e.preventDefault(); setCurrentStep(2); } }}
                required
                autoFocus
              />
            </div>
            <button className="btn" onClick={() => setCurrentStep(2)} disabled={!userName.trim()} style={{ width: "100%" }}>
              Continue
            </button>
          </div>
        )}

        {/* Step 2 — challenge */}
        {currentStep === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
            <h2 style={{ fontSize: "19px", fontWeight: "800", textAlign: "center" }}>What's your biggest focus challenge?</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
              {challenges.map((c) => (
                <div
                  key={c.key}
                  className={`challenge-option ${selectedChallenge === c.key ? "selected" : ""}`}
                  onClick={() => setSelectedChallenge(c.key)}
                  style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}
                >
                  <input
                    type="radio"
                    name="onboard-challenge"
                    checked={selectedChallenge === c.key}
                    onChange={() => setSelectedChallenge(c.key)}
                    style={{ cursor: "pointer" }}
                  />
                  <span className="challenge-title" style={{ fontSize: "12.5px", fontWeight: "600", textAlign: "left" }}>
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "8px", width: "100%" }}>
              <button className="btn" onClick={() => setCurrentStep(1)} style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>Back</button>
              <button className="btn" onClick={() => setCurrentStep(3)} style={{ flex: 1 }}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 3 — AI coach name */}
        {currentStep === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
            <h2 style={{ fontSize: "19px", fontWeight: "800", textAlign: "center" }}>Name your AI coach</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "12.5px", textAlign: "center", marginTop: "-8px" }}>
              Pick one or type your own below.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
              {mentors.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => { setSelectedMentor(name); setCustomMentor(""); }}
                  style={{
                    padding: "10px 20px", borderRadius: "24px", fontSize: "14px", fontWeight: "700",
                    cursor: "pointer", transition: "all 0.15s",
                    background: selectedMentor === name && !customMentor ? "var(--accent)" : "var(--bg-secondary)",
                    color: selectedMentor === name && !customMentor ? "var(--btn-text, #fff)" : "var(--text-secondary)",
                    border: selectedMentor === name && !customMentor ? "2px solid var(--accent)" : "1.5px solid var(--border)"
                  }}
                >{name}</button>
              ))}
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Or type a custom name</label>
              <input
                type="text"
                className="text-input"
                placeholder="e.g. Alex, Mentor, Seneca…"
                value={customMentor}
                onChange={e => setCustomMentor(e.target.value)}
              />
            </div>
            <p style={{ fontSize: "12px", color: "var(--accent)", fontWeight: "700", textAlign: "center" }}>
              Your coach will be: <strong>{effectiveMentor}</strong>
            </p>
            <div style={{ display: "flex", gap: "10px", marginTop: "4px", width: "100%" }}>
              <button className="btn" onClick={() => setCurrentStep(2)} style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>Back</button>
              <button className="btn" onClick={() => setCurrentStep(4)} style={{ flex: 1 }}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 4 — summary */}
        {currentStep === 4 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px", width: "100%" }}>
            <span className="signin-emoji" style={{ fontSize: "40px" }}>🎉</span>
            <h2 style={{ fontSize: "20px", fontWeight: "800" }}>You're all set, {userName}!</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.5" }}>
              Your personalized focus workspace is ready. Quick tour before you dive in?
            </p>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", width: "100%", fontSize: "12.5px", textAlign: "left" }}>
              {[
                { label: "Name", value: userName },
                { label: "Focus Challenge", value: selectedChallenge === "starting" ? "Getting started" : selectedChallenge === "focusing" ? "Staying focused" : selectedChallenge === "execution" ? "Following through" : "Tracking time" },
                { label: "AI Coach", value: effectiveMentor }
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>{label}:</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: "700" }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "4px", width: "100%" }}>
              <button className="btn" onClick={() => setCurrentStep(3)} style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>Back</button>
              <button className="btn" onClick={() => { setTourSlide(0); setCurrentStep(5); }} style={{ flex: 1.5 }}>
                Quick tour →
              </button>
            </div>
            <button
              onClick={handleFinish}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "var(--text-muted)", textDecoration: "underline", alignSelf: "center" }}
            >
              Skip tour, start now
            </button>
          </div>
        )}

        {/* Step 5 — feature tour carousel */}
        {currentStep === 5 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
            <div style={{
              background: "var(--bg-secondary)", border: `2px solid ${TOUR_SLIDES[tourSlide].color}22`,
              borderRadius: "16px", padding: "24px 20px", textAlign: "center",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "12px",
              minHeight: "200px", justifyContent: "center"
            }}>
              <span style={{ fontSize: "48px", lineHeight: 1 }}>{TOUR_SLIDES[tourSlide].icon}</span>
              <span style={{
                fontSize: "10px", fontWeight: "800", letterSpacing: "0.1em", textTransform: "uppercase",
                color: TOUR_SLIDES[tourSlide].color, background: `${TOUR_SLIDES[tourSlide].color}22`,
                padding: "3px 10px", borderRadius: "20px"
              }}>
                {TOUR_SLIDES[tourSlide].tab}
              </span>
              <h3 style={{ fontSize: "16px", fontWeight: "800", color: "var(--text-primary)", margin: 0 }}>
                {TOUR_SLIDES[tourSlide].title}
              </h3>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
                {TOUR_SLIDES[tourSlide].desc}
              </p>
            </div>

            {/* Dot indicators */}
            <div style={{ display: "flex", justifyContent: "center", gap: "6px" }}>
              {TOUR_SLIDES.map((_, i) => (
                <div
                  key={i}
                  onClick={() => setTourSlide(i)}
                  style={{
                    width: i === tourSlide ? "20px" : "8px", height: "8px",
                    borderRadius: "4px", cursor: "pointer", transition: "all 0.2s",
                    background: i === tourSlide ? TOUR_SLIDES[tourSlide].color : "var(--border)"
                  }}
                />
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              {tourSlide > 0 ? (
                <button className="btn" onClick={() => setTourSlide(t => t - 1)} style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                  ← Back
                </button>
              ) : (
                <button className="btn" onClick={() => setCurrentStep(4)} style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                  ← Back
                </button>
              )}
              {tourSlide < TOUR_SLIDES.length - 1 ? (
                <button className="btn" onClick={() => setTourSlide(t => t + 1)} style={{ flex: 1 }}>
                  Next →
                </button>
              ) : (
                <button className="btn" onClick={handleFinish} style={{ flex: 1 }}>
                  Let's go! 🚀
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
