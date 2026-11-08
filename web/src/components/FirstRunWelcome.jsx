import React, { useState } from "react";
import "../styles/firstRun.css";

// #653: a new account's first two screens, replacing the old setup wizard.
// Both questions are optional; the coach's name waits for Settings. Saving
// here marks onboarding complete (as the wizard's last step did), so the app
// renders and the guide carries on inside it.
const NEEDS = [
  { key: "overplanner", label: "Help me decide what to work on" },
  { key: "initiation", label: "Help me just start" },
  { key: "momentum", label: "Keep me moving forward" },
  { key: "overwhelmed", label: "Help me recover and catch up" },
];

export default function FirstRunWelcome({ payload, savePayload, onDone }) {
  const config = payload.config || {};
  const [screen, setScreen] = useState("welcome");
  const [name, setName] = useState(config.userName || "");
  const [need, setNeed] = useState("");

  const finish = (guided, chosen) => {
    savePayload({
      ...payload,
      config: {
        ...config,
        userName: name.trim() || config.userName || "",
        ...(chosen ? { challengeType: chosen } : {}),
        isOnboardingCompleted: true,
        // The coach's name is asked once, when Coach is first opened.
        coachNamePending: true,
        pomodoroDurationMinutes: config.pomodoroDurationMinutes || 25,
        reminderNagIntervalMinutes: config.reminderNagIntervalMinutes || 15,
        eveningGuardWindowActive: config.eveningGuardWindowActive ?? false,
        lastUpdated: Date.now(),
      },
    });
    onDone(guided);
  };

  if (screen === "welcome") {
    return (
      <main className="frw" aria-labelledby="frw-title">
        <div className="frw-inner">
          <span className="frw-brand">Loci</span>
          <h1 id="frw-title" className="frw-title">A calmer way to get things done.</h1>
          <p className="frw-lead">Pick one thing, find the smallest first step, and start. A short look around comes after. It takes a few minutes.</p>
          <label className="frw-label" htmlFor="frw-name">What should we call you? <span className="frw-optional">(optional)</span></label>
          <input id="frw-name" className="frw-input" value={name} autoComplete="given-name" maxLength={80}
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") setScreen("question"); }} />
          <div className="frw-actions">
            <button type="button" className="frw-primary" onClick={() => setScreen("question")}>Let’s begin</button>
            <button type="button" className="frw-link" onClick={() => finish(false, "")}>Skip setup, show me the app</button>
          </div>
        </div>
      </main>
    );
  }

  const first = name.trim().split(/\s+/)[0];
  return (
    <main className="frw" aria-labelledby="frw-q">
      <div className="frw-inner">
        <span className="frw-kicker">ONE QUESTION · OPTIONAL</span>
        <h1 id="frw-q" className="frw-title frw-title-q">{first ? `${first}, what would help you most right now?` : "What would help you most right now?"}</h1>
        <div className="frw-options" role="group" aria-label="What would help you most">
          {NEEDS.map(n => (
            <button key={n.key} type="button" className={`frw-option${need === n.key ? " is-on" : ""}`} aria-pressed={need === n.key}
              onClick={() => setNeed(v => (v === n.key ? "" : n.key))}>{n.label}</button>
          ))}
        </div>
        {need && <p className="frw-echo" role="status">Got it. Coach will start from there. You can change this later in Settings.</p>}
        <div className="frw-actions">
          <button type="button" className="frw-primary" onClick={() => finish(true, need)}>Continue</button>
          <button type="button" className="frw-link" onClick={() => finish(true, "")}>Skip this question</button>
        </div>
      </div>
    </main>
  );
}
