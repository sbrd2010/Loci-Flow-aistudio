import React, { useState, useEffect } from "react";
import { auth } from "./firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";
import { useSync } from "./useSync";
import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
import TodayTab from "./components/TodayTab";
import RoadmapTab from "./components/RoadmapTab";
import CoachTab from "./components/CoachTab";
import SettingsTab from "./components/SettingsTab";
import AddTaskDialog from "./components/AddTaskDialog";
import OnboardingWizard from "./components/OnboardingWizard";

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("today");
  const [showAddTask, setShowAddTask] = useState(false);
  const [preselectedHorizon, setPreselectedHorizon] = useState("today");
  const [theme, setTheme] = useState(() => localStorage.getItem("loci_theme") || "glassy");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("loci_theme", theme);
  }, [theme]);

  // Handle redirect sign-in result (iOS Safari / popup-blocked fallback)
  useEffect(() => {
    getRedirectResult(auth).catch(() => {});
  }, []);

  // Load the sync payload from RTDB
  const { payload, loading, error, savePayload, saveSubPath } = useSync(user?.uid || null, user?.email || null);

  // Auto-increment visit streak on first open each day
  useEffect(() => {
    if (!payload?.config || !user) return;
    const cfg = payload.config;
    const todayStr = new Date().toISOString().split("T")[0];
    if (cfg.lastVisitDate === todayStr) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    const newStreak = cfg.lastVisitDate === yesterdayStr ? (cfg.visitStreakCount || 0) + 1 : 1;

    savePayload({
      ...payload,
      config: { ...cfg, visitStreakCount: newStreak, lastVisitDate: todayStr, lastUpdated: Date.now() }
    });
  }, [payload?.config?.lastVisitDate, user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Firebase auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // Handle sign-out / switch user
  const handleSwitchUser = () => {
    signOut(auth).then(() => {
      setUser(null);
      setActiveTab("today");
    });
  };

  // Open the Add Task dialog
  const openAddTask = (horizon = "today") => {
    setPreselectedHorizon(horizon);
    setShowAddTask(true);
  };

  if (authLoading) {
    return (
      <div className="signin-overlay">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "40px" }}>🧠</span>
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="signin-overlay">
        <div className="signin-card card">
          <div className="signin-title-container">
            <span className="signin-emoji">🧠</span>
            <h1 className="signin-title">Loci Focus</h1>
            <p className="signin-subtitle">Your daily focus companion.</p>
          </div>
          <button
            className="btn"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontSize: "15px", padding: "14px 20px" }}
            onClick={() => signInWithPopup(auth, new GoogleAuthProvider()).catch(err => {
              if (err.code === "auth/popup-blocked" || err.code === "auth/popup-closed-by-user") {
                signInWithRedirect(auth, new GoogleAuthProvider());
              }
            })}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 6.294C4.672 4.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
          <span className="signin-note">
            Your tasks sync across your devices. Sign in with Google to begin.
          </span>
        </div>
      </div>
    );
  }

  // If Firebase connection failed, show an actionable error screen
  if (error) {
    return (
      <div className="signin-overlay">
        <div className="signin-card card" style={{ padding: "40px 20px" }}>
          <span className="signin-emoji">⚠️</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: "800" }}>Sync Error</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "8px" }}>{error}</p>
          <button className="btn" onClick={() => window.location.reload()} style={{ marginTop: "20px" }}>
            Retry Connection
          </button>
        </div>
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

  // Render onboarding wizard overlay only for new web users.
  // Use strict === false so existing Android users (isOnboardingCompleted === undefined) skip it.
  if (payload.config && payload.config.isOnboardingCompleted === false) {
    return <OnboardingWizard payload={payload} savePayload={savePayload} />;
  }

  return (
    <div className="app-container">
      {/* Header top bar */}
      <Header
        userName={payload?.config?.userName || user.displayName || user.email}
        onGoHome={() => setActiveTab("today")}
        theme={theme}
        onThemeChange={setTheme}
      />

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
        {activeTab === "coach" && <CoachTab payload={payload} savePayload={savePayload} saveSubPath={saveSubPath} />}
        {activeTab === "settings" && <SettingsTab payload={payload} savePayload={savePayload} saveSubPath={saveSubPath} onSignOut={handleSwitchUser} />}
      </main>

      {/* Floating Action Button (Only show on Today & Roadmap screens) */}
      {(activeTab === "today" || activeTab === "roadmap") && (
        <button
          className="fab"
          onClick={() => openAddTask(activeTab === "roadmap" ? "week" : "today")}
          title="Add Focus Commit"
        >
          +
        </button>
      )}

      {/* Bottom Nav Footer */}
      <BottomNav activeTab={activeTab} onTabSelect={setActiveTab} />

      {/* Modal Add Task Dialog */}
      {showAddTask && (
        <AddTaskDialog
          email={user.email}
          payload={payload}
          savePayload={savePayload}
          defaultHorizon={preselectedHorizon}
          onClose={() => setShowAddTask(false)}
        />
      )}
    </div>
  );
}
