import React, { useState } from "react";

export default function OnboardingWizard({ payload, savePayload }) {
  const { config = {} } = payload;
  const [currentStep, setCurrentStep] = useState(1);
  const [userName, setUserName] = useState("");
  const [selectedChallenge, setSelectedChallenge] = useState("starting");
  const [selectedMentor, setSelectedMentor] = useState("Mark");
  const [customMentor, setCustomMentor] = useState("");

  const challenges = [
    { key: "starting", label: "Starting Inertia (Getting started on tasks)" },
    { key: "focusing", label: "Focus & Distractions (Staying focused once)" },
    { key: "execution", label: "Consistent Execution (Following through)" },
    { key: "tracking", label: "Calendar Overload (Keeping track of time)" }
  ];

  const mentors = ["Mark", "Steve", "Dianna", "Jenny"];
  const effectiveMentor = customMentor.trim() || selectedMentor;

  const handleFinish = () => {
    const updatedConfig = {
      ...config,
      userName: userName.trim(),
      mentorName: effectiveMentor,
      challengeType: selectedChallenge,
      isOnboardingCompleted: true,
      pomodoroDurationMinutes: config.pomodoroDurationMinutes || 25,
      reminderNagIntervalMinutes: config.reminderNagIntervalMinutes || 15,
      eveningGuardWindowActive: config.eveningGuardWindowActive !== undefined ? config.eveningGuardWindowActive : true,
      // Step 12: Preserve existing XP — only set 150 if truly a fresh account (XP is 0 or missing)
      totalXp: (Number(config.totalXp) > 0) ? Number(config.totalXp) : 150,
      lastUpdated: Date.now()
    };

    savePayload({
      ...payload,
      config: updatedConfig
    });
  };

  return (
    <div className="signin-overlay" style={{ background: "rgba(26, 25, 21, 0.65)", backdropFilter: "blur(8px)" }}>
      <div className="signin-card card" style={{ maxWidth: "440px", padding: "30px 24px" }}>
        
        {/* Progress bar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
          <div className="progress-track" style={{ height: "6px", marginBottom: "0" }}>
            <div className="progress-bar" style={{ width: `${(currentStep / 4) * 100}%` }}></div>
          </div>
          <span style={{ fontSize: "11px", fontWeight: "800", color: "var(--accent)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Step {currentStep} of 4
          </span>
        </div>

        {currentStep === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
            <span className="signin-emoji" style={{ fontSize: "40px" }}>🧠</span>
            <h2 style={{ fontSize: "20px", fontWeight: "800" }}>Welcome to Loci Focus</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.5" }}>
              A premium, mindful workspace for focus-driven people.
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
            <button 
              className="btn" 
              onClick={() => setCurrentStep(2)} 
              disabled={!userName.trim()}
              style={{ width: "100%" }}
            >
              Continue
            </button>
          </div>
        )}

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
              <button className="btn" onClick={() => setCurrentStep(1)} style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                Back
              </button>
              <button className="btn" onClick={() => setCurrentStep(3)} style={{ flex: 1 }}>
                Continue
              </button>
            </div>
          </div>
        )}

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
              <button className="btn" onClick={() => setCurrentStep(2)} style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                Back
              </button>
              <button className="btn" onClick={() => setCurrentStep(4)} style={{ flex: 1 }}>
                Continue
              </button>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px", width: "100%" }}>
            <span className="signin-emoji" style={{ fontSize: "40px" }}>🎉</span>
            <h2 style={{ fontSize: "20px", fontWeight: "800" }}>You're all set, {userName}!</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.5" }}>
              Your personalized focus workspace is calibrated and ready.
            </p>

            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", width: "100%", fontSize: "12.5px", textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>Name:</span>
                <span style={{ color: "var(--text-primary)", fontWeight: "700" }}>{userName}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>Focus Challenge:</span>
                <span style={{ color: "var(--text-primary)", fontWeight: "700" }}>
                  {selectedChallenge === "starting" ? "Getting started" : selectedChallenge === "focusing" ? "Staying focused" : selectedChallenge === "execution" ? "Following through" : "Tracking time"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>AI Coach:</span>
                <span style={{ color: "var(--text-primary)", fontWeight: "700" }}>{effectiveMentor}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "4px", width: "100%" }}>
              <button className="btn" onClick={() => setCurrentStep(3)} style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                Back
              </button>
              <button className="btn" onClick={handleFinish} style={{ flex: 1.5 }}>
                Start Focus Journey
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
