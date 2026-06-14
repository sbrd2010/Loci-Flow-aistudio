import { useState, useEffect, useRef } from "react";
import { ref, onValue, set, update, runTransaction, get, goOffline, goOnline } from "firebase/database";
import { db, auth } from "./firebase";
import { safeUUID } from "./utils/uuid";
import { normalizePayload, mergeRemotePayload, mergeRemotePayloadWithMeta, prepareBrainDumpForSave, isTaskCountDropSuspicious } from "./utils/normalizePayload";

// Connection phase exposed to UI: "connecting" | "connected" | "offline" | "error"
// This lets the app show specific messages at each stage instead of just "loading".
// Pure helper: returns payload only if it belongs to the current uid.
// Exported so it can be unit-tested independently of Firebase/React.
export function gatePayloadToUid(payload, payloadUid, currentUid) {
  if (!currentUid) return null;
  if (payloadUid !== currentUid) return null;
  return payload;
}

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
  // Timestamp of the last successful RTDB delivery — distinct from payload.timestamp
  // (which is when data was last *written*). This reflects "when did this device
  // last hear from the server", so "Last Sync" reads "just now" after a fresh login.
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  // Non-null when RTDB is unreachable with cached data ("offline") or a write failed ("write-failed").
  // Cleared on every successful RTDB delivery.
  const [syncWarning, setSyncWarning] = useState(null);

  const dbRefPath = uid ? `sync/${uid}` : null;

  const payloadRef = useRef(null);
  const timeoutRef = useRef(null);
  const pendingRemoteRef = useRef(null);
  // Tracks which uid the current `payload` state was loaded for.
  // Compared against the current uid in the return value — if they differ,
  // effectivePayload is null so App-level effects cannot read or write
  // a previous user's data during the uid-change render gap.
  const payloadUidRef = useRef(null);
  // Cached Firebase ID token — refreshed on each save so the pagehide
  // keepalive fetch has a valid token even if the page is being killed.
  const tokenRef = useRef(null);
  // Track if RTDB is physically connected (via .info/connected)
  const rtdbConnectedRef = useRef(false);
  // Mutable ref so the timeout callback can see the latest phase without stale closure
  const dataTimeoutRef = useRef(null);
  // Sync safety: detect premature savePayload calls during the isSyncingFromCache window.
  // Reset at the start of each uid effect so they clear on login/uid change.
  const hasReceivedFirstRtdbRef = useRef(false);
  const localWriteBeforeFirstRtdbRef = useRef(false);
  const offlineWarnTimeoutRef = useRef(null);

  useEffect(() => {
    if (!dbRefPath) {
      payloadRef.current = null;
      pendingRemoteRef.current = null;
      payloadUidRef.current = null;
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setLoading(false);
      return;
    }

    setLoading(true);
    setConnPhase(CONN.CONNECTING);
    setError(null);
    setIsSyncingFromCache(false);
    // Clear previous user's data immediately so the payload gate returns null
    // for the current render cycle before the new uid's data arrives.
    payloadRef.current = null;
    pendingRemoteRef.current = null;
    payloadUidRef.current = null;
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    rtdbConnectedRef.current = false;
    hasReceivedFirstRtdbRef.current = false;
    localWriteBeforeFirstRtdbRef.current = false;
    setSyncWarning(null);
    if (offlineWarnTimeoutRef.current) { clearTimeout(offlineWarnTimeoutRef.current); offlineWarnTimeoutRef.current = null; }
    const userRef = ref(db, dbRefPath);

    // Load from localStorage cache immediately — app is usable in <100ms on return visits.
    const rawCached = readCache(uid);
    const cached = rawCached ? normalizePayload(rawCached) : null;
    const hasCachedData = !!cached;
    if (hasCachedData) {
      payloadUidRef.current = uid;
      setPayload(cached);
      payloadRef.current = cached;
      setLoading(false);
      setIsSyncingFromCache(true);
      // If RTDB doesn't respond within 15s, surface a visible warning so the user
      // knows they're looking at potentially stale cached data (e.g. Brave Shields
      // blocking the connection on mobile).
      offlineWarnTimeoutRef.current = setTimeout(() => {
        if (!hasReceivedFirstRtdbRef.current) {
          setSyncWarning("offline");
          setIsSyncingFromCache(false); // unblock effects that guard on this flag
        }
      }, 15000);
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
      if (offlineWarnTimeoutRef.current) { clearTimeout(offlineWarnTimeoutRef.current); offlineWarnTimeoutRef.current = null; }
      setIsSyncingFromCache(false);
      setSyncWarning(null);
      setConnPhase(CONN.CONNECTED);
      setLastSyncedAt(Date.now());

      const data = snapshot.val();

      if (!timeoutRef.current) {
        if (data) {
          // Only apply if server data is at least as fresh as local state —
          // prevents a stale long-poll snapshot (e.g. after Brave reconnects) from
          // overwriting optimistic updates that haven't reached Firebase yet.
          if ((data.timestamp || 0) >= (payloadRef.current?.timestamp || 0)) {
            const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(data, payloadRef.current);
            const toApply = hasLocalContribution ? { ...merged, timestamp: Date.now() } : merged;
            payloadUidRef.current = uid;
            setPayload(toApply);
            payloadRef.current = toApply;
            pendingRemoteRef.current = null;
            writeCache(uid, toApply);
            if (hasLocalContribution && !timeoutRef.current) {
              writeWithRetry(ref(db, dbRefPath), toApply).catch(() => {});
            }
          } else {
            // Local timestamp appears newer than RTDB.
            if (!localWriteBeforeFirstRtdbRef.current) {
              // No savePayload fired during the cache-only window — local is genuinely
              // newer (app was killed before the last debounce flushed). Push it back.
              writeWithRetry(ref(db, dbRefPath), payloadRef.current).catch(() => {});
            } else {
              // savePayload fired before RTDB responded (e.g. a mount-effect on stale
              // cache), giving local a fake-fresh timestamp. Trust RTDB instead of
              // pushing the stale cache back up.
              const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(data, payloadRef.current);
              const toApply = hasLocalContribution ? { ...merged, timestamp: Date.now() } : merged;
              payloadUidRef.current = uid;
              setPayload(toApply);
              payloadRef.current = toApply;
              pendingRemoteRef.current = null;
              writeCache(uid, toApply);
              if (hasLocalContribution && !timeoutRef.current) {
                writeWithRetry(ref(db, dbRefPath), toApply).catch(() => {});
              }
            }
          }
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
          const now = Date.now();

          const defaultPayload = {
            userId: email,
            tasks: [
              {
                id: now,
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
                lastUpdated: now
              },
              {
                id: now + 1,
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
                lastUpdated: now
              },
              {
                id: now + 2,
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
                lastUpdated: now
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
              lastUpdated: now
            },
            contributions: [
              {
                compositeKey: `${email}_${yStr}`,
                userId: email,
                dateString: yStr,
                count: 3,
                lastUpdated: now
              },
              {
                compositeKey: `${email}_${d2Str}`,
                userId: email,
                dateString: d2Str,
                count: 1,
                lastUpdated: now
              }
            ],
            brainDump: [],
            brainDumpUpdatedAt: now,
            timestamp: now
          };

          payloadUidRef.current = uid;
          setPayload(defaultPayload);
          payloadRef.current = defaultPayload;
          writeCache(uid, defaultPayload);

          runTransaction(ref(db, dbRefPath), (current) => {
            if (current !== null) return;
            return defaultPayload;
          }).catch(err => console.error("Init transaction failed:", err));
        }
      } else {
        if (data) {
          if (localWriteBeforeFirstRtdbRef.current) {
            // A savePayload fired during the cache-only window before RTDB responded.
            // The pending debounce would push fake-fresh stale data to RTDB — cancel it
            // and let RTDB win instead, the same as the !timeoutRef path above.
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
            const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(data, payloadRef.current);
            const toApply = hasLocalContribution ? { ...merged, timestamp: Date.now() } : merged;
            payloadUidRef.current = uid;
            setPayload(toApply);
            payloadRef.current = toApply;
            pendingRemoteRef.current = null;
            writeCache(uid, toApply);
            if (hasLocalContribution) {
              writeWithRetry(ref(db, dbRefPath), toApply).catch(() => {});
            }
          } else {
            pendingRemoteRef.current = data;
          }
        }
      }
      hasReceivedFirstRtdbRef.current = true;
      // Reset so future legitimate local edits are never treated as suspicious.
      localWriteBeforeFirstRtdbRef.current = false;
      setLoading(false);
    }, (err) => {
      if (connTimeoutId) clearTimeout(connTimeoutId);
      if (dataTimeoutRef.current) { clearTimeout(dataTimeoutRef.current); dataTimeoutRef.current = null; }
      console.error("Error reading RTDB payload:", err);
      setIsSyncingFromCache(false); // unblock effects that wait for RTDB
      pendingRemoteRef.current = null;
      if (!hasCachedData) {
        setError("Could not connect to sync server. Check your connection and reload.");
        setConnPhase(CONN.ERROR);
        setLoading(false);
      } else {
        // Cached data is showing, but RTDB is unreachable — warn so the user knows
        // the data may be stale (e.g. Brave Shields blocking on mobile).
        setSyncWarning("offline");
      }
    });

    return () => {
      if (connTimeoutId) clearTimeout(connTimeoutId);
      if (dataTimeoutRef.current) clearTimeout(dataTimeoutRef.current);
      if (offlineWarnTimeoutRef.current) clearTimeout(offlineWarnTimeoutRef.current);
      unsubConn();
      unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [dbRefPath, uid, email]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending debounced write on tab close / mobile background / screen lock.
  // Also force-reconnects Firebase when the tab comes back after OS suspension —
  // on iOS/Android the long-poll silently drops while backgrounded, and Firebase's
  // auto-reconnect is unreliable after a deep sleep. goOffline+goOnline kicks it.
  useEffect(() => {
    let hiddenAt = 0;

    const flush = () => {
      if (!timeoutRef.current || !dbRefPath || !payloadRef.current) return;
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      const data = payloadRef.current;
      // keepalive: true guarantees delivery even when iOS/Android kills the page
      // mid-write. Falls back to the Firebase SDK if no token is cached yet.
      if (tokenRef.current) {
        const rtdbUrl = db.app.options.databaseURL;
        const url = `${rtdbUrl}/${dbRefPath}.json?auth=${tokenRef.current}`;
        fetch(url, {
          method: "PUT",
          body: JSON.stringify(data),
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(() => writeWithRetry(ref(db, dbRefPath), data).catch(() => {}));
      } else {
        writeWithRetry(ref(db, dbRefPath), data).catch(() => {});
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        flush();
      } else if (Date.now() - hiddenAt > 30_000 && dbRefPath) {
        // Small gap prevents Firebase internal state machine from getting stuck
        // when goOnline fires immediately after goOffline.
        goOffline(db);
        setTimeout(() => goOnline(db), 100);
      }
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
        set(ref(db, uidPath), normalizePayload({ ...legacyData, userId: uid })).then(() => {
          console.log("Migration: legacy data copied to uid path");
        }).catch(err => console.error("Migration write failed:", err));
      });
    }).catch(() => {});
  }, [uid, email]);

  const savePayload = (updatedPayload) => {
    // Track if savePayload fires before the first RTDB response — used in onValue
    // to distinguish a fake-fresh timestamp (from a premature mount effect) from a
    // legitimate unsaved edit (app killed before the last debounce flushed).
    if (!hasReceivedFirstRtdbRef.current) {
      localWriteBeforeFirstRtdbRef.current = true;
    }
    const brainDumpPatch = prepareBrainDumpForSave(updatedPayload, payloadRef.current);
    const safePayload = { ...updatedPayload, ...brainDumpPatch };
    const nextPayload = { ...normalizePayload(safePayload), timestamp: Date.now() };

    // Drop guard: block any full-payload write that would silently reduce the
    // active (non-deleted) task count by 3 or more. This catches stale-cache
    // overwrites that slipped past earlier defenses. User-triggered one-at-a-time
    // deletes never trigger this (they only drop by 1).
    if (payloadRef.current?.tasks && isTaskCountDropSuspicious(nextPayload.tasks, payloadRef.current.tasks)) {
      const currentActive = payloadRef.current.tasks.filter(t => !t.isDeleted).length;
      const nextActive = nextPayload.tasks.filter(t => !t.isDeleted).length;
      const nextUuids = new Set(nextPayload.tasks.map(t => t.uuid).filter(Boolean));
      const dropped = payloadRef.current.tasks.filter(t => !t.isDeleted && t.uuid && !nextUuids.has(t.uuid));
      console.error(
        `[Loci drop-guard] Blocked suspicious write — would reduce active tasks from ${currentActive} to ${nextActive} (drop: ${currentActive - nextActive}).\n` +
        `  Missing UUIDs:  ${dropped.map(t => t.uuid).join(", ")}\n` +
        `  Missing titles: ${dropped.map(t => t.title || "(untitled)").join(", ")}`
      );
      setSyncWarning("drop-guard");
      return;
    }

    payloadUidRef.current = uid;
    setPayload(nextPayload);
    payloadRef.current = nextPayload;

    // Keep local cache up-to-date immediately — protects against network loss
    if (uid) writeCache(uid, nextPayload);

    // Refresh the cached token so the pagehide keepalive flush is always fresh
    auth.currentUser?.getIdToken().then(t => { tokenRef.current = t; }).catch(() => {});

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      if (dbRefPath && payloadRef.current) {
        writeWithRetry(ref(db, dbRefPath), payloadRef.current)
          .then(() => console.log("Remote RTDB payload sync successful"))
          .catch((err) => { console.error("Remote RTDB payload sync failed after retries:", err); setSyncWarning("write-failed"); })
          .finally(() => {
            timeoutRef.current = null;
            if (pendingRemoteRef.current) {
              const remote = pendingRemoteRef.current;
              pendingRemoteRef.current = null;
              if ((remote.timestamp || 0) >= (payloadRef.current?.timestamp || 0)) {
                const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(remote, payloadRef.current);
                const toApply = hasLocalContribution ? { ...merged, timestamp: Date.now() } : merged;
                payloadUidRef.current = uid;
                setPayload(toApply);
                payloadRef.current = toApply;
                if (uid) writeCache(uid, toApply);
                if (hasLocalContribution && !timeoutRef.current) {
                  writeWithRetry(ref(db, dbRefPath), toApply).catch(() => {});
                }
              }
            }
          });
      }
    }, 1500);
  };

  const saveSubPath = (subPath, value) => {
    if (!dbRefPath) return;
    // Mirror the update locally: update both the mutable ref and React state so
    // the UI re-renders immediately (same as savePayload, but without touching tasks).
    if (payloadRef.current) {
      const next = { ...payloadRef.current, [subPath]: value, timestamp: Date.now() };
      payloadRef.current = next;
      payloadUidRef.current = uid;
      setPayload(next);
      if (uid) writeCache(uid, next);
    }
    const updates = {
      [`${dbRefPath}/${subPath}`]: value,
      [`${dbRefPath}/timestamp`]: Date.now()
    };
    const attempt = (n) =>
      update(ref(db), updates).catch(err => {
        if (n > 0) return new Promise(r => setTimeout(r, 500 * Math.pow(2, 3 - n))).then(() => attempt(n - 1));
        console.error(`Sub-path write failed (${subPath}):`, err);
        setSyncWarning("write-failed");
      });
    attempt(3);
  };

  // Like saveSubPath, but writes several top-level paths in a single atomic
  // RTDB update() — use when multiple paths must change together (e.g. a task
  // completion that also bumps today's contribution count).
  const saveSubPaths = (patch) => {
    if (!dbRefPath) return;
    if (payloadRef.current) {
      const next = { ...payloadRef.current, ...patch, timestamp: Date.now() };
      payloadRef.current = next;
      payloadUidRef.current = uid;
      setPayload(next);
      if (uid) writeCache(uid, next);
    }
    const updates = { [`${dbRefPath}/timestamp`]: Date.now() };
    for (const [subPath, value] of Object.entries(patch)) {
      updates[`${dbRefPath}/${subPath}`] = value;
    }
    const attempt = (n) =>
      update(ref(db), updates).catch(err => {
        if (n > 0) return new Promise(r => setTimeout(r, 500 * Math.pow(2, 3 - n))).then(() => attempt(n - 1));
        console.error(`Sub-paths write failed (${Object.keys(patch).join(", ")}):`, err);
        setSyncWarning("write-failed");
      });
    attempt(3);
  };

  // Like saveSubPath("config", ...), but merges `patch` into the LATEST known
  // config (payloadRef.current.config) rather than a caller-held snapshot, and
  // writes only those keys to RTDB as nested config/<key> paths. This means a
  // caller holding a stale config (e.g. a component that unmounted while an
  // async reply was in flight) can't clobber config fields changed elsewhere
  // in the meantime — only the patched keys are touched.
  //
  // `patch` may also be a function `(latestConfig) => patch` — for callers
  // whose patch is itself derived from current config (e.g. appending to a
  // list stored in config), so that derivation also uses the latest known
  // config rather than a stale caller-held snapshot.
  const saveConfigPatch = (patch) => {
    if (!dbRefPath) return;
    const resolvedPatch = typeof patch === "function" ? patch(payloadRef.current?.config || {}) : patch;
    // Mirrors savePayload's guard: if RTDB hasn't delivered its first snapshot
    // yet, this bumps payloadRef.current.timestamp on top of (possibly stale)
    // cached data. Without this flag, the first RTDB snapshot could then look
    // "older" than the cache, causing onValue to push the whole stale cached
    // payload back over newer data from another device.
    if (!hasReceivedFirstRtdbRef.current) {
      localWriteBeforeFirstRtdbRef.current = true;
    }
    if (payloadRef.current) {
      const next = {
        ...payloadRef.current,
        config: { ...payloadRef.current.config, ...resolvedPatch, lastUpdated: Date.now() },
        timestamp: Date.now(),
      };
      payloadRef.current = next;
      payloadUidRef.current = uid;
      setPayload(next);
      if (uid) writeCache(uid, next);
    }
    const updates = { [`${dbRefPath}/timestamp`]: Date.now(), [`${dbRefPath}/config/lastUpdated`]: Date.now() };
    for (const [key, value] of Object.entries(resolvedPatch)) {
      updates[`${dbRefPath}/config/${key}`] = value;
    }
    const attempt = (n) =>
      update(ref(db), updates).catch(err => {
        if (n > 0) return new Promise(r => setTimeout(r, 500 * Math.pow(2, 3 - n))).then(() => attempt(n - 1));
        console.error(`Config-patch write failed (${Object.keys(resolvedPatch).join(", ")}):`, err);
        setSyncWarning("write-failed");
      });
    attempt(3);
  };

  // Write any pending debounced payload immediately (call before navigating away).
  const flushNow = () => {
    if (timeoutRef.current && dbRefPath && payloadRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      writeWithRetry(ref(db, dbRefPath), payloadRef.current).catch(() => {});
    }
  };

  // Remove this user's localStorage cache — call on logout so stale data
  // can't be loaded by the next person who opens the app on this device.
  const clearCache = () => {
    if (uid) {
      try { localStorage.removeItem(cacheKey(uid)); } catch {}
    }
  };

  // Gate payload: if the stored payload belongs to a different uid (uid-change render gap),
  // return null so App-level effects cannot read or write the previous user's data.
  const effectivePayload = gatePayloadToUid(payload, payloadUidRef.current, uid);
  const effectiveLoading = loading || (!!uid && payloadUidRef.current !== uid);
  return { payload: effectivePayload, loading: effectiveLoading, error, connPhase, isSyncingFromCache, lastSyncedAt, syncWarning, savePayload, saveSubPath, saveSubPaths, saveConfigPatch, flushNow, clearCache };
}
