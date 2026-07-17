import React, { useState, useEffect, useRef, useMemo } from "react";
import { auth, track, setAnalyticsUser } from "./firebase";
import { computeUserProfile } from "./utils/userProfile";
import { scheduleAllReminders, scheduleCoachCheckin, cancelCoachCheckin, checkDailyCheckinNotifications, scheduleDailyCheckins, cancelDailyCheckins, cancelAllNativeScheduling, VISIBLE_HEARTBEAT_KEY, DAILY_CHECKIN_SLOTS } from "./utils/reminders";
import { isNativeApp, refreshNativePermission, addNativeNotificationClickListener, NATIVE_PERMISSION_GRANTED_EVENT } from "./utils/nativeNotifs";
import { signInWithGoogleNative } from "./utils/nativeAuth";
import { isCheckinDue, buildCheckinResumeMessage, isDuplicateCheckinResume } from "./utils/coachCheckin";
import { getFocusWindows, getLociDayStr } from "./utils/focusWindows";
import { createDemoPayload } from "./utils/demoData";
import { signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";
import { useSync, CONN } from "./useSync";
import { useFocusAudio } from "./hooks/useFocusAudio";
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
import DayMapPage from "./components/DayMapPage";
import FloatingFocusTimer from "./components/FloatingFocusTimer";
import ConfirmDialog from "./components/ConfirmDialog";
import { useFocusTimer } from "./hooks/useFocusTimer";
import { useTodayStr } from "./hooks/useTodayStr";
import { shouldShowFloatingTimer, shouldShowFocusCompletionPrompt, buildFocusCompletionPayload } from "./utils/focusSession";
import { celebrate } from "./utils/celebrations";
import { safeUUID } from "./utils/uuid";
import { submitOnEnter } from "./utils/formEvents";
import { buildTaskMutationEvent, buildFocusStartedEvent, buildFocusTerminalEvent, eventPatch, eventsPatch } from "./utils/activityLog";

const EXTEND_DURATION_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];

function toLocalDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("today");
  const [pendingCheckinSlot, setPendingCheckinSlot] = useState(null);
  const [mindBoxInitialPanel, setMindBoxInitialPanel] = useState(null);
  const [roadmapInitialCol, setRoadmapInitialCol] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [preselectedHorizon, setPreselectedHorizon] = useState("today");
  const [editingTask, setEditingTask] = useState(null);
  const [fabExpanded, setFabExpanded] = useState(false);
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("loci_theme") || "glassy";
    const removed = ["sage", "option-b-linear", "option-f-chronos"];
    return removed.includes(stored) ? "glassy" : stored;
  });
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState("");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showQuickDump, setShowQuickDump] = useState(false);
  const [quickDumpText, setQuickDumpText] = useState("");

  const sessionStartRef = useRef(Date.now());
  const tabStartRef = useRef(Date.now());

  // ── Demo mode ──────────────────────────────────────────────────────────────
  const [demoMode, setDemoMode] = useState(false);
  const [demoPayload, setDemoPayload] = useState(null);
  const [pendingFocusOpen, setPendingFocusOpen] = useState(false);
  // Day Map's pin-write promise, handed in by onStartFocus — lets the
  // pendingFocusOpen effect below defer its focus_started/focus_abandoned
  // ledger writes until that pin actually confirmed in RTDB, without
  // delaying the (already-instant) navigation to Today itself.
  const pendingFocusPinPromiseRef = useRef(null);

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

  const saveDemoSubPath = (subPath, value) => {
    setDemoPayload(prev => prev ? { ...prev, [subPath]: value, timestamp: Date.now() } : prev);
  };

  const saveDemoSubPaths = (patch) => {
    setDemoPayload(prev => prev ? { ...prev, ...patch, timestamp: Date.now() } : prev);
  };

  const saveDemoConfigPatch = (patch) => {
    setDemoPayload(prev => {
      if (!prev) return prev;
      const resolvedPatch = typeof patch === "function" ? patch(prev.config || {}) : patch;
      return { ...prev, config: { ...prev.config, ...resolvedPatch, lastUpdated: Date.now() }, timestamp: Date.now() };
    });
  };

  // Async counterparts of the demo save functions above — Demo Mode never
  // touches Firebase, so these just apply the same local state update and
  // resolve immediately, giving write-path call sites a consistent awaitable
  // interface regardless of demoMode.
  const saveDemoPayloadAsync = (updated) => {
    saveDemoPayload(updated);
    return Promise.resolve();
  };
  const saveDemoSubPathAsync = (subPath, value) => {
    saveDemoSubPath(subPath, value);
    return Promise.resolve();
  };
  const saveDemoSubPathsAsync = (patch) => {
    saveDemoSubPaths(patch);
    return Promise.resolve();
  };

  // ── Service worker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // ── Native (Capacitor) notifications ────────────────────────────────────────
  // Refresh the cached permission state on load and route notification taps to the
  // matching tab, mirroring the web service-worker deep-link above.
  useEffect(() => {
    if (!isNativeApp()) return;
    refreshNativePermission();
    let unsub = () => {};
    addNativeNotificationClickListener((extra) => {
      window.dispatchEvent(new CustomEvent("loci-notification-click", { detail: extra }));
    }).then((u) => { unsub = u; });
    return () => unsub();
  }, []);

  // A schedule attempted before the user has actually granted native
  // notification permission can silently fail (see nativeNotifs.js's
  // NATIVE_PERMISSION_GRANTED_EVENT comment) — bump this on grant so the
  // task-reminder/coach-checkin/daily-checkin effects below (all of which
  // depend on it) re-run their existing scheduling logic once permission is
  // real, instead of leaving reminders unscheduled until an unrelated
  // task/config edit happens to rerun them.
  const [nativePermVersion, setNativePermVersion] = useState(0);
  useEffect(() => {
    if (!isNativeApp()) return;
    const onGranted = () => setNativePermVersion(v => v + 1);
    window.addEventListener(NATIVE_PERMISSION_GRANTED_EVENT, onGranted);
    return () => window.removeEventListener(NATIVE_PERMISSION_GRANTED_EVENT, onGranted);
  }, []);

  // Deep-link to the Coach tab when opened via a "🤖 Coach check-in" notification
  // (clients.openWindow("/?tab=coach") in sw.js when no app window was open), or to
  // a specific Daily Coach Check-in slot via "?checkin=<slot>" (daily-checkin).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    if (params.get("tab") === "coach") {
      setActiveTab("coach");
      params.delete("tab");
      changed = true;
    }
    const checkinSlot = params.get("checkin");
    if (checkinSlot) {
      setActiveTab("today");
      if (DAILY_CHECKIN_SLOTS.has(checkinSlot)) setPendingCheckinSlot(checkinSlot);
      params.delete("checkin");
      params.delete("tab");
      changed = true;
    }
    if (changed) {
      const rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  }, []);

  // Same deep-link when the notification is tapped while an app window is already
  // open — sw.js posts a message to it instead of opening a new window. Fallback
  // (non-SW) notifications dispatch an equivalent window event (see reminders.js).
  useEffect(() => {
    const routeNotificationClick = (notificationType, slot) => {
      if (notificationType === "coach-checkin") setActiveTab("coach");
      else if (notificationType === "daily-checkin") {
        setActiveTab("today");
        if (DAILY_CHECKIN_SLOTS.has(slot)) setPendingCheckinSlot(slot);
      }
    };
    const onMessage = (event) => {
      if (event.data?.type !== "loci-notification-click") return;
      routeNotificationClick(event.data.notificationType, event.data.slot);
    };
    const onFallbackClick = (event) => {
      routeNotificationClick(event.detail?.type, event.detail?.slot);
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", onMessage);
    window.addEventListener("loci-notification-click", onFallbackClick);
    return () => {
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("loci-notification-click", onFallbackClick);
    };
  }, []);

  // Heartbeat so a backgrounded Loci tab can tell another Loci tab is visible
  // right now, and skip sending a redundant daily check-in notification (reminders.js).
  useEffect(() => {
    const markVisible = () => {
      if (document.visibilityState === "visible") localStorage.setItem(VISIBLE_HEARTBEAT_KEY, String(Date.now()));
    };
    markVisible();
    document.addEventListener("visibilitychange", markVisible);
    const id = setInterval(markVisible, 10_000);
    return () => {
      document.removeEventListener("visibilitychange", markVisible);
      clearInterval(id);
    };
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

    // Native (Android): signInWithPopup/signInWithRedirect below both require
    // navigating to Google's OAuth page inside the current WebView, which
    // Google actively blocks for any embedded WebView user agent — including
    // this app's. Route through the native Credential Manager-based flow
    // instead (see nativeAuth.js); it bridges back into this same `auth`
    // object, so nothing else in the app needs to know which path ran.
    if (isNativeApp()) {
      signInWithGoogleNative(auth).catch((err) => {
        setSigningIn(false);
        console.error("Native sign-in failed:", err?.code || err?.message || err);
        setSignInError("Sign-in failed. Please try again.");
      });
      return;
    }

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

    // Brave blocks popups via Shields — but signInWithRedirect is also broken in Brave
    // because Shields clears the OAuth state between redirect hops (same root cause as iOS).
    // signInWithPopup gives a catchable auth/popup-blocked error, which we can surface
    // with a clear "disable Shields" message. Redirect gives a silent failure loop.
    // So: always use popup, handle popup-blocked per platform below.

    signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => {
      setSigningIn(false);
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
      if (err.code === "auth/popup-blocked") {
        if (isIOS) {
          setSignInError("Pop-up blocked by Safari. Go to Settings → Safari → turn off Block Pop-ups, then try again.");
          return;
        }
        if (isBraveBrowser) {
          setSignInError("Brave Shields is blocking sign-in. Tap the lion icon → disable Shields for loci-flow.web.app → try again.");
          return;
        }
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
  const {
    payload: rtdbPayload, loading, error, connPhase, isSyncingFromCache, lastSyncedAt, syncWarning: rtdbSyncWarning,
    savePayload: rtdbSave, savePayloadAsync: rtdbSaveAsync,
    saveSubPath: rtdbSaveSub, saveSubPathAsync: rtdbSaveSubAsync,
    saveSubPaths: rtdbSaveSubs, saveSubPathsAsync: rtdbSaveSubsAsync,
    saveConfigPatch: rtdbSaveConfigPatch,
    writeActivityEvents: rtdbWriteActivityEvents, captureTodaySnapshotIfNeeded: rtdbCaptureTodaySnapshot,
    flushNow: rtdbFlushNow, clearCache: rtdbClearCache,
  } = useSync(demoMode ? null : (user?.uid || null), demoMode ? null : (user?.email || null));

  const payload = demoMode ? demoPayload : rtdbPayload;
  const savePayload = demoMode ? saveDemoPayload : rtdbSave;
  const savePayloadAsync = demoMode ? saveDemoPayloadAsync : rtdbSaveAsync;
  const saveSubPath = demoMode ? saveDemoSubPath : rtdbSaveSub;
  const saveSubPathAsync = demoMode ? saveDemoSubPathAsync : rtdbSaveSubAsync;
  const saveSubPaths = demoMode ? saveDemoSubPaths : rtdbSaveSubs;
  const saveSubPathsAsync = demoMode ? saveDemoSubPathsAsync : rtdbSaveSubsAsync;
  const saveConfigPatch = demoMode ? saveDemoConfigPatch : rtdbSaveConfigPatch;
  const flushNow = demoMode ? () => {} : (rtdbFlushNow || (() => {}));
  const clearCache = demoMode ? () => {} : (rtdbClearCache || (() => {}));
  const syncWarning = demoMode ? null : rtdbSyncWarning;
  // These are already uid-scoped closures from useSync — when demoMode forces
  // uid to null above, they safely no-op ({ok:false, reason:"no-uid"}) rather
  // than needing a separate demo branch, so every write-path call site can
  // call them unconditionally regardless of demoMode.
  const writeActivityEvents = rtdbWriteActivityEvents;
  const captureTodaySnapshotIfNeeded = rtdbCaptureTodaySnapshot;
  // Ledger event paths are keyed by the real Firebase uid — never build one
  // from a demo session (uid is null then, which is already the state
  // writeActivityEvents checks for; keeping this explicit for clarity).
  const activityUid = demoMode ? null : (user?.uid || null);

  // Live ref for the check-in poller below, which runs on an interval and
  // needs the latest chatHistory/config without restarting on every change.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  // Schedule task reminders whenever payload loads/changes (or, on native,
  // once notification permission is actually granted — see nativePermVersion above)
  useEffect(() => {
    if (payload?.tasks) scheduleAllReminders(payload.tasks);
  }, [payload?.tasks, nativePermVersion]);

  // Re-arm a pending Coach Check-In notification (see CoachTab) on load/refresh
  useEffect(() => {
    if (payload?.config?.coachCheckin) scheduleCoachCheckin(payload.config.coachCheckin);
  }, [payload?.config?.coachCheckin, nativePermVersion]);

  // Resume a "Coach Check-In" (see CoachTab) once it's due, regardless of
  // which tab is active. CoachTab unmounts on tab switch, so without this,
  // a check-in due while the user is elsewhere only ever arrives via a push
  // notification (gated on Notification permission). Runs on load and every
  // 60s; CoachTab's nudge effect defers to this via isCheckinDue.
  useEffect(() => {
    if (!payload?.config || isSyncingFromCache || syncWarning === "offline") return;
    const checkDue = () => {
      const current = payloadRef.current;
      const checkin = current?.config?.coachCheckin;
      if (!isCheckinDue(checkin)) return;
      const firstName = (current.config.userName || "").split(" ")[0] || "friend";
      const resumeText = buildCheckinResumeMessage(firstName, checkin.note);
      // Two tabs (or a reload near fireAt) can both see this same due coachCheckin
      // before either tab's "coachCheckin: null" write propagates to the other —
      // skip appending if the resume message is already the last chat message.
      if (!isDuplicateCheckinResume(current.chatHistory, resumeText)) {
        saveSubPath("chatHistory", [...(current.chatHistory || []), { text: resumeText, isUser: false }]);
      }
      saveConfigPatch({ coachCheckin: null });
      cancelCoachCheckin();
    };
    checkDue();
    const id = setInterval(checkDue, 60000);
    return () => clearInterval(id);
  }, [payload?.config?.coachCheckin?.fireAt, isSyncingFromCache, syncWarning]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayStr = useTodayStr();

  // Auto-increment visit streak on first open each day (real users only).
  // Guard: skip while isSyncingFromCache — payload is from stale localStorage at that point.
  // Without this guard, a second device opening the app would overwrite RTDB with the
  // stale cache payload (timestamp = now > any recent edit), silently erasing brainDump
  // items and other changes made on the first device since the cache was last written.
  useEffect(() => {
    if (!payload?.config || !user || demoMode || isSyncingFromCache) return;
    const cfg = payload.config;
    if (cfg.lastVisitDate === todayStr) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateStr(yesterday);
    const newStreak = cfg.lastVisitDate === yesterdayStr ? (cfg.visitStreakCount || 0) + 1 : 1;
    saveSubPath("config", { ...cfg, visitStreakCount: newStreak, lastVisitDate: todayStr, lastUpdated: Date.now() });
  }, [payload?.config?.lastVisitDate, user?.uid, isSyncingFromCache, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture today's carryover snapshot once per Loci day (not calendar day —
  // deliberately a separate guard from the visit-streak effect above). The
  // default focus window (7am-2am) means the Loci day can still be
  // "yesterday" between midnight and 7am even though the calendar date has
  // already rolled over; piggybacking on the calendar-day guard would both
  // mis-key the snapshot (captureTodaySnapshotIfNeeded's own getLociDayStr
  // call would correctly write it under yesterday's date) AND consume that
  // guard before the real Loci day starts, permanently skipping the actual
  // day's snapshot. captureTodaySnapshotIfNeeded's own transaction is
  // idempotent (write-only-if-null), so re-checking here is safe.
  // { uid, lociDay } once a capture attempt for that uid+day is CONFIRMED
  // successful — keyed on uid too (not just lociDay) so signing out and a
  // different account signing in on the same browser during the same Loci
  // day doesn't inherit the previous account's already-attempted marker and
  // skip its own capture. Only committed on captureTodaySnapshotIfNeeded's
  // own { ok: true } (write succeeded, or another device already captured
  // it — both confirmed outcomes) — a failed attempt (e.g. RTDB unreachable
  // at that moment) leaves it uncommitted so a later render retries instead
  // of silently giving up on the day's snapshot for good.
  const attemptedSnapshotRef = useRef(null);
  const snapshotAttemptInFlightRef = useRef(false);
  useEffect(() => {
    // syncWarning === "offline" means isSyncingFromCache flipped false via a
    // timeout fallback, not a confirmed sync — capturing off that stale cache
    // would write a wrong carryover set that the transaction's write-once
    // guard can never correct once a real sync lands later.
    if (!payload?.config || !user || demoMode || isSyncingFromCache || syncWarning === "offline") return;
    const attemptCapture = () => {
      // Read config from payloadRef.current (live), not the `payload` this
      // effect closed over — payload?.config is deliberately NOT a
      // dependency below, for the same reason payload?.tasks isn't (see
      // note below): plenty of task actions (e.g. completing a task bumps
      // config.totalXp) change `config` too, which would re-trigger this
      // effect just as readily as a direct task edit did before.
      const currentConfig = payloadRef.current?.config || payload.config;
      const windows = getFocusWindows(currentConfig);
      const lociDay = getLociDayStr(new Date(), windows);
      const attempted = attemptedSnapshotRef.current;
      if (attempted && attempted.uid === user.uid && attempted.lociDay === lociDay) return;
      if (snapshotAttemptInFlightRef.current) return;
      snapshotAttemptInFlightRef.current = true;
      captureTodaySnapshotIfNeeded(payloadRef.current?.tasks || [], windows).then((result) => {
        snapshotAttemptInFlightRef.current = false;
        if (result?.ok) attemptedSnapshotRef.current = { uid: user.uid, lociDay };
      });
    };
    attemptCapture();
    // Re-check periodically — if the app stays mounted across the Loci day's
    // actual start (e.g. left open overnight), no other dependency below
    // would otherwise re-trigger the capture. Deliberately NOT keyed to
    // payload?.tasks or payload?.config (earlier versions of this effect
    // were) — any task/config edit arriving right after the boundary but
    // before this interval's next tick would otherwise itself trigger the
    // first capture for the new day, snapshotting the POST-edit Today list
    // instead of the set present at day start, which the write-once
    // transaction could never correct afterward. 15s keeps that remaining
    // race window small.
    const id = setInterval(attemptCapture, 15_000);
    return () => clearInterval(id);
    // Boolean(payload?.config), not payload?.config itself — a fresh/no-cache
    // login has isSyncingFromCache staying false the whole session (it only
    // ever flips true when a local cache exists to sync from), so without
    // this the effect runs once while payload is still null, bails on the
    // guard above, and then never re-runs once RTDB actually supplies the
    // payload — permanently skipping that session's day-start snapshot. The
    // boolean only flips once (false → true) so it doesn't reintroduce the
    // payload-edit re-trigger race the plain object reference would.
  }, [user?.uid, demoMode, isSyncingFromCache, syncWarning, Boolean(payload?.config)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Firebase auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      if (firebaseUser) {
        setAnalyticsUser(firebaseUser.uid);
        track("session_start");
        if (demoMode) exitDemo(); // auto-exit demo if user signs in
      }
    });
    return unsubscribe;
  }, [demoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track session duration when the user closes or navigates away
  useEffect(() => {
    const handleUnload = () => {
      track("session_end", { duration_sec: Math.round((Date.now() - sessionStartRef.current) / 1000) });
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // Derive the behavioural profile from the live payload — pure computation,
  // never saved to Firebase. Eliminates the full-payload-overwrite risk that
  // savePayload would introduce (same mechanism as the P0 brainDump bug).
  const userProfile = useMemo(() => {
    if (!payload || demoMode || isSyncingFromCache) return null;
    return computeUserProfile(payload);
  }, [payload, demoMode, isSyncingFromCache]);

  // Focus timer state lives here (not in TodayTab) so it survives tab switches
  // and can be surfaced via the floating timer across pages.
  // reshuffleTrackRef bridges useFocusAudio's reshuffleTrack into the timer
  // hook's PiP popup: useFocusAudio needs focusTimer.isTimerRunning, so it's
  // constructed after useFocusTimer and isn't available yet at this point.
  const reshuffleTrackRef = useRef(() => {});
  const focusTimer = useFocusTimer(payload?.tasks || [], payload?.config || {}, user?.uid || null, reshuffleTrackRef);
  // Live (non-stale) read of focusTimer for effect/promise callbacks that
  // run after an async wait (e.g. the pendingFocusOpen effect's pinPromise
  // handlers below) — those closures capture `focusTimer` from whichever
  // render scheduled them, which startFocusSession()'s own setFocusSessionId
  // call doesn't reach until a LATER render.
  const focusTimerRef = useRef(focusTimer);
  focusTimerRef.current = focusTimer;

  // Focus Sounds audio also lives here so ambient sound keeps playing across
  // tab switches and after exiting the Deep Focus overlay.
  const focusAudio = useFocusAudio(focusTimer.isTimerRunning, payload?.config || {}, saveSubPath);
  useEffect(() => {
    reshuffleTrackRef.current = focusAudio.reshuffleTrack;
  }); // no deps - reshuffleTrack is a fresh closure every render, always resync

  // Unsent Coach chat draft also lives here (not in CoachTab) so it survives
  // tab switches — CoachTab unmounts when activeTab !== "coach". In-memory
  // only, cleared by CoachTab once the message actually sends.
  const [coachChatDraft, setCoachChatDraft] = useState("");

  // Clear the draft on sign-out/switch-account so one user's unsent text
  // never leaks into another user's session.
  useEffect(() => {
    setCoachChatDraft("");
  }, [user?.uid]);

  // Fire a push notification if the app is backgrounded/closed when a daily
  // check-in (Morning Commitment / Midday / Reflection) comes due. Suppressed
  // during an active focus session (mirrors TodayTab's auto-show guard) so a
  // backgrounded Deep Focus session isn't interrupted by these notifications.
  //
  // Web: a 5-minute poll (needs the JS runtime alive — fine for a
  // backgrounded tab). Native (Android): the JS runtime isn't guaranteed to
  // keep running once backgrounded/killed, so instead pre-schedule today's
  // remaining eligible slots as one-shot OS alarms (see reminders.js's
  // scheduleDailyCheckins) — re-run on the same triggers as the web poll
  // (config changes, e.g. right after a commitment save) so newly-eligible
  // slots get scheduled promptly.
  useEffect(() => {
    // syncWarning === "offline" means RTDB hasn't confirmed within 15s and we're
    // still on stale cached config (mirrors CoachTab's cloudSyncUnconfirmed check).
    if (!payload?.config || isSyncingFromCache || syncWarning === "offline") return;
    if (!demoMode && payload.config.isOnboardingCompleted === false) return;
    if (focusTimer.isFocusMode || focusTimer.sessionCompletePending) {
      // Native alarms already scheduled before this session started are not
      // otherwise cleaned up by this guard alone (unlike the web poll below,
      // which simply doesn't run) — cancel them so a Deep Focus block can't
      // still get interrupted by a check-in notification fired while this
      // effect was suppressed. Re-scheduled automatically once the session
      // ends and this effect re-runs (isFocusMode is in the deps below).
      if (isNativeApp()) cancelDailyCheckins();
      return;
    }
    if (isNativeApp()) {
      // A one-shot call here isn't enough on its own: scheduleDailyCheckins
      // only pre-schedules *today's* slots, so if the app stays
      // mounted/backgrounded across a Loci-day boundary with no config/focus
      // change to re-trigger this effect, the previous day's alarms are
      // exhausted and tomorrow's are never queued until something else
      // happens to rerun this. Poll on the same cadence as the web branch
      // below so day rollover gets caught the same way — scheduleDailyCheckins
      // is cheap and replaces same-id alarms, so this is safe to repeat.
      const reschedule = () => scheduleDailyCheckins(payload.config, getFocusWindows(payload.config));
      reschedule();
      const nativeId = setInterval(reschedule, 5 * 60 * 1000);
      return () => clearInterval(nativeId);
    }
    const check = () => checkDailyCheckinNotifications(payload.config, getFocusWindows(payload.config));
    check();
    const id = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [payload?.config, isSyncingFromCache, syncWarning, demoMode, focusTimer.isFocusMode, focusTimer.sessionCompletePending, nativePermVersion]);

  // Auto-start the timer when arriving from Day Map's "Start Focus" action
  useEffect(() => {
    if (pendingFocusOpen && focusTimer.activeTask) {
      // If activeTask ITSELF already has an open session (e.g. Day Map's
      // "Start Focus" tapped for the same task already running from Today),
      // just reopen the overlay — same guard as TodayTab's startFocusAndLog.
      // Checking focusSessionId alone isn't enough: Day Map's own pin is a
      // raw isNowFocus write (like TodayTab's handlePinTask), so retargeting
      // to a DIFFERENT task (B) while another task's (A) session is still
      // open would make activeTask B while focusSessionId still belongs to
      // A — must also confirm the open session's own task matches.
      if (focusTimer.focusSessionId && focusTimer.focusSessionTaskUuid === focusTimer.activeTask.uuid) {
        focusTimer.setIsFocusMode(true);
        focusTimer.setIsTimerRunning(true);
        pendingFocusPinPromiseRef.current = null;
        setPendingFocusOpen(false);
        return;
      }
      const windows = getFocusWindows(payload?.config || {});
      const session = focusTimer.startFocusSession(focusTimer.activeTask);
      // Timer/session state starts immediately (optimistic, same as every
      // other focus-start path) — but the ledger writes wait for Day Map's
      // pin write to actually confirm in RTDB, so a rejected/failed pin
      // doesn't leave a focus_started event for a session that never
      // really began. pendingFocusPinPromiseRef is set by onStartFocus below.
      const pinPromise = pendingFocusPinPromiseRef.current || Promise.resolve();
      pendingFocusPinPromiseRef.current = null;
      pinPromise
        .then(() => {
          // startFocusSession() auto-closes a still-open prior session (e.g. one
          // started from Today before navigating to Day Map) to make room for
          // this one — write its terminal event too, or it's orphaned forever.
          if (session.priorSession && session.priorSession.task) {
            const abandonEvent = buildFocusTerminalEvent("focus_abandoned", session.priorSession.task, session.priorSession.focusSessionId, {
              ...session.priorSession, windows,
            });
            writeActivityEvents(eventPatch(activityUid, abandonEvent));
          }
          const event = buildFocusStartedEvent(focusTimer.activeTask, session.focusSessionId, {
            source: "day_map", focusInitialPlannedSeconds: session.focusInitialPlannedSeconds,
            now: session.focusStartedAt, windows,
          });
          writeActivityEvents(eventPatch(activityUid, event));
        })
        .catch(() => {
          // The Day Map pin write never confirmed — undo the optimistic
          // session start above, or it's left open with no focus_started
          // event for a later endFocusSession call to surface as an
          // orphaned terminal event. Only if nothing newer has already
          // started (live-ref check, not this closure's stale focusTimer).
          if (focusTimerRef.current.focusSessionId === session.focusSessionId) {
            focusTimerRef.current.endFocusSession?.("user_abandoned");
            focusTimerRef.current.setIsTimerRunning?.(false);
            focusTimerRef.current.setIsFocusMode?.(false);
            focusTimerRef.current.setFocusSessionActive?.(false);
          }
        });
      setPendingFocusOpen(false);
    }
  }, [pendingFocusOpen, focusTimer.activeTask?.uuid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReturnToFocus = () => {
    setActiveTab("today");
    focusTimer.setIsFocusMode(true);
  };

  const handleEndFocusSession = () => {
    const ended = focusTimer.endFocusSession("user_abandoned");
    focusTimer.setIsTimerRunning(false);
    focusTimer.setIsFocusMode(false);
    focusTimer.setFocusSessionActive(false);
    // Use ended.task (captured when the session started), not activeTask —
    // if the Now Focus pin changed mid-session without ending it (e.g. the
    // pin-only menu), activeTask would point at the NEW task and misattribute
    // this abandonment to it instead of the task the session actually belonged to.
    if (ended && ended.task) {
      const event = buildFocusTerminalEvent("focus_abandoned", ended.task, ended.focusSessionId, {
        ...ended, windows: getFocusWindows(payload?.config || {}),
      });
      writeActivityEvents(eventPatch(activityUid, event));
    }
  };

  // Global Focus completion prompt: "Done! +120 XP" — completes the task and
  // ends the session, regardless of which tab the user is on.
  const handleFocusSessionDone = () => {
    const task = focusTimer.activeTask;
    focusTimer.dismissSessionComplete();
    if (!task) return;
    celebrate();
    const now = new Date();
    const ended = focusTimer.endFocusSession("completed_task");
    const windows = getFocusWindows(payload?.config || {});
    const events = [buildTaskMutationEvent("task_completed", task, { windows, source: "focus_mode", now })];
    // Use ended.task, not `task` — see handleEndFocusSession for why these
    // can diverge (a pin change that never ended the prior session).
    if (ended && ended.task) events.push(buildFocusTerminalEvent("focus_completed", ended.task, ended.focusSessionId, { ...ended, windows, now }));
    savePayloadAsync(buildFocusCompletionPayload(payload, task, toLocalDateStr(now), now))
      .then(() => writeActivityEvents(eventsPatch(activityUid, events)))
      .catch(() => {});
    focusTimer.setIsFocusMode(false);
    focusTimer.setFocusSessionActive(false);
  };

  // Global Focus completion prompt: "+50 XP, keep going" — awards XP and opens
  // the duration picker so the same task's timer can be restarted from any tab.
  const handleFocusSessionKeepGoing = () => {
    const config = payload?.config || {};
    saveSubPath("config", { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() });
    focusTimer.dismissSessionComplete();
    focusTimer.setShowExtendPicker(true);
  };

  const handleTabSelect = (tab) => {
    const dwellSec = Math.round((Date.now() - tabStartRef.current) / 1000);
    track("tab_switch", { tab, from: activeTab, dwell_sec: dwellSec });
    tabStartRef.current = Date.now();
    setFabExpanded(false);
    if (tab === "mindbox") setMindBoxInitialPanel(null);
    if (tab === "roadmap") setRoadmapInitialCol(null);
    setActiveTab(tab);
  };

  // Switch to Mind Box, optionally deep-linking straight to a sub-panel
  // (e.g. "anchors" from the Morning Ritual popup's Manage button).
  const openMindBox = (panel) => {
    handleTabSelect("mindbox");
    if (panel) setMindBoxInitialPanel(panel);
  };

  // Switch to Roadmap's Horizon Planning, deep-linking straight to the Brain
  // Dump Inbox column — used by Mind Box's "N notes waiting" button so that's
  // the one and only place brain dump items are browsable.
  const openRoadmapInbox = () => {
    handleTabSelect("roadmap");
    setRoadmapInitialCol("inbox");
  };

  const goToday = () => { setFabExpanded(false); setActiveTab("today"); };

  const openDayMap = () => { setFabExpanded(false); setActiveTab("daymap"); track("day_map_open"); };

  const handleSwitchUser = () => {
    // Flush any pending debounced write before signing out, then wipe the
    // local cache so the next user on this device doesn't see stale data.
    // Native task/check-in alarms are OS-persisted (unlike the in-memory
    // `scheduled` map elsewhere), so a page reload alone doesn't clear
    // them — cancel them explicitly or a shared/signed-out device could
    // keep surfacing the previous account's task titles as notifications.
    flushNow();
    clearCache();
    cancelAllNativeScheduling();
    signOut(auth).then(() => { setUser(null); setActiveTab("today"); });
  };

  const openAddTask = (horizon = "today") => {
    setEditingTask(null);
    setPreselectedHorizon(horizon);
    setShowAddTask(true);
  };

  const dumpCount = (payload?.brainDump || []).length;

  const handleQuickDump = (e) => {
    e.preventDefault();
    if (!quickDumpText.trim() || dumpCount >= 50 || !payload) return;
    savePayload({ ...payload, brainDump: [...(payload.brainDump || []), { id: safeUUID(), text: quickDumpText.trim(), createdAt: Date.now() }] });
    track("braindump_added");
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
                Brave detected — if sign-in is blocked, tap the lion icon and disable Shields for this site.
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
              onClick={() => { cancelAllNativeScheduling(); signOut(auth); }}
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
            {connPhase === CONN.CONNECTED ? "Still connecting…" : connPhase === CONN.OFFLINE ? "Reconnecting…" : "Loading Loci Space…"}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px", lineHeight: "1.5" }}>
            {connPhase === CONN.CONNECTED && isBrave
              ? "Brave Shields may be blocking the connection. Tap the lion icon → disable Shields for this site."
              : connPhase === CONN.CONNECTED
              ? "Taking longer than usual. Check your Wi-Fi or mobile data."
              : connPhase === CONN.OFFLINE
              ? "Lost connection — Firebase will reconnect automatically."
              : "Synchronizing your commitments…"}
          </p>
          {(connPhase === CONN.CONNECTED || connPhase === CONN.OFFLINE) && (
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
          position: "fixed", bottom: "calc(72px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)",
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

      {/* Sync warning — shown when RTDB is unreachable (stale cache) or a write failed */}
      {syncWarning && (
        <div
          role="alert"
          className="bottom-toast"
          onClick={() => window.location.reload()}
          style={{
            position: "fixed", bottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
            background: "var(--bg-card)", border: "1px solid #f59e0b",
            borderRadius: "20px", padding: "6px 16px",
            fontSize: "11px", fontWeight: "600", color: "#f59e0b",
            zIndex: 490, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            cursor: "pointer", whiteSpace: "nowrap",
            boxShadow: "0 2px 12px rgba(0,0,0,0.18)", textAlign: "center"
          }}
        >
          {syncWarning === "write-failed"
            ? "⚠️ Changes saved locally — cloud sync failed. Tap to retry."
            : syncWarning === "drop-guard"
            ? "⚠️ A suspicious task-count drop was blocked. Your data was not overwritten."
            : (!!navigator.brave
              ? "⚠️ Sync offline. Brave Shields may be blocking — tap to reload."
              : "⚠️ Sync offline — data may be out of date. Tap to retry.")}
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

      {/* Header top bar — hidden on Day Map (full-screen page) */}
      {activeTab !== "daymap" && (
        <Header
          userName={demoMode ? "Demo User" : (payload?.config?.userName || user?.displayName || user?.email)}
          onGoHome={goToday}
          theme={theme}
          onThemeChange={setTheme}
        />
      )}

      {/* Main Tab Screen Router */}
      <main className={`screen-content${activeTab === "daymap" ? " screen-content-day-map" : ""}`}>
        {activeTab === "today" && (
          <TodayTab
            payload={payload}
            savePayload={savePayload}
            savePayloadAsync={savePayloadAsync}
            saveSubPath={saveSubPath}
            isSyncingFromCache={isSyncingFromCache}
            syncWarning={syncWarning}
            saveConfigPatch={saveConfigPatch}
            onOpenAddTask={() => openAddTask("today")}
            onOpenDayMap={openDayMap}
            onOpenMindBox={openMindBox}
            onOpenCoach={() => setActiveTab("coach")}
            isAddTaskDialogOpen={showAddTask}
            pendingCheckinSlot={pendingCheckinSlot}
            setPendingCheckinSlot={setPendingCheckinSlot}
            uid={activityUid}
            writeActivityEvents={writeActivityEvents}
            {...focusTimer}
            {...focusAudio}
          />
        )}
        {activeTab === "daymap" && (
          <DayMapPage
            payload={payload}
            savePayload={savePayload}
            savePayloadAsync={savePayloadAsync}
            onClose={goToday}
            onStartFocus={(pinPromise) => { pendingFocusPinPromiseRef.current = pinPromise; setPendingFocusOpen(true); goToday(); }}
            onAddTask={() => openAddTask("today")}
            flushNow={flushNow}
          />
        )}
        {activeTab === "roadmap" && (
          <RoadmapTab
            payload={payload}
            savePayload={savePayload}
            savePayloadAsync={savePayloadAsync}
            onOpenAddTask={openAddTask}
            onEditTask={(task) => { setEditingTask(task); setShowAddTask(true); }}
            initialExpandedCol={roadmapInitialCol}
            uid={activityUid}
            writeActivityEvents={writeActivityEvents}
            focusTimer={focusTimer}
          />
        )}
        {activeTab === "mindbox" && <MindBoxTab payload={payload} savePayload={savePayload} savePayloadAsync={savePayloadAsync} saveSubPath={saveSubPath} saveConfigPatch={saveConfigPatch} userProfile={userProfile} initialPanel={mindBoxInitialPanel} onOpenRoadmapInbox={openRoadmapInbox} isSyncingFromCache={isSyncingFromCache} syncWarning={syncWarning} uid={activityUid} writeActivityEvents={writeActivityEvents} focusTimer={focusTimer} />}
        {activeTab === "coach" && <CoachTab payload={payload} savePayload={savePayload} savePayloadAsync={savePayloadAsync} saveSubPath={saveSubPath} saveSubPaths={saveSubPaths} saveSubPathsAsync={saveSubPathsAsync} saveConfigPatch={saveConfigPatch} userProfile={userProfile} focusTimer={focusTimer} isSyncingFromCache={isSyncingFromCache} syncWarning={syncWarning} chatDraft={coachChatDraft} setChatDraft={setCoachChatDraft} uid={activityUid} writeActivityEvents={writeActivityEvents} />}
        {activeTab === "settings" && (
          <SettingsTab
            payload={payload}
            savePayload={savePayload}
            saveSubPath={saveSubPath}
            saveConfigPatch={saveConfigPatch}
            lastSyncedAt={lastSyncedAt}
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
            <form onSubmit={handleQuickDump} className="braindump-form">
              <textarea
                autoFocus
                className="braindump-input"
                rows={3}
                placeholder="What's on your mind? (Shift+Enter for a new line)"
                value={quickDumpText}
                onChange={e => setQuickDumpText(e.target.value)}
                onKeyDown={submitOnEnter}
                disabled={dumpCount >= 50}
              />
              <button type="submit" className="braindump-submit" disabled={dumpCount >= 50 || !quickDumpText.trim()}>➔</button>
            </form>
          </div>
        </>
      )}

      {/* Floating Focus timer — visible across pages while a session is active,
          hidden on Day Map and on the dark Focus overlay itself */}
      {shouldShowFloatingTimer({
        activeTab,
        focusSessionActive: focusTimer.focusSessionActive,
        hasActiveTask: !!focusTimer.activeTask,
        isFocusMode: focusTimer.isFocusMode,
        sessionCompletePending: focusTimer.sessionCompletePending,
      }) && (
        <FloatingFocusTimer
          task={focusTimer.activeTask}
          secondsLeft={focusTimer.timerSecondsLeft}
          maxSeconds={focusTimer.timerMaxSeconds}
          isRunning={focusTimer.isTimerRunning}
          onPlayPause={() => focusTimer.setIsTimerRunning(r => !r)}
          onReturnToFocus={handleReturnToFocus}
          onEndSession={handleEndFocusSession}
          pipOpen={focusTimer.pipOpen}
          onOpenPiP={focusTimer.handleOpenPiP}
        />
      )}

      {/* Global Focus session-complete prompt — fires when the timer reaches
          0:00 even if TodayTab is unmounted (user on another tab) */}
      {shouldShowFocusCompletionPrompt({
        sessionCompletePending: focusTimer.sessionCompletePending,
        hasActiveTask: !!focusTimer.activeTask,
      }) && (
        <ConfirmDialog
          message={`Focus block complete!\n\nYou've completed your deep focus block for:\n"${focusTimer.activeTask.title}"\n\nWould you like to mark this task as finished, or keep going?`}
          confirmLabel="Finish Task (+120 XP)"
          cancelLabel="Keep Going (+50 XP)"
          onConfirm={handleFocusSessionDone}
          onCancel={handleFocusSessionKeepGoing}
        />
      )}

      {/* Keep Going: pick a fresh focus block for the same task — also global
          so it works from any tab */}
      {focusTimer.showExtendPicker && focusTimer.activeTask && (
        <div
          className="focus-now-backdrop"
          onClick={() => focusTimer.extendTimer(Math.round(focusTimer.timerMaxSeconds / 60) || 15)}
        >
          <div className="focus-now-sheet" onClick={e => e.stopPropagation()}>
            <div className="focus-now-sheet-header">
              <span className="focus-now-sheet-title">Keep going on "{focusTimer.activeTask.title}"</span>
            </div>
            <div className="focus-now-sheet-body" style={{ padding: "4px 16px 16px" }}>
              <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", margin: "0 0 12px" }}>
                Pick your next focus block. The timer restarts on this same task.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {EXTEND_DURATION_OPTIONS.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    className="btn"
                    style={{ flex: "1 0 calc(33.33% - 8px)", fontSize: "13px", padding: "10px 8px" }}
                    onClick={() => focusTimer.extendTimer(mins)}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Nav — hidden on Day Map (full-screen page) */}
      {activeTab !== "daymap" && <BottomNav activeTab={activeTab} onTabSelect={handleTabSelect} />}

      {/* Add / Edit Task Dialog */}
      {showAddTask && (
        <AddTaskDialog
          email={demoMode ? "demo@loci.app" : user?.email}
          payload={payload}
          savePayload={savePayload}
          savePayloadAsync={savePayloadAsync}
          userProfile={userProfile}
          defaultHorizon={preselectedHorizon}
          editTask={editingTask}
          onClose={() => { setShowAddTask(false); setEditingTask(null); }}
          uid={activityUid}
          writeActivityEvents={writeActivityEvents}
        />
      )}
    </div>
  );
}
