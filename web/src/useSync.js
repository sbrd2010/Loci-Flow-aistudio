import { useState, useEffect, useRef } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "./firebase";

export function useSync(email) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  // safeUserId has dots replaced with underscores
  const safeUserId = email ? email.replace(/\./g, "_") : null;
  const dbRefPath = safeUserId ? `sync/${safeUserId}` : null;

  const payloadRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!dbRefPath) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const userRef = ref(db, dbRefPath);

    const unsubscribe = onValue(userRef, (snapshot) => {
      const data = snapshot.val();

      // Only update local state if we don't have a pending local write,
      // to avoid race conditions or jumping UI.
      if (!timeoutRef.current) {
        if (data) {
          setPayload(data);
          payloadRef.current = data;
        } else {
          // Initialize default pre-seeded payload matching Entities.kt if none exists
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
              userName: email.split("@")[0].charAt(0).toUpperCase() + email.split("@")[0].slice(1),
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
          set(ref(db, dbRefPath), defaultPayload);
        }
      }
      setLoading(false);
    }, (error) => {
      console.error("Error reading RTDB payload:", error);
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [dbRefPath, email]);

  const savePayload = (updatedPayload) => {
    const nextPayload = {
      ...updatedPayload,
      timestamp: Date.now()
    };

    //snappy local UI update
    setPayload(nextPayload);
    payloadRef.current = nextPayload;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (dbRefPath && payloadRef.current) {
        set(ref(db, dbRefPath), payloadRef.current)
          .then(() => {
            console.log("Remote RTDB payload sync successful");
          })
          .catch((error) => {
            console.error("Remote RTDB payload sync failed:", error);
          })
          .finally(() => {
            timeoutRef.current = null;
          });
      }
    }, 1500);
  };

  return { payload, loading, savePayload };
}
