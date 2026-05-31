import React, { useState, useEffect } from "react";
import { auth, track } from "./firebase";
import { scheduleAllReminders } from "./utils/reminders";
import { createDemoPayload } from "./utils/demoData";
import { signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";
import { useSync } from "./useSync";
import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
import TodayTab from "./components/TodayTab";
import RoadmapTab from "./components/RoadmapTab";
import MindBoxTab from "./components/MindBoxTab";
import CoachTab from "./components/CoachTab";
import SettingsTab from "./components/SettingsTab";
import AddTaskDialog from "./components/AddTaskDialog";
import OnboardingWizard from "./components/OnboardingWizard";
import PrivacyPolicy from "./components/PrivacyPolicy";
import { safeUUID } from "./utils/uuid";

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("today");
  const [showAddTask, setShowAddTask] = useState(false);
  const [preselectedHorizon, setPreselectedHorizon] = useState("today");
  const [editingTask, setEditingTask] = useState(null);
  const [fabExpanded, setFabExpanded] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("loci_theme") || "glassy");
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState("");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showQuickDump, setShowQuickDump] = useState(false);
  const [quickDumpText, setQuickDumpText] = useState("");

  // ── Demo mode ──────────────────────────────────────────────────────────────
  const [demoMode, setDemoMode] = useState(false);
  const [demoPayload, setDemoPayload] = useState(null);

  const enterDemo = () => {
    setDemoPayload(createDemoPayload());
    setDemoMode(true);
    setActiveTab("today");
    track("demo_start");
  };

  const exitDemo = () => {
    setDemoMode(false);
    setDemoPayload(null);
    setActiveTab("today");
  };

  const saveDemoPayload = (updated) => {
    setDemoPayload({ ...updated, timestamp: Date.now() });
  };

  const saveDemoSubPath = () => {};

  // ── Service worker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("loci_theme", theme);
  }, [theme]);

  // Handle redirect sign-in result (iOS, Brave, and Android popup-blocked fallback)
  useEffect(() => {
    const pendingRaw = localStorage.getItem("loci_redirect_pending");
    localStorage.removeItem("loci_redirect_pending");
    // Only treat as an active redirect if the flag was set within the last 2 minutes —
    // prevents a stuck flag from a previous interrupted session poisoning a new one.
    let redirectPending = false;
    if (pendingRaw) {
      try {
        const { t } = JSON.parse(pendingRaw);
        redirectPending = (Date.now() - t) < 120_000;
      } catch {
        redirectPending = true; // legacy plain string — treat as recent
      }
    }
    getRedirectResult(auth).catch((err) => {
      if (redirectPending && err?.code) {
        console.error("Redirect sign-in failed:", err.code, err.message);
        setSignInError("Sign-in was interrupted. Please try again.");
      }
    });
  }, []);

  const handleSignIn = () => {
    setSigningIn(true);
    setSignInError("");
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    // navigator.brave is only defined in Brave — sync check, no async needed
    const isBraveBrowser = !!navigator.brave;

    const doRedirect = (errorMsg = "Sign-in failed. Please try again.") => {
      localStorage.setItem("loci_redirect_pending", JSON.stringify({ t: Date.now() }));
      signInWithRedirect(auth, new GoogleAuthProvider()).catch((err) => {
        localStorage.removeItem("loci_redirect_pending");
        setSigningIn(false);
        console.error("Redirect sign-in failed:", err.code, err.message);
        setSignInError(errorMsg);
      });
    };

    // Brave blocks popups via Shields on all platforms — go straight to redirect
    if (isBraveBrowser || isIOS) {
      doRedirect("Sign-in failed. If using Brave, tap the lion icon → disable Shields for this site, then try again.");
      return;
    }

    signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => {
      setSigningIn(false);
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
      if (err.code === "auth/popup-blocked") {
        if (isAndroid) {
          setSigningIn(true);
          doRedirect();
          return;
        }
        setSignInError("Popup blocked. Please allow popups for this site, then try again.");
        return;
      }
      console.error("Sign-in failed:", err.code, err.message);
      if (err.code === "auth/internal-error" || err.code === "auth/network-request-failed") {
        setSignInError("Sign-in blocked. If you're using Brave, tap the lion icon → disable Shields for this site, then try again.");
        return;
      }
      setSignInError("Sign-in failed. Please try again.");
    });
  };

  // Load the sync payload from RTDB (skipped in demo mode — uid is null)
  const { payload: rtdbPayload, loading, error, slowLoading, isSyncingFromCache, savePayload: rtdbSave, saveSubPath: rtdbSaveSub } =
    useSync(demoMode ? null : (user?.uid || null), demoMode ? null : (user?.email || null));

  const payload = demoMode ? demoPayload : rtdbPayload;
  const savePayload = demoMode ? saveDemoPayload : rtdbSave;
  const saveSubPath = demoMode ? saveDemoSubPath : rtdbSaveSub;

  // Schedule task reminders whenever payload loads/changes
  useEffect(() => {
    if (payload?.tasks) scheduleAllReminders(payload.tasks);
  }, [payload?.tasks]);

  // Auto-increment visit streak on first open each day (real users only)
  useEffect(() => {
    if (!payload?.config || !user || demoMode) return;
    const cfg = payload.config;
    const toLocalDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const todayStr = toLocalDateStr(new Date());
    if (cfg.lastVisitDate === todayStr) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateStr(yesterday);
    const newStreak = cfg.lastVisitDate === yesterdayStr ? (cfg.visitStreakCount || 0) + 1 : 1;
    savePayload({ ...payload, config: { ...cfg, visitStreakCount: newStreak, lastVisitDate: todayStr, lastUpdated: Date.now() } });
  }, [payload?.config?.lastVisitDate, user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Firebase auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      if (firebaseUser && demoMode) exitDemo(); // auto-exit demo if user signs in
    });
    return unsubscribe;
  }, [demoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabSelect = (tab) => { setActiveTab(tab); track("tab_switch", { tab }); };

  const handleSwitchUser = () => {
    signOut(auth).then(() => { setUser(null); setActiveTab("today"); });
  };

  const openAddTask = (horizon = "today") => {
    setEditingTask(null);
    setPreselectedHorizon(horizon);
    setShowAddTask(true);
  };

  const dumpCount = (payload?.brainDump || []).length;
  const recentDump = [...(payload?.brainDump || [])].slice(-3).reverse();

  const handleQuickDump = (e) => {
    e.preventDefault();
    if (!quickDumpText.trim() || dumpCount >= 50 || !payload) return;
    savePayload({ ...payload, brainDump: [...(payload.brainDump || []), { id: safeUUID(), text: quickDumpText.trim(), createdAt: Date.now() }] });
    setQuickDumpText("");
  };

  // ── Loading spinner ────────────────────────────────────────────────────────
  if (!demoMode && authLoading) {
    return (
      <div className="signin-overlay">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "40px" }}>🧠</span>
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>
        </div>
      </div>
    );
  }

  // ── Sign-in screen ─────────────────────────────────────────────────────────
  if (!demoMode && !user) {
    return (
      <>
        <div className="signin-overlay">
          <div className="signin-card card">
            <div className="signin-title-container">
              <span className="signin-emoji">🧠</span>
              <h1 className="signin-title">Loci Focus</h1>
              <p className="signin-subtitle">Your daily focus companion.</p>
            </div>
            <button
              className="btn"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontSize: "15px", padding: "14px 20px", opacity: signingIn ? 0.7 : 1 }}
              onClick={handleSignIn}
              disabled={signingIn}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 6.294C4.672 4.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              {signingIn ? "Signing in…" : "Continue with Google"}
            </button>
            {signInError && (
              <p style={{ fontSize: "12px", color: "var(--danger)", marginTop: "8px", textAlign: "center" }}>{signInError}</p>
            )}
            {!signInError && !!navigator.brave && (
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px", textAlign: "center" }}>
                Brave detected — you'll be redirected to Google and brought back.
              </p>
            )}

            {/* Demo mode entry */}
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", margin: "4px 0" }}>
              <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
              <span style={{ fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>or</span>
              <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            </div>
            <button
              className="btn"
              data-testid="demo-btn"
              style={{ width: "100%", background: "var(--bg-secondary)", color: "var(--text-secondary)", border: "1.5px solid var(--border)", boxShadow: "none", fontSize: "13px", fontWeight: "700" }}
              onClick={enterDemo}
            >
              🎭 Try Demo Without Sign-In
            </button>

            <span className="signin-note">
              Your tasks sync across your devices. Sign in with Google to begin.
            </span>
            <button
              onClick={() => setShowPrivacy(true)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: "var(--text-muted)", textDecoration: "underline", marginTop: "4px" }}
            >
              Privacy Policy
            </button>
          </div>
        </div>
        {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      </>
    );
  }

  // ── Firebase errors (real users only) ─────────────────────────────────────
  if (!demoMode && error) {
    return (
      <div className="signin-overlay">
        <div className="signin-card card" style={{ padding: "40px 20px" }}>
          <span className="signin-emoji">⚠️</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: "800" }}>Sync Error</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "8px", lineHeight: "1.5" }}>{error}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "20px", width: "100%" }}>
            <button className="btn" onClick={() => window.location.reload()}>
              Retry Connection
            </button>
            <button
              className="btn"
              onClick={() => signOut(auth)}
              style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", border: "1.5px solid var(--border)", boxShadow: "none", fontSize: "13px" }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RTDB loading (real users only) ────────────────────────────────────────
  if (!demoMode && (loading || !payload)) {
    const isBrave = !!navigator.brave;
    return (
      <div className="signin-overlay">
        <div className="signin-card card" style={{ padding: "40px 20px" }}>
          <span className="signin-emoji" style={{ animationDuration: "1.5s" }}>🧠</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: "800" }}>
            {slowLoading ? "Still connecting…" : "Loading Loci Space…"}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px", lineHeight: "1.5" }}>
            {slowLoading && isBrave
              ? "Brave Shields may be blocking the connection. Tap the lion icon → disable Shields for this site."
              : slowLoading
              ? "Taking longer than usual. Check your Wi-Fi or mobile data."
              : "Synchronizing your commitments…"}
          </p>
          {slowLoading && (
            <button className="btn" onClick={() => window.location.reload()} style={{ marginTop: "20px", width: "100%" }}>
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Onboarding wizard (real users only) ───────────────────────────────────
  if (!demoMode && payload.config && payload.config.isOnboardingCompleted === false) {
    return <OnboardingWizard payload={payload} savePayload={savePayload} />;
  }

  // ── Main app ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container">

      {/* Subtle cloud-sync indicator — shown while serving from cache, hidden once RTDB responds */}
      {!demoMode && isSyncingFromCache && (
        <div style={{
          position: "fixed", bottom: "72px", left: "50%", transform: "translateX(-50%)",
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "20px", padding: "5px 14px",
          fontSize: "11px", fontWeight: "600", color: "var(--text-muted)",
          zIndex: 490, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          pointerEvents: "none", whiteSpace: "nowrap",
          boxShadow: "0 2px 12px rgba(0,0,0,0.18)"
        }}>
          ↻ Syncing with cloud…
        </div>
      )}

      {/* Demo mode banner */}
      {demoMode && (
        <div data-testid="demo-banner" style={{
          position: "sticky", top: 0, zIndex: 500,
          background: "linear-gradient(90deg, #f59e0b, #f97316)",
          padding: "8px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
          fontSize: "12px", fontWeight: "700", color: "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
        }}>
          <span>🎭 Demo Mode — changes are not saved</span>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button
              onClick={() => { exitDemo(); handleSignIn(); }}
              style={{ background: "#fff", color: "#f59e0b", border: "none", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: "800", cursor: "pointer" }}
            >
              Sign in
            </button>
            <button
              onClick={exitDemo}
              style={{ background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}
            >
              Exit
            </button>
          </div>
        </div>
      )}

      {/* Header top bar */}
      <Header
        userName={demoMode ? "Demo User" : (payload?.config?.userName || user?.displayName || user?.email)}
        onGoHome={() => setActiveTab("today")}
        theme={theme}
        onThemeChange={setTheme}
      />

      {/* Main Tab Screen Router */}
      <main className="screen-content">
        {activeTab === "today" && (
          <TodayTab payload={payload} savePayload={savePayload} onOpenAddTask={() => openAddTask("today")} />
        )}
        {activeTab === "roadmap" && (
          <RoadmapTab
            payload={payload}
            savePayload={savePayload}
            onOpenAddTask={openAddTask}
            onEditTask={(task) => { setEditingTask(task); setShowAddTask(true); }}
          />
        )}
        {activeTab === "mindbox" && <MindBoxTab payload={payload} savePayload={savePayload} />}
        {activeTab === "coach" && <CoachTab payload={payload} savePayload={savePayload} saveSubPath={saveSubPath} />}
        {activeTab === "settings" && (
          <SettingsTab
            payload={payload}
            savePayload={savePayload}
            saveSubPath={saveSubPath}
            onSignOut={demoMode ? exitDemo : handleSwitchUser}
          />
        )}
      </main>

      {/* FAB — single + expands to two options */}
      {(activeTab === "today" || activeTab === "roadmap") && (
        <>
          {fabExpanded && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 88 }}
              onClick={() => setFabExpanded(false)}
            />
          )}
          {/* Option 2: Brain Dump */}
          <button
            className="fab-option"
            data-testid="fab-brain-dump"
            onClick={() => { setFabExpanded(false); setShowQuickDump(true); }}
            style={{
              opacity: fabExpanded ? 1 : 0,
              transform: fabExpanded ? "translateY(0) scale(1)" : "translateY(20px) scale(0.85)",
              pointerEvents: fabExpanded ? "auto" : "none",
              bottom: `calc(88px + env(safe-area-inset-bottom, 0px) + 130px)`,
              transitionDelay: fabExpanded ? "0.04s" : "0s"
            }}
            title="Brain Dump"
            aria-label="Brain Dump"
          >
            <span style={{ fontSize: "20px" }}>💭</span>
            <span style={{ fontSize: "12px", fontWeight: "700", whiteSpace: "nowrap" }}>Brain Dump</span>
          </button>
          {/* Option 1: Add Task */}
          <button
            className="fab-option"
            data-testid="fab-add-task-option"
            onClick={() => { setFabExpanded(false); openAddTask(activeTab === "roadmap" ? "week" : "today"); }}
            style={{
              opacity: fabExpanded ? 1 : 0,
              transform: fabExpanded ? "translateY(0) scale(1)" : "translateY(20px) scale(0.85)",
              pointerEvents: fabExpanded ? "auto" : "none",
              bottom: `calc(88px + env(safe-area-inset-bottom, 0px) + 68px)`,
              transitionDelay: fabExpanded ? "0s" : "0.04s"
            }}
            title="Add Task"
            aria-label="Add Task"
          >
            <span style={{ fontSize: "18px", fontWeight: "700" }}>✚</span>
            <span style={{ fontSize: "12px", fontWeight: "700", whiteSpace: "nowrap" }}>Add Task</span>
          </button>
          {/* Primary FAB */}
          <button
            className="fab"
            data-testid="fab-add-task"
            onClick={() => setFabExpanded(e => !e)}
            title={fabExpanded ? "Close" : "Add or Brain Dump"}
            style={{ transform: fabExpanded ? "rotate(45deg)" : "none" }}
          >
            +
          </button>
        </>
      )}

      {/* Quick Brain Dump sheet */}
      {showQuickDump && (
        <>
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200 }}
            onClick={() => { setShowQuickDump(false); setQuickDumpText(""); }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: "calc(100% - 32px)", maxWidth: "440px",
            background: "var(--bg-card)", borderRadius: "20px",
            padding: "22px 20px 24px",
            boxShadow: "0 8px 40px rgba(0,0,0,0.35)", zIndex: 201
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "800", margin: 0, color: "var(--text-primary)" }}>📝 Brain Dump</h3>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {dumpCount > 0 && (
                  <span style={{ fontSize: "11px", color: dumpCount >= 50 ? "var(--danger)" : "var(--text-muted)", fontWeight: "700" }}>
                    {dumpCount}/50
                  </span>
                )}
                <button
                  onClick={() => { setShowQuickDump(false); setQuickDumpText(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "var(--text-muted)", lineHeight: 1, padding: "2px 4px" }}
                >×</button>
              </div>
            </div>
            {dumpCount >= 50 && (
              <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "8px", fontWeight: "600" }}>
                Inbox full — triage items in Mind Box first.
              </p>
            )}
            <form onSubmit={handleQuickDump} style={{ display: "flex", gap: "8px", marginBottom: recentDump.length ? "14px" : 0 }}>
              <input
                autoFocus
                type="text"
                className="braindump-input"
                placeholder="What's on your mind?"
                value={quickDumpText}
                onChange={e => setQuickDumpText(e.target.value)}
                disabled={dumpCount >= 50}
                style={{ flex: 1 }}
              />
              <button type="submit" className="braindump-submit" disabled={dumpCount >= 50 || !quickDumpText.trim()}>➔</button>
            </form>
            {recentDump.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Recently captured
                </span>
                {recentDump.map(item => (
                  <p key={item.id} style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0, padding: "6px 10px", background: "var(--bg-secondary)", borderRadius: "8px", lineHeight: "1.45" }}>
                    {item.text}
                  </p>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Bottom Nav */}
      <BottomNav activeTab={activeTab} onTabSelect={handleTabSelect} />

      {/* Add / Edit Task Dialog */}
      {showAddTask && (
        <AddTaskDialog
          email={demoMode ? "demo@loci.app" : user?.email}
          payload={payload}
          savePayload={savePayload}
          defaultHorizon={preselectedHorizon}
          editTask={editingTask}
          onClose={() => { setShowAddTask(false); setEditingTask(null); }}
        />
      )}
    </div>
  );
}
