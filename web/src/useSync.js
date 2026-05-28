import { useState, useEffect, useRef } from "react";
import { ref, onValue, set, update, runTransaction } from "firebase/database";
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

export function useSync(email) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const safeUserId = email ? email.replace(/\./g, "_") : null;
  const dbRefPath = safeUserId ? `sync/${safeUserId}` : null;

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
              visitStreakCount: 5,
              lastVisitedTimestamp: Date.now(),
              totalXp: 150,
              intentionMessage: "Start tiny. One action. Right now.",
              isLowEnergyMode: false,
              isOnboardingCompleted: false,
              eveningGuardWindowActive: true,
              lastUpdated: Date.now()
            },
            contributions: [
              {
                compositeKey: `${email}_2026-05-27`,
                userId: email,
                dateString: "2026-05-27",
                count: 3,
                lastUpdated: Date.now()
              },
              {
                compositeKey: `${email}_2026-05-26`,
                userId: email,
                dateString: "2026-05-26",
                count: 1,
                lastUpdated: Date.now()
              }
            ],
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
  }, [dbRefPath, email]);

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
