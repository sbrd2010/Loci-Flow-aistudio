import { useState, useEffect, useRef } from "react";
import { ref, onValue, set, update, runTransaction, get, goOffline, goOnline } from "firebase/database";
import { db } from "./firebase";
import { safeUUID } from "./utils/uuid";
import { normalizePayload, mergeRemotePayload, mergeRemotePayloadWithMeta, prepareBrainDumpForSave, isTaskCountDropSuspicious, configValuesEqual, mergeLocalIntoServer, clampConfigStringsForRules, sanitizeChatHistoryForRules, applyEditsSince } from "./utils/normalizePayload";
import { activitySnapshotPath, activityMetaPath, buildTodaySnapshot } from "./utils/activityLog";

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

// Full-payload write, retried up to `retries` times with exponential backoff
// (500ms, 1s, 2s). Runs as a transaction that merges `data` into whatever
// sync/{uid} holds at that moment (see mergeLocalIntoServer) instead of a
// blind set(): a set() from a device that had missed a delivery — offline,
// asleep, or mid-debounce when the other device wrote — replaced the other
// device's tasks with this device's stale copy, and only an open tab on the
// other device could repair it. `base` is the { config, contributions } this
// device last agreed with RTDB on, so the merge can tell its own edits from drift.
// applyLocally:false — local state already holds the optimistic value, so
// only the server-confirmed result should come back through onValue.
// Resolves with the committed payload — what the server holds after the merge, which may differ
// from `data` — so a caller recording the agreed base uses that, not `data`.
// Exported so the merge-on-write contract can be unit-tested directly.
export async function writeWithRetry(dbRef, data, base, { retries = 3 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await runTransaction(
        dbRef,
        (current) => mergeLocalIntoServer(current, data, base),
        { applyLocally: false }
      );
      // A resolved-but-uncommitted result (the SDK reports an aborted
      // transaction this way in some cases) is a failed write, not a success:
      // treating it as one would resolve savePayloadAsync waiters for a
      // mutation that never reached RTDB. Retry it like a rejection.
      if (result && result.committed === false) throw new Error("transaction not committed");
      return result && result.snapshot ? result.snapshot.val() : undefined;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
}

// Best-effort, write-once "instrumentation started" marker — the first
// timestamp at which any ledger event/snapshot was ever successfully
// written for this user. Future UI/analytics reading the ledger must check
// this (activityMetaPath(uid, "instrumentationStartedAt")) and never imply
// ledger-derived detail exists before it. Uses the same runTransaction
// "abort if already set" pattern as the daily snapshot below, so it's safe
// to call after every successful write without ever overwriting an
// existing marker — and it never throws, since a failure here must not
// affect the write that already succeeded and triggered this call.
async function markInstrumentationStartedIfNeeded(uid) {
  try {
    await runTransaction(ref(db, activityMetaPath(uid, "instrumentationStartedAt")), (current) => {
      if (current !== null) return; // already set (this device or another) — abort
      return Date.now();
    });
  } catch (err) {
    console.error("[Loci activity ledger] Failed to set instrumentationStartedAt:", err);
  }
}

// Analytics-only write: one or more explicit RTDB paths (already fully
// qualified, e.g. via activityEventPath()/activitySnapshotPath()) written in
// a single update() call under activityLogs/${uid}/... — entirely separate
// from the sync/${uid} root and never mixed into the same update() as a
// task write. Fails soft: on final retry failure this logs a missed-event
// record and resolves with { ok: false } rather than rejecting, so a caller
// sequencing this after a confirmed core write can never have an analytics
// failure surface as if the core action failed. Kept as a standalone,
// uid-parameterized function (not a hook closure) so it can be unit-tested
// directly against mocked firebase/database calls.
export async function writeActivityEvents(uid, pathsToValues, retries = 3) {
  if (!uid) return { ok: false, reason: "no-uid" };
  // update({}) resolves as a successful no-op — a caller passing an empty
  // patch (e.g. eventsPatch(uid, []) when a batch action found no affected
  // tasks) must not mark instrumentation as started for zero actual writes.
  if (!pathsToValues || Object.keys(pathsToValues).length === 0) return { ok: true, skipped: true };
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await update(ref(db), pathsToValues);
      markInstrumentationStartedIfNeeded(uid); // fire-and-forget, never blocks/affects this result
      return { ok: true };
    } catch (err) {
      if (attempt === retries - 1) {
        console.error("[Loci activity ledger] Missed event(s) after retries:", Object.keys(pathsToValues), err);
        return { ok: false, reason: "write-failed", error: err };
      }
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
}

// Captures the once-per-Loci-day "Today" snapshot that directly serves as
// that day's carryover set (see activityLog.js / the Insights plan).
// Guarded by runTransaction so two devices racing to capture the same day's
// first snapshot can't both write — the loser's transaction sees a non-null
// existing value and aborts by returning undefined. Fails soft, same
// rationale as writeActivityEvents. Standalone for the same testability
// reason as writeActivityEvents above.
export async function captureTodaySnapshotIfNeeded(uid, tasks, windows) {
  if (!uid) return { ok: false, reason: "no-uid" };
  const snapshot = buildTodaySnapshot(tasks, { windows });
  try {
    const result = await runTransaction(ref(db, activitySnapshotPath(uid, snapshot.lociDateString)), (current) => {
      if (current !== null) return; // already captured (this device or another) — abort
      return snapshot;
    });
    markInstrumentationStartedIfNeeded(uid); // fire-and-forget, never blocks/affects this result
    return { ok: true, committed: result.committed };
  } catch (err) {
    console.error("[Loci activity ledger] Snapshot capture failed:", err);
    return { ok: false, reason: "write-failed", error: err };
  }
}

const cacheKey = (uid) => `loci_payload_v1_${uid}`;
// The cache record pairs the payload with the merge base it was built on —
// the config and contribution rows this device last agreed with RTDB on
// (see mergeConfig / mergeConfigForWrite / mergeContributionsForWrite). They
// are written in one setItem so a kill or quota failure between two writes
// can never pair one generation's payload with another's base. A record from
// before the base existed reads back with base null. Exported for unit tests.
const CACHE_RECORD_VERSION = 2;

export function readCache(uid) {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const data = JSON.parse(raw);
    const isRecord = data && data.__v === CACHE_RECORD_VERSION;
    const payload = isRecord ? data.payload : data;
    // Require at minimum tasks + config to be considered valid cache
    if (!payload || !payload.tasks || !payload.config) return null;
    const base = isRecord && data.base && typeof data.base === "object" ? data.base : null;
    return { payload, base };
  } catch {
    return null;
  }
}

export function writeCache(uid, payload, base) {
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify({ __v: CACHE_RECORD_VERSION, payload, base: base || null }));
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
  // Track if RTDB is physically connected (via .info/connected)
  const rtdbConnectedRef = useRef(false);
  // Mutable ref so the timeout callback can see the latest phase without stale closure
  const dataTimeoutRef = useRef(null);
  // Sync safety: detect premature savePayload calls during the isSyncingFromCache window.
  // Reset at the start of each uid effect so they clear on login/uid change.
  const hasReceivedFirstRtdbRef = useRef(false);
  const localWriteBeforeFirstRtdbRef = useRef(false);
  const offlineWarnTimeoutRef = useRef(null);
  // Merge base: the last server state this device has seen — { config,
  // contributions, brainDump } from the latest delivery or the committed
  // result of its own latest write, always absorbed into local state first.
  // Used per key by mergeConfig / mergeConfigForWrite, per day by
  // mergeContributions and per item by mergeBrainDump. Persisted in the same
  // cache record as the payload so a fresh mount from cache has the base that
  // cache was built on; cleared with the cache on sign-out.
  const baseRef = useRef(null);
  // The uid of the latest render, so a write or delivery callback created in
  // an earlier render (before an account switch) can tell it is stale.
  const uidRef = useRef(uid);
  uidRef.current = uid;
  // Counts adopted deliveries. A write captures it when it starts; if it has
  // moved by the time the write's promise resolves, a newer delivery was
  // adopted meanwhile and the (older) committed payload must not be absorbed
  // over it — the echo of the write, or that delivery, already carries it.
  const deliverySeqRef = useRef(0);

  // Records the config both sides now agree on (post-merge, since any local keys
  // the merge re-applied are written straight back to RTDB), so the next
  // delivery can tell this device's real edits from stale drift.
  //
  // `forUid` pins the commit to the account it was computed for: this runs from
  // a write-back callback that can resolve after a sign-out or account switch,
  // and without the check it would seed the *next* account's merge with the
  // previous account's config.
  // Adopts `payload` — a delivery from RTDB, or the committed result of this
  // device's own write — as the merge base, without touching the cache. The
  // base is the last server state this device has seen; the invariant every
  // caller keeps is that local state has already absorbed that state, so the
  // only differences between local and base are this device's own edits,
  // which is exactly what the per-key merges re-apply.
  const adoptBase = (payload, forUid) => {
    if (forUid !== uidRef.current || !payload || typeof payload !== "object") return false;
    const normalized = normalizePayload(payload);
    baseRef.current = {
      config: normalized.config,
      contributions: normalized.contributions,
      brainDump: normalized.brainDump,
    };
    return true;
  };

  // For the two paths that make the local payload the server's (new account,
  // cache restore): base := local, then one cache write pairing them.
  const commitBase = (payload, forUid) => {
    if (!adoptBase(payload, forUid)) return;
    if (payloadRef.current) writeCache(forUid, payloadRef.current, baseRef.current);
  };

  // What a full write needs to carry to its completion: the payload it
  // submitted and the delivery count at the time.
  const beginWrite = (written) => ({ written, seq: deliverySeqRef.current, uid: uidRef.current });

  // After this device's own write commits: `committed` is what the server now
  // holds — the submitted payload merged with whatever the other device had
  // written meanwhile. It must reach local state BEFORE it becomes the base,
  // through the same merge a delivery goes through, or the echo of this write
  // (buffered while a debounce timer is pending, so processed after this)
  // would read local's older copies of the other device's changes as this
  // device's edits and write them back. Edits made here after the payload was
  // submitted are newer than anything the commit carries and are re-applied
  // on top (applyEditsSince); their own debounce is pending, so no write-back
  // here. Skipped when a newer delivery was adopted while the write was in
  // flight: absorbing the older commit over it would move state backwards.
  const absorbCommitted = (committed, ctx) => {
    if (!ctx || ctx.uid !== uidRef.current || !committed || typeof committed !== "object" || !payloadRef.current) return;
    if (ctx.seq !== deliverySeqRef.current) return;
    const base = baseRef.current;
    const local = payloadRef.current;
    const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(committed, local, base?.config, base?.contributions, base?.brainDump);
    const withEdits = applyEditsSince(merged, local, ctx.written);
    const toApply = hasLocalContribution ? { ...withEdits, timestamp: Date.now() } : withEdits;
    payloadUidRef.current = ctx.uid;
    setPayload(toApply);
    payloadRef.current = toApply;
    adoptBase(committed, ctx.uid);
    writeCache(ctx.uid, toApply, baseRef.current);
  };

  // Applies a delivery: the merged payload becomes local state, the delivered
  // server state becomes the base, and both go into the cache in one write.
  // If the merge re-applied local edits the server has not seen, they are
  // written back through the merging transaction (unless a debounced write
  // is already pending, which will carry them).
  const applyDelivery = (data, toApply, hasLocalContribution) => {
    payloadUidRef.current = uid;
    setPayload(toApply);
    payloadRef.current = toApply;
    pendingRemoteRef.current = null;
    adoptBase(data, uid);
    deliverySeqRef.current += 1;
    writeCache(uid, toApply, baseRef.current);
    if (!hasLocalContribution || timeoutRef.current) return;
    const ctx = beginWrite(toApply);
    writeWithRetry(ref(db, dbRefPath), toApply, baseRef.current)
      .then((committed) => absorbCommitted(committed, ctx))
      .catch(() => {});
  };
  // Resolvers for savePayloadAsync calls queued behind the current debounce
  // timer — settled together when that (possibly-coalesced) write lands.
  const pendingWriteWaitersRef = useRef([]);

  // Drains and rejects any savePayloadAsync waiters still queued behind the
  // debounce timer being canceled below (sign-out or account switch before
  // the 1500ms flush fired). Without this, a stale waiter for the PREVIOUS
  // user's canceled write sits in pendingWriteWaitersRef (it isn't reset by
  // this effect otherwise) until some later, unrelated scheduleFlush() for
  // the NEW user's data resolves it via takeWaiters() — falsely telling the
  // original caller its write succeeded, and letting its .then() write a
  // ledger event for a mutation that never actually persisted.
  const rejectStaleWriteWaiters = () => {
    const staleWaiters = pendingWriteWaitersRef.current;
    if (staleWaiters.length === 0) return;
    pendingWriteWaitersRef.current = [];
    staleWaiters.forEach(w => w.reject(new Error("savePayloadAsync: canceled by uid change")));
  };

  useEffect(() => {
    if (!dbRefPath) {
      payloadRef.current = null;
      pendingRemoteRef.current = null;
      payloadUidRef.current = null;
      baseRef.current = null;
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      rejectStaleWriteWaiters();
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
    rejectStaleWriteWaiters();
    rtdbConnectedRef.current = false;
    hasReceivedFirstRtdbRef.current = false;
    localWriteBeforeFirstRtdbRef.current = false;
    // The base is restored below together with the payload cache it belongs
    // to; without a cache nothing is known to be shared with RTDB yet.
    baseRef.current = null;
    setSyncWarning(null);
    if (offlineWarnTimeoutRef.current) { clearTimeout(offlineWarnTimeoutRef.current); offlineWarnTimeoutRef.current = null; }
    const userRef = ref(db, dbRefPath);

    // Load from localStorage cache immediately — app is usable in <100ms on return visits.
    const cachedRecord = readCache(uid);
    const cached = cachedRecord ? normalizePayload(cachedRecord.payload) : null;
    const hasCachedData = !!cached;
    if (hasCachedData) {
      payloadUidRef.current = uid;
      setPayload(cached);
      payloadRef.current = cached;
      baseRef.current = cachedRecord.base;
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
            const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(data, payloadRef.current, baseRef.current?.config, baseRef.current?.contributions, baseRef.current?.brainDump);
            const toApply = hasLocalContribution ? { ...merged, timestamp: Date.now() } : merged;
            applyDelivery(data, toApply, hasLocalContribution);
          } else {
            // Local timestamp appears newer than RTDB.
            if (!localWriteBeforeFirstRtdbRef.current) {
              // No savePayload fired during the cache-only window — local is genuinely
              // newer (app was killed before the last debounce flushed). Push it back,
              // merged against the persisted base so an offline config edit such as a
              // renamed Key Deadline is recognised as this device's own and kept.
              const ctx = beginWrite(payloadRef.current);
              writeWithRetry(ref(db, dbRefPath), payloadRef.current, baseRef.current)
                .then((committed) => absorbCommitted(committed, ctx))
                .catch(() => {});
            } else {
              // savePayload fired before RTDB responded (e.g. a mount-effect on stale
              // cache), giving local a fake-fresh timestamp. Trust RTDB instead of
              // pushing the stale cache back up.
              const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(data, payloadRef.current, baseRef.current?.config, baseRef.current?.contributions, baseRef.current?.brainDump);
              const toApply = hasLocalContribution ? { ...merged, timestamp: Date.now() } : merged;
              applyDelivery(data, toApply, hasLocalContribution);
            }
          }
        } else if (hasCachedData) {
          // RTDB is empty (new device or cleared DB) but we have local cache —
          // restore it to RTDB so the user's data isn't lost.
          runTransaction(ref(db, dbRefPath), (current) => {
            if (current !== null) return; // another device already initialized
            return payloadRef.current;
          }).catch(err => console.error("Cache restore to RTDB failed:", err));
          // payloadRef.current is already set from cache; leave payload as-is.
          // The cache is being made authoritative here, so it becomes the base:
          // nothing in it is a pending local edit any more.
          commitBase(payloadRef.current, uid);
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
          writeCache(uid, defaultPayload, baseRef.current);
          commitBase(defaultPayload, uid);

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
            // The debounced write this cancels never reached RTDB, and the
            // local edit it carried may or may not survive the merge below
            // (only re-persisted if mergeRemotePayloadWithMeta finds a real
            // local contribution) — reject rather than resolve, so any
            // savePayloadAsync() caller's .then() (which would fire an
            // activity-ledger event claiming the write succeeded) correctly
            // doesn't run for a write that was never confirmed.
            takeWaiters().forEach(w => w.reject(new Error("savePayloadAsync: superseded by RTDB before first sync")));
            const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(data, payloadRef.current, baseRef.current?.config, baseRef.current?.contributions, baseRef.current?.brainDump);
            const toApply = hasLocalContribution ? { ...merged, timestamp: Date.now() } : merged;
            applyDelivery(data, toApply, hasLocalContribution);
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
  //
  // This used to send a keepalive REST PUT of the whole payload so the write
  // survived the page being killed. A PUT is a blind overwrite, and a tab
  // resumed from background is exactly the one likely to hold a stale copy —
  // so it could replace what another device had written since, the loss this
  // file's merge-on-write exists to remove. The flush now goes through the
  // same merging transaction as every other save. If the page dies before it
  // lands, the edit is already in the localStorage cache, and the next mount
  // pushes it back merged (the "local newer" path in onValue); the cost is
  // that the other device sees it only then, not immediately.
  useEffect(() => {
    let hiddenAt = 0;

    const flush = () => {
      if (!timeoutRef.current || !dbRefPath || !payloadRef.current) return;
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      // Any savePayloadAsync() callers queued behind the debounce timer this
      // is preempting must still settle — otherwise a tab backgrounded (not
      // necessarily closed — visibilitychange "hidden" fires on a simple
      // phone lock too) within the 1500ms window leaves their promise
      // hanging forever, silently dropping whatever .then() was waiting to
      // fire an activity-ledger event.
      const waiters = takeWaiters();
      const ctx = beginWrite(payloadRef.current);
      writeWithRetry(ref(db, dbRefPath), payloadRef.current, baseRef.current)
        .then((committed) => { absorbCommitted(committed, ctx); waiters.forEach(w => w.resolve()); })
        .catch((err) => waiters.forEach(w => w.reject(err)));
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

  // Shared local-apply step for savePayload/savePayloadAsync: normalizes,
  // runs the drop-guard, and — if not blocked — updates optimistic
  // state/cache exactly as before. Returns { blocked: true } if the
  // drop-guard rejected the write (nothing was applied), otherwise
  // { blocked: false, nextPayload }.
  const applyPayloadLocally = (updatedPayload) => {
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
      return { blocked: true };
    }

    payloadUidRef.current = uid;
    setPayload(nextPayload);
    payloadRef.current = nextPayload;

    // Keep local cache up-to-date immediately — protects against network loss
    if (uid) writeCache(uid, nextPayload, baseRef.current);

    return { blocked: false, nextPayload };
  };

  // Detaches the current batch of savePayloadAsync waiters so whoever
  // preempts the debounce timer (the timer firing normally, or an early
  // flush/flushNow) can settle exactly the callers queued behind it, without
  // a later scheduleFlush() call re-queuing into an already-settled batch.
  const takeWaiters = () => {
    const waiters = pendingWriteWaitersRef.current;
    pendingWriteWaitersRef.current = [];
    return waiters;
  };

  // Shared debounced-flush scheduler for savePayload/savePayloadAsync. Every
  // call within the 1500ms window clears and reschedules the timer, so rapid
  // successive calls coalesce into a single RTDB write — identical to the
  // original savePayload behavior. Any savePayloadAsync callers queued in
  // pendingWriteWaitersRef settle together when that write lands.
  //
  // What this means for callers sequencing an activity-ledger event after
  // the promise resolves (deliberate, accepted tradeoff — not a bug): if two
  // savePayloadAsync calls land in the same debounce window (e.g. delete
  // then undo within 1.5s, or rapid complete/reopen), only ONE RTDB write
  // goes out, carrying whatever payloadRef.current holds at flush time — the
  // LATEST call's cumulative state, which already incorporates every earlier
  // queued call's changes (each call's optimistic update was applied to
  // payloadRef.current synchronously in applyPayloadLocally before this
  // timer fires). Every queued waiter resolves together off that single
  // write's outcome, so each caller's .then() correctly represents "a write
  // that includes my change eventually succeeded" — not "my own exact
  // intermediate payload state was independently persisted as its own RTDB
  // write." The resulting ledger sequence (e.g. task_deleted then
  // task_restored) still accurately reflects the real order of user actions,
  // and is consistent with the single persisted final state — it's a looser
  // guarantee than a literal 1:1 write-per-call, but not a data-integrity
  // bug, and was a deliberate call not to break debounce-coalescing to
  // chase it (see PR #358 review discussion).
  const scheduleFlush = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      const waiters = takeWaiters();
      if (dbRefPath && payloadRef.current) {
        const ctx = beginWrite(payloadRef.current);
        writeWithRetry(ref(db, dbRefPath), payloadRef.current, baseRef.current)
          .then((committed) => {
            console.log("Remote RTDB payload sync successful");
            // Absorb what the server now holds (and make it the base) before the
            // echo of this write, buffered below while the timer was pending, is
            // processed — or discarded, if a newer local edit raised the local
            // timestamp while the write was in flight.
            absorbCommitted(committed, ctx);
            waiters.forEach(w => w.resolve());
          })
          .catch((err) => {
            console.error("Remote RTDB payload sync failed after retries:", err);
            setSyncWarning("write-failed");
            waiters.forEach(w => w.reject(err));
          })
          .finally(() => {
            timeoutRef.current = null;
            if (pendingRemoteRef.current) {
              const remote = pendingRemoteRef.current;
              pendingRemoteRef.current = null;
              if ((remote.timestamp || 0) >= (payloadRef.current?.timestamp || 0)) {
                const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(remote, payloadRef.current, baseRef.current?.config, baseRef.current?.contributions, baseRef.current?.brainDump);
                const toApply = hasLocalContribution ? { ...merged, timestamp: Date.now() } : merged;
                applyDelivery(remote, toApply, hasLocalContribution);
              }
            }
          });
      } else {
        // No RTDB write happened here (no dbRefPath/payloadRef.current at
        // flush time) — resolving these waiters would tell a
        // savePayloadAsync() caller its write succeeded when it didn't,
        // violating the "ledger write only after a confirmed core write"
        // contract this file's async helpers exist for. Currently
        // unreachable in practice (dbRefPath is only ever null when uid is
        // falsy, and every real savePayloadAsync call site is gated behind
        // an authenticated user), but reject rather than silently lie if
        // that ever changes.
        waiters.forEach(w => w.reject(new Error("savePayloadAsync: no active sync target")));
      }
    }, 1500);
  };

  const savePayload = (updatedPayload) => {
    const result = applyPayloadLocally(updatedPayload);
    if (result.blocked) return;
    scheduleFlush();
  };

  // Same as savePayload, but returns a promise that resolves once the
  // (possibly debounce-coalesced) write actually reaches RTDB, or rejects if
  // the drop-guard blocked it or the write ultimately failed after retries.
  // Never call this AND savePayload for the same logical action — that would
  // duplicate the write.
  const savePayloadAsync = (updatedPayload) => {
    const result = applyPayloadLocally(updatedPayload);
    if (result.blocked) {
      return Promise.reject(new Error("savePayloadAsync: write blocked by drop-guard"));
    }
    return new Promise((resolve, reject) => {
      pendingWriteWaitersRef.current.push({ resolve, reject });
      scheduleFlush();
    });
  };

  // Sub-path writes bypass normalizePayload, so the rule caps it applies to
  // config strings and chat messages are applied here too — otherwise one
  // over-long Coach reply or name written this way lands in local state and
  // fails every later full-payload write.
  const sanitizeSubPathValue = (subPath, value) => {
    if (subPath === "chatHistory") return sanitizeChatHistoryForRules(value);
    if (subPath === "config") return clampConfigStringsForRules(value);
    return value;
  };

  // Shared primitive for saveSubPath/saveSubPathAsync: applies the optimistic
  // local update, then writes to RTDB with retry, returning the write promise
  // (rejects on final failure — callers decide whether to swallow or await).
  const performSubPathWrite = (subPath, rawValue) => {
    if (!dbRefPath) return Promise.resolve();
    const value = sanitizeSubPathValue(subPath, rawValue);
    // Mirror the update locally: update both the mutable ref and React state so
    // the UI re-renders immediately (same as savePayload, but without touching tasks).
    if (payloadRef.current) {
      const next = { ...payloadRef.current, [subPath]: value, timestamp: Date.now() };
      payloadRef.current = next;
      payloadUidRef.current = uid;
      setPayload(next);
      if (uid) writeCache(uid, next, baseRef.current);
    }
    const updates = {
      [`${dbRefPath}/${subPath}`]: value,
      [`${dbRefPath}/timestamp`]: Date.now()
    };
    const attempt = (n) =>
      update(ref(db), updates).catch(err => {
        if (n > 0) return new Promise(r => setTimeout(r, 500 * Math.pow(2, 3 - n))).then(() => attempt(n - 1));
        // Set here (not just in the sync saveSubPath wrapper below) so the
        // user-facing sync warning fires the same way regardless of which
        // entry point failed — saveSubPathAsync's callers all swallow their
        // own rejection (.catch(() => {})) to sequence an analytics write,
        // which previously meant a real write failure via that path set no
        // warning at all. Matches savePayload/savePayloadAsync's already-
        // shared scheduleFlush failure handling.
        console.error(`Sub-path write failed (${subPath}):`, err);
        setSyncWarning("write-failed");
        throw err;
      });
    return attempt(3);
  };

  const saveSubPath = (subPath, value) => {
    performSubPathWrite(subPath, value).catch(() => {});
  };

  // Same as saveSubPath, but returns the write promise so a caller can await
  // confirmed success/failure (e.g. to sequence an analytics follow-up write).
  // Never call this AND saveSubPath for the same logical write.
  const saveSubPathAsync = (subPath, value) => performSubPathWrite(subPath, value);

  // Shared primitive for saveSubPaths/saveSubPathsAsync — writes several
  // top-level paths in a single atomic RTDB update() — use when multiple
  // paths must change together (e.g. a task completion that also bumps
  // today's contribution count).
  const performSubPathsWrite = (rawPatch) => {
    if (!dbRefPath) return Promise.resolve();
    const patch = Object.fromEntries(
      Object.entries(rawPatch).map(([subPath, value]) => [subPath, sanitizeSubPathValue(subPath, value)])
    );
    if (payloadRef.current) {
      const next = { ...payloadRef.current, ...patch, timestamp: Date.now() };
      payloadRef.current = next;
      payloadUidRef.current = uid;
      setPayload(next);
      if (uid) writeCache(uid, next, baseRef.current);
    }
    const updates = { [`${dbRefPath}/timestamp`]: Date.now() };
    for (const [subPath, value] of Object.entries(patch)) {
      updates[`${dbRefPath}/${subPath}`] = value;
    }
    const attempt = (n) =>
      update(ref(db), updates).catch(err => {
        if (n > 0) return new Promise(r => setTimeout(r, 500 * Math.pow(2, 3 - n))).then(() => attempt(n - 1));
        // Set here, not just in the sync saveSubPaths wrapper below — see the
        // matching comment on performSubPathWrite above. saveSubPathsAsync is
        // used by CoachTab's chat-tag resolution, whose caller swallows its
        // own rejection to sequence an analytics write; without this, a real
        // multi-path write failure there set no user-facing warning at all.
        console.error(`Sub-paths write failed (${Object.keys(patch).join(", ")}):`, err);
        setSyncWarning("write-failed");
        throw err;
      });
    return attempt(3);
  };

  const saveSubPaths = (patch) => {
    performSubPathsWrite(patch).catch(() => {});
  };

  // Same as saveSubPaths, but returns the write promise. Never call this AND
  // saveSubPaths for the same logical write.
  const saveSubPathsAsync = (patch) => performSubPathsWrite(patch);

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
    const latestConfig = payloadRef.current?.config || {};
    // Clamped before the no-op comparison so an over-long name is compared,
    // stored and written at the length the rules accept.
    const requestedPatch = clampConfigStringsForRules(typeof patch === "function" ? patch(latestConfig) : patch);
    // Drop keys whose value already matches the latest known config. Callers
    // that hand back a whole rebuilt config (the build*(latestConfig) helpers)
    // would otherwise re-write every field, and a field this device merely
    // hasn't received an update for yet would be pushed back at its old value —
    // reverting, say, a Key Deadline just changed on another device. Skipping
    // no-ops is free locally (the value is identical either way) and shrinks
    // each write to the keys the caller actually meant to change.
    const resolvedPatch = {};
    const patchEntries = requestedPatch && typeof requestedPatch === "object" ? Object.entries(requestedPatch) : [];
    for (const [key, value] of patchEntries) {
      if (configValuesEqual(latestConfig[key], value)) continue;
      resolvedPatch[key] = value;
    }
    // Nothing actually changed — an empty patch would still bump lastUpdated
    // and timestamp, making this device look newer than it is to every merge.
    if (Object.keys(resolvedPatch).length === 0) return;
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
      if (uid) writeCache(uid, next, baseRef.current);
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
  // Also settles any savePayloadAsync() callers queued behind the timer this
  // preempts — otherwise their promise (and whatever .then() was waiting to
  // fire an activity-ledger event) would hang forever, since this timer will
  // never fire on its own now that it's been cleared.
  const flushNow = () => {
    if (timeoutRef.current && dbRefPath && payloadRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      const waiters = takeWaiters();
      const ctx = beginWrite(payloadRef.current);
      writeWithRetry(ref(db, dbRefPath), payloadRef.current, baseRef.current)
        .then((committed) => { absorbCommitted(committed, ctx); waiters.forEach(w => w.resolve()); })
        .catch((err) => waiters.forEach(w => w.reject(err)));
    }
  };

  // Remove this user's localStorage cache — call on logout so stale data
  // can't be loaded by the next person who opens the app on this device.
  const clearCache = () => {
    if (uid) {
      try { localStorage.removeItem(cacheKey(uid)); } catch {}
      // The base lives in the record just dropped, so it must go too.
      baseRef.current = null;
    }
  };

  // Gate payload: if the stored payload belongs to a different uid (uid-change render gap),
  // return null so App-level effects cannot read or write the previous user's data.
  const effectivePayload = gatePayloadToUid(payload, payloadUidRef.current, uid);
  const effectiveLoading = loading || (!!uid && payloadUidRef.current !== uid);
  return {
    payload: effectivePayload, loading: effectiveLoading, error, connPhase, isSyncingFromCache, lastSyncedAt, syncWarning,
    savePayload, savePayloadAsync,
    saveSubPath, saveSubPathAsync,
    saveSubPaths, saveSubPathsAsync,
    saveConfigPatch,
    writeActivityEvents: (pathsToValues, retries) => writeActivityEvents(uid, pathsToValues, retries),
    captureTodaySnapshotIfNeeded: (tasks, windows) => captureTodaySnapshotIfNeeded(uid, tasks, windows),
    flushNow, clearCache,
  };
}
