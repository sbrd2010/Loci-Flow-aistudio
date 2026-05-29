import { useState, useEffect, useRef } from "react";
import { ref, onValue, set, update, runTransaction, get } from "firebase/database";
import { db } from "./firebase";

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

export function useSync(uid, email) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const dbRefPath = uid ? `sync/${uid}` : null;

  const payloadRef = useRef(null);
  const timeoutRef = useRef(null);
  // Stores the most recent remote snapshot that arrived while a local save was pending
  const pendingRemoteRef = useRef(null);

  useEffect(() => {
    if (!dbRefPath) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const userRef = ref(db, dbRefPath);

    const unsubscribe = onValue(userRef, (snapshot) => {
      const data = snapshot.val();

      if (!timeoutRef.current) {
        if (data) {
          setPayload(data);
          payloadRef.current = data;
          pendingRemoteRef.current = null;
        } else {
          // Derive a clean display name from email: john.doe@gmail.com → "John Doe"
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
                uuid: crypto.randomUUID(),
                title: "Optimize resume for tech product role",
                concreteStep: "Add metric metrics to job #1",
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
                uuid: crypto.randomUUID(),
                title: "Prep interview answers for star technique",
                concreteStep: "Draft situation for leadership quest",
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
                uuid: crypto.randomUUID(),
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

          // Use a transaction so that two devices opening the app simultaneously
          // don't overwrite each other — only the first one to reach null wins.
          runTransaction(ref(db, dbRefPath), (current) => {
            if (current !== null) return; // abort — another device already initialized
            return defaultPayload;
          }).catch(err => console.error("Init transaction failed:", err));
        }
      } else {
        // A local write is in-flight — store this remote snapshot for deferred merge
        if (data) {
          pendingRemoteRef.current = data;
        }
      }
      setLoading(false);
    }, (err) => {
      console.error("Error reading RTDB payload:", err);
      setError("Could not connect to sync server. Check your connection and reload.");
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [dbRefPath, uid, email]);

  // Flush any pending debounced write immediately when the tab is closed.
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (timeoutRef.current && dbRefPath && payloadRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        set(ref(db, dbRefPath), payloadRef.current);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dbRefPath]);

  // One-time migration: copy data from legacy email path to uid path
  useEffect(() => {
    if (!uid || !email) return;
    const legacyId = email.replace(/\./g, "_");
    const legacyPath = `sync/${legacyId}`;
    if (legacyId === uid) return; // already on uid path, skip

    get(ref(db, legacyPath)).then(snapshot => {
      const legacyData = snapshot.val();
      if (!legacyData) return; // no legacy data, nothing to migrate
      const uidPath = `sync/${uid}`;
      get(ref(db, uidPath)).then(uidSnap => {
        if (uidSnap.val()) return; // uid path already has data, don't overwrite
        // Copy legacy data to uid path
        set(ref(db, uidPath), { ...legacyData, userId: uid }).then(() => {
          console.log("Migration: legacy data copied to uid path");
        }).catch(err => console.error("Migration write failed:", err));
      });
    }).catch(() => {}); // silent fail if legacy path unreadable
  }, [uid, email]);

  /**
   * savePayload — full-payload write with optimistic local update + 1.5s debounce.
   * Retries up to 3 times on network failure before giving up.
   */
  const savePayload = (updatedPayload) => {
    const nextPayload = {
      ...updatedPayload,
      timestamp: Date.now()
    };

    setPayload(nextPayload);
    payloadRef.current = nextPayload;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (dbRefPath && payloadRef.current) {
        writeWithRetry(ref(db, dbRefPath), payloadRef.current)
          .then(() => {
            console.log("Remote RTDB payload sync successful");
          })
          .catch((err) => {
            console.error("Remote RTDB payload sync failed after retries:", err);
          })
          .finally(() => {
            timeoutRef.current = null;
            // If a remote snapshot arrived while we were writing, apply it only if newer.
            if (pendingRemoteRef.current) {
              const remote = pendingRemoteRef.current;
              pendingRemoteRef.current = null;
              if ((remote.timestamp || 0) > (payloadRef.current?.timestamp || 0)) {
                setPayload(remote);
                payloadRef.current = remote;
              }
            }
          });
      }
    }, 1500);
  };

  /**
   * saveSubPath — granular sub-path write that does NOT overwrite the full payload.
   * Use for isolated fields like chatHistory to avoid stomping concurrent task writes.
   */
  const saveSubPath = (subPath, value) => {
    if (!dbRefPath) return;
    const updates = {
      [`${dbRefPath}/${subPath}`]: value,
      [`${dbRefPath}/timestamp`]: Date.now()
    };
    update(ref(db), updates)
      .then(() => console.log(`Sub-path write OK: ${subPath}`))
      .catch(err => console.error(`Sub-path write failed (${subPath}):`, err));
  };

  return { payload, loading, error, savePayload, saveSubPath };
}
