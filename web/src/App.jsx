// CI/CD Deployment Trigger to resolve GHA race condition - v4
import React, { useState, useEffect } from "react";
import { useSync } from "./useSync";
import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
import TodayTab from "./components/TodayTab";
import RoadmapTab from "./components/RoadmapTab";
import CoachTab from "./components/CoachTab";
import MentorTab from "./components/MentorTab";
import AddTaskDialog from "./components/AddTaskDialog";

export default function App() {
  const [email, setEmail] = useState(localStorage.getItem("loci_email") || "");
  const [inputEmail, setInputEmail] = useState("");
  const [activeTab, setActiveTab] = useState("today");
  const [showAddTask, setShowAddTask] = useState(false);
  const [preselectedHorizon, setPreselectedHorizon] = useState("today");

  // Load the sync payload from RTDB
  const { payload, loading, savePayload } = useSync(email);

  // Handle local sign-in
  const handleSignIn = (e) => {
    e.preventDefault();
    if (inputEmail && inputEmail.includes("@")) {
      const cleanEmail = inputEmail.trim().toLowerCase();
      localStorage.setItem("loci_email", cleanEmail);
      setEmail(cleanEmail);
    }
  };

  // Handle sign-out / switch user
  const handleSwitchUser = () => {
    localStorage.removeItem("loci_email");
    setEmail("");
    setInputEmail("");
    setActiveTab("today");
    window.location.reload();
  };

  // Open the Add Task dialog
  const openAddTask = (horizon = "today") => {
    setPreselectedHorizon(horizon);
    setShowAddTask(true);
  };

  // If no email, render full-screen Sign-In Overlay
  if (!email) {
    return (
      <div className="signin-overlay">
        <form className="signin-card card" onSubmit={handleSignIn}>
          <div className="signin-title-container">
            <span className="signin-emoji">🧠</span>
            <h1 className="signin-title">Loci Focus</h1>
            <p className="signin-subtitle">
              Enter your email to sync your tasks.
            </p>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="email-input">Email Address</label>
            <input
              id="email-input"
              className="text-input"
              type="email"
              placeholder="you@example.com"
              value={inputEmail}
              onChange={(e) => setInputEmail(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={!inputEmail.includes("@")}>
            Start My Focus Journey
          </button>
          <span className="signin-note">
            No password needed. Your email is your sync ID.
          </span>
        </form>
      </div>
    );
  }

  // If loading sync data, show beautiful dark load screen
  if (loading || !payload) {
    return (
      <div className="signin-overlay">
        <div className="signin-card card" style={{ padding: "40px 20px" }}>
          <span className="signin-emoji" style={{ animationDuration: "1.5s" }}>🧠</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: "800" }}>Loading Loci Space...</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Synchronizing your commitments with cloud RTDB...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header top bar */}
      <Header email={email} onSwitchUser={handleSwitchUser} />

      {/* Main Tab Screen Router */}
      <main className="screen-content">
        {activeTab === "today" && (
          <TodayTab 
            payload={payload} 
            savePayload={savePayload} 
            onOpenAddTask={() => openAddTask("today")}
          />
        )}
        {activeTab === "roadmap" && (
          <RoadmapTab 
            payload={payload} 
            savePayload={savePayload} 
            onOpenAddTask={openAddTask}
          />
        )}
        {activeTab === "coach" && <CoachTab payload={payload} savePayload={savePayload} />}
        {activeTab === "mentor" && <MentorTab payload={payload} savePayload={savePayload} />}
      </main>

      {/* Floating Action Button (Only show on Today & Roadmap screens) */}
      {(activeTab === "today" || activeTab === "roadmap") && (
        <button className="fab" onClick={() => openAddTask("today")} title="Add Focus Commit">
          +
        </button>
      )}

      {/* Bottom Nav Footer */}
      <BottomNav activeTab={activeTab} onTabSelect={setActiveTab} />

      {/* Modal Add Task Dialog */}
      {showAddTask && (
        <AddTaskDialog
          email={email}
          payload={payload}
          savePayload={savePayload}
          defaultHorizon={preselectedHorizon}
          onClose={() => setShowAddTask(false)}
        />
      )}
    </div>
  );
}
