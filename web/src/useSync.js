import { useState, useEffect, useRef } from "react";
import { ref, onValue, set, update, runTransaction, get } from "firebase/database";
import { db } from "./firebase";
import { safeUUID } from "./utils/uuid";

// Connection phase exposed to UI: "connecting" | "connected" | "offline" | "error"
// This lets the app show specific messages at each stage instead of just "loading".
export const CONN = { CONNECTING: "connecting", CONNECTED: "connected", OFFLINE: "offline", ERROR: "error" };

// Retry a Firebase set() up to `retries` times with exponential backoff (500ms, 1s, 2s).
async function writeWithRetry(dbRef, data, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await set(dbRef, data);
      return;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
}

const cacheKey = (uid) => `loci_payload_v1_${uid}`;

function readCache(uid) {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Require at minimum tasks + config to be considered valid cache
    if (data && data.tasks && data.config) return data;
    return null;
  } catch {
    return null;
  }
}

function writeCache(uid, data) {
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify(data));
  } catch {
    // Ignore QuotaExceededError — cache is best-effort
  }
}

export function useSync(uid, email) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connPhase, setConnPhase] = useState(CONN.CONNECTING);
  // True while app is rendering from cache and RTDB hasn't responded yet
  const [isSyncingFromCache, setIsSyncingFromCache] = useState(false);

  const dbRefPath = uid ? `sync/${uid}` : null;

  const payloadRef = useRef(null);
  const timeoutRef = useRef(null);
  const pendingRemoteRef = useRef(null);
  // Track if RTDB is physically connected (via .info/connected)
  const rtdbConnectedRef = useRef(false);
  // Mutable ref so the timeout callback can see the latest phase without stale closure
  const dataTimeoutRef = useRef(null);

  useEffect(() => {
    if (!dbRefPath) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setConnPhase(CONN.CONNECTING);
    setError(null);
    setIsSyncingFromCache(false);
    rtdbConnectedRef.current = false;
    const userRef = ref(db, dbRefPath);

    // Load from localStorage cache immediately — app is usable in <100ms on return visits.
    const cached = readCache(uid);
    const hasCachedData = !!cached;
    if (hasCachedData) {
      setPayload(cached);
      payloadRef.current = cached;
      setLoading(false);
      setIsSyncingFromCache(true);
    }

    // ── Phase 1: monitor raw TCP/WebSocket/long-poll connectivity via .info/connected ──
    // Firebase sets this ref to true the moment the RTDB transport is established,
    // before any user data arrives. This lets us separate "can't connect at all"
    // from "connected but data taking time."
    let connTimeoutId = null;
    let dataTimeoutId = null;

    if (!hasCachedData) {
      // If the transport can't establish at all within 10s, show error.
      connTimeoutId = setTimeout(() => {
        if (!rtdbConnectedRef.current) {
          const isBrave = !!navigator.brave;
          if (!navigator.onLine) {
            setError("You appear to be offline. Check your Wi-Fi or mobile data, then tap Retry.");
          } else if (isBrave) {
            setError("Brave Shields is blocking the sync connection. Tap the Brave lion icon → disable Shields for loci-flow.web.app → tap Retry.");
          } else {
            setError("Could not reach the sync server. Your network may be filtering the connection. Try switching between Wi-Fi and mobile data, then tap Retry.");
          }
          setConnPhase(CONN.ERROR);
          setLoading(false);
        }
      }, 10000);
    }

    // Monitor real connection state from Firebase SDK itself
    const connRef = ref(db, ".info/connected");
    const unsubConn = onValue(connRef, (snap) => {
      if (snap.val() === true) {
        rtdbConnectedRef.current = true;
        setConnPhase(CONN.CONNECTED);
        if (connTimeoutId) clearTimeout(connTimeoutId);
        // If we're now connected but still waiting for data (no cache), allow 10 more seconds
        if (!hasCachedData && !payloadRef.current) {
          dataTimeoutId = setTimeout(() => {
            setError("Connected to the server but data isn't arriving. This may be a permissions issue — try signing out and back in.");
            setConnPhase(CONN.ERROR);
            setLoading(false);
          }, 10000);
          dataTimeoutRef.current = dataTimeoutId;
        }
      } else if (rtdbConnectedRef.current) {
        // Was connected, now disconnected — Firebase will auto-reconnect
        setConnPhase(CONN.OFFLINE);
      }
    });

    const unsubscribe = onValue(userRef, (snapshot) => {
      if (connTimeoutId) clearTimeout(connTimeoutId);
      if (dataTimeoutRef.current) { clearTimeout(dataTimeoutRef.current); dataTimeoutRef.current = null; }
      setIsSyncingFromCache(false);
      setConnPhase(CONN.CONNECTED);

      const data = snapshot.val();

      if (!timeoutRef.current) {
        if (data) {
          setPayload(data);
          payloadRef.current = data;
          pendingRemoteRef.current = null;
          writeCache(uid, data);
        } else if (hasCachedData) {
          // RTDB is empty (new device or cleared DB) but we have local cache —
          // restore it to RTDB so the user's data isn't lost.
          runTransaction(ref(db, dbRefPath), (current) => {
            if (current !== null) return; // another device already initialized
            return payloadRef.current;
          }).catch(err => console.error("Cache restore to RTDB failed:", err));
          // payloadRef.current is already set from cache; leave payload as-is
        } else {
          // Brand-new user — derive a clean display name from email
          const rawName = email.split("@")[0];
          const displayName =
            rawName
              .split(/[._\-+]/)
              .filter(Boolean)
              .map(s => s.charAt(0).toUpperCase() + s.slice(1))
              .join(" ") || rawName;

          const toDateStr = (d) => {
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${d.getFullYear()}-${m}-${day}`;
          };
          const todayStr = toDateStr(new Date());
          const d1 = new Date(); d1.setDate(d1.getDate() - 1); const yStr = toDateStr(d1);
          const d2 = new Date(); d2.setDate(d2.getDate() - 2); const d2Str = toDateStr(d2);

          const defaultPayload = {
            userId: email,
            tasks: [
              {
                id: Date.now(),
                userId: email,
                uuid: safeUUID(),
                title: "Optimize resume for tech product role",
                concreteStep: "Add metrics to job #1",
                horizonLevel: "today",
                priority: "P1",
                category: "Career",
                timeEstimateMinutes: 45,
                deadlineTimestamp: null,
                isCompleted: false,
                isParked: false,
                isNowFocus: false,
                orderIndex: 0,
                dateCompletedString: null,
                isDeleted: false,
                lastUpdated: Date.now()
              },
              {
                id: Date.now() + 1,
                userId: email,
                uuid: safeUUID(),
                title: "Prep interview answers for star technique",
                concreteStep: "Draft situation for leadership question",
                horizonLevel: "today",
                priority: "P2",
                category: "Career",
                timeEstimateMinutes: 30,
                deadlineTimestamp: null,
                isCompleted: false,
                isParked: false,
                isNowFocus: false,
                orderIndex: 1,
                dateCompletedString: null,
                isDeleted: false,
                lastUpdated: Date.now()
              },
              {
                id: Date.now() + 2,
                userId: email,
                uuid: safeUUID(),
                title: "Go for a brief outdoor walk to recharge dopamine",
                concreteStep: "Put on sneakers and walk 10 mins",
                horizonLevel: "today",
                priority: "P4",
                category: "Health",
                timeEstimateMinutes: 15,
                deadlineTimestamp: null,
                isCompleted: false,
                isParked: false,
                isNowFocus: false,
                orderIndex: 2,
                dateCompletedString: null,
                isDeleted: false,
                lastUpdated: Date.now()
              }
            ],
            config: {
              userId: email,
              userName: displayName,
              mentorName: "Marcus Aurelius",
              challengeType: "starting",
              pomodoroDurationMinutes: 25,
              reminderNagIntervalMinutes: 15,
              visitStreakCount: 1,
              lastVisitDate: todayStr,
              totalXp: 150,
              intentionMessage: "Start tiny. One action. Right now.",
              isLowEnergyMode: false,
              isOnboardingCompleted: false,
              eveningGuardWindowActive: true,
              roadmapStyle: "compact",
              lastUpdated: Date.now()
            },
            contributions: [
              {
                compositeKey: `${email}_${yStr}`,
                userId: email,
                dateString: yStr,
                count: 3,
                lastUpdated: Date.now()
              },
              {
                compositeKey: `${email}_${d2Str}`,
                userId: email,
                dateString: d2Str,
                count: 1,
                lastUpdated: Date.now()
              }
            ],
            brainDump: [],
            timestamp: Date.now()
          };

          setPayload(defaultPayload);
          payloadRef.current = defaultPayload;
          writeCache(uid, defaultPayload);

          runTransaction(ref(db, dbRefPath), (current) => {
            if (current !== null) return;
            return defaultPayload;
          }).catch(err => console.error("Init transaction failed:", err));
        }
      } else {
        if (data) pendingRemoteRef.current = data;
      }
      setLoading(false);
    }, (err) => {
      if (connTimeoutId) clearTimeout(connTimeoutId);
      if (dataTimeoutRef.current) { clearTimeout(dataTimeoutRef.current); dataTimeoutRef.current = null; }
      console.error("Error reading RTDB payload:", err);
      setIsSyncingFromCache(false);
      if (!hasCachedData) {
        setError("Could not connect to sync server. Check your connection and reload.");
        setConnPhase(CONN.ERROR);
        setLoading(false);
      }
      // If we have cached data, don't show an error — user already sees the app
    });

    return () => {
      if (connTimeoutId) clearTimeout(connTimeoutId);
      if (dataTimeoutRef.current) clearTimeout(dataTimeoutRef.current);
      unsubConn();
      unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [dbRefPath, uid, email]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending debounced write on tab close / mobile background / screen lock.
  useEffect(() => {
    const flush = () => {
      if (timeoutRef.current && dbRefPath && payloadRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        writeWithRetry(ref(db, dbRefPath), payloadRef.current).catch(() => {});
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dbRefPath]);

  // One-time migration: copy data from legacy email path to uid path
  useEffect(() => {
    if (!uid || !email) return;
    const legacyId = email.replace(/\./g, "_");
    const legacyPath = `sync/${legacyId}`;
    if (legacyId === uid) return;

    get(ref(db, legacyPath)).then(snapshot => {
      const legacyData = snapshot.val();
      if (!legacyData) return;
      const uidPath = `sync/${uid}`;
      get(ref(db, uidPath)).then(uidSnap => {
        if (uidSnap.val()) return;
        set(ref(db, uidPath), { ...legacyData, userId: uid }).then(() => {
          console.log("Migration: legacy data copied to uid path");
        }).catch(err => console.error("Migration write failed:", err));
      });
    }).catch(() => {});
  }, [uid, email]);

  const savePayload = (updatedPayload) => {
    const nextPayload = { ...updatedPayload, timestamp: Date.now() };
    setPayload(nextPayload);
    payloadRef.current = nextPayload;

    // Keep local cache up-to-date immediately — protects against network loss
    if (uid) writeCache(uid, nextPayload);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      if (dbRefPath && payloadRef.current) {
        writeWithRetry(ref(db, dbRefPath), payloadRef.current)
          .then(() => console.log("Remote RTDB payload sync successful"))
          .catch((err) => console.error("Remote RTDB payload sync failed after retries:", err))
          .finally(() => {
            timeoutRef.current = null;
            if (pendingRemoteRef.current) {
              const remote = pendingRemoteRef.current;
              pendingRemoteRef.current = null;
              if ((remote.timestamp || 0) > (payloadRef.current?.timestamp || 0)) {
                setPayload(remote);
                payloadRef.current = remote;
                if (uid) writeCache(uid, remote);
              }
            }
          });
      }
    }, 1500);
  };

  const saveSubPath = (subPath, value) => {
    if (!dbRefPath) return;
    const updates = {
      [`${dbRefPath}/${subPath}`]: value,
      [`${dbRefPath}/timestamp`]: Date.now()
    };
    const attempt = (n) =>
      update(ref(db), updates).catch(err => {
        if (n > 0) return new Promise(r => setTimeout(r, 500 * Math.pow(2, 3 - n))).then(() => attempt(n - 1));
        console.error(`Sub-path write failed (${subPath}):`, err);
      });
    attempt(3);
  };

  return { payload, loading, error, connPhase, isSyncingFromCache, savePayload, saveSubPath };
}
