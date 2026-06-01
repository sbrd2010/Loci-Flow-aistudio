import React, { useState } from "react";

const TOUR_SLIDES = [
  {
    icon: "🎯",
    tab: "Today",
    color: "#3b82f6",
    title: "Today — your one-screen execution hub",
    desc: "Add what matters today, pin the most important task to start a focus timer, and work through your list one step at a time. This is where plans become action."
  },
  {
    icon: "🗺",
    tab: "Roadmap",
    color: "#10b981",
    title: "Roadmap — everything in its horizon",
    desc: "Place tasks where they actually belong — this week, this month, this quarter. Pull them forward to Today when you're ready to act. No more cluttered lists."
  },
  {
    icon: "🧠",
    tab: "Mind Box",
    color: "#8b5cf6",
    title: "Mind Box — capture, organise, reset",
    desc: "Dump anything on your mind, then use AI to sort your thoughts into a structured plan. Use the Morning Ritual to start well. Tap Get Unstuck when you're stuck."
  },
  {
    icon: "🤖",
    tab: "Coach",
    color: "#ec4899",
    title: "Coach — your personal AI partner",
    desc: "Get a daily briefing, ask for help when you're stuck, and receive coaching tailored to your exact focus challenge. Calm, practical, no hype."
  }
];

export default function OnboardingWizard({ payload, savePayload }) {
  const { config = {} } = payload;
  const [currentStep, setCurrentStep] = useState(1);
  const [userName, setUserName] = useState("");
  const [selectedChallenge, setSelectedChallenge] = useState("overplanner");
  const [selectedMentor, setSelectedMentor] = useState("Mark");
  const [customMentor, setCustomMentor] = useState("");
  const [tourSlide, setTourSlide] = useState(0);

  const challenges = [
    {
      key: "overplanner",
      icon: "🎯",
      label: "Help me decide what to work on",
      sub: "Too many options — I need clarity on what actually matters right now"
    },
    {
      key: "initiation",
      icon: "🧊",
      label: "Help me just start",
      sub: "I know what to do — starting is the hard part"
    },
    {
      key: "momentum",
      icon: "⚡",
      label: "Keep me moving forward",
      sub: "I work well once I'm going — I just need momentum"
    },
    {
      key: "overwhelmed",
      icon: "🌱",
      label: "Help me recover and catch up",
      sub: "I've fallen behind and need to reset without losing everything"
    }
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
    <div className="signin-overlay" style={{ background: "rgba(26, 25, 21, 0.65)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
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
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.6" }}>
              Your calm execution layer — for ambitious people who know what they want but struggle to act on it consistently.
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
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
            <div>
              <h2 style={{ fontSize: "19px", fontWeight: "800", textAlign: "center" }}>What do you need most from Loci?</h2>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center", marginTop: "4px" }}>Your coaching and AI suggestions will be tailored to this.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
              {challenges.map((c) => {
                const isSelected = selectedChallenge === c.key;
                return (
                  <div
                    key={c.key}
                    onClick={() => setSelectedChallenge(c.key)}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      padding: "12px 14px", borderRadius: "12px", cursor: "pointer",
                      background: isSelected ? "var(--accent-ring, rgba(99,102,241,0.08))" : "var(--bg-secondary)",
                      border: `1.5px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                      transition: "all 0.15s"
                    }}
                  >
                    <span style={{ fontSize: "22px", flexShrink: 0 }}>{c.icon}</span>
                    <div style={{ flex: 1, textAlign: "left" }}>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: isSelected ? "var(--accent)" : "var(--text-primary)" }}>{c.label}</div>
                      <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginTop: "2px", lineHeight: "1.4" }}>{c.sub}</div>
                    </div>
                    <div style={{
                      width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0,
                      border: isSelected ? "none" : "2px solid var(--border)",
                      background: isSelected ? "var(--accent)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                      {isSelected && <span style={{ color: "#fff", fontSize: "10px", fontWeight: "900" }}>✓</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
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
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.6" }}>
              Your workspace is ready. A quick tour will show you the four tabs — takes about 90 seconds.
            </p>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", width: "100%", fontSize: "12.5px", textAlign: "left" }}>
              {[
                { label: "Name", value: userName },
                { label: "Profile", value: challenges.find(c => c.key === selectedChallenge)?.label || selectedChallenge },
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
                  Start my first session →
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
