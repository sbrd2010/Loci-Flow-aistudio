// Firebase omits null/empty-array keys on write, so fields like `brainDump`
// arrive as `undefined` after a read when the array was empty or the key was
// never written. normalizePayload ensures required fields always exist so
// callers can safely spread or iterate without null-checks.
export const BRAIN_DUMP_LIMIT = 50;

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function sanitizeString(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || fallback;
}

function fallbackTask(index, fallbackUserId, now) {
  return {
    id: now + index,
    userId: fallbackUserId,
    uuid: `repaired-invalid-${now}-${index}`,
    title: "Recovered invalid task",
    concreteStep: "Review or delete this recovered item",
    horizonLevel: "week",
    priority: "P3",
    category: "Personal",
    timeEstimateMinutes: 25,
    deadlineTimestamp: null,
    reminderAt: null,
    isCompleted: false,
    isParked: false,
    isNowFocus: false,
    orderIndex: index,
    dateCompletedString: null,
    isDeleted: true,
    lastUpdated: now,
  };
}

// Repairs task objects so the next full-payload RTDB set() satisfies the current
// database.rules.json task schema. This is intentionally applied to existing
// local/cache payloads too, not only newly-created tasks, because one malformed
// old task can make every later full save fail atomically.
export function sanitizeTaskForRules(task, index = 0, fallbackUserId = "", now = Date.now()) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return fallbackTask(index, fallbackUserId, now);
  }

  const repaired = {
    ...task,
    id: task.id ?? (now + index),
    userId: sanitizeString(task.userId, 200, fallbackUserId),
    title: sanitizeString(task.title, 1000, "Untitled task"),
  };

  if (!repaired.uuid) repaired.uuid = `repaired-${now}-${index}`;

  if (hasOwn(task, "concreteStep")) {
    repaired.concreteStep = sanitizeString(task.concreteStep, 300, "Do first tiny step");
  }

  // Firebase's set() throws synchronously on any `undefined`-valued key
  // anywhere in the payload, deterministically failing every retry.
  for (const key of Object.keys(repaired)) {
    if (repaired[key] === undefined) delete repaired[key];
  }

  return repaired;
}

export function sanitizeTasksForRules(tasks, fallbackUserId = "", now = Date.now()) {
  return arrayOrEmpty(tasks).map((task, index) => sanitizeTaskForRules(task, index, fallbackUserId, now));
}

function brainDumpsEqual(a, b) {
  try {
    return JSON.stringify(arrayOrEmpty(a)) === JSON.stringify(arrayOrEmpty(b));
  } catch {
    return false;
  }
}

function inferBrainDumpUpdatedAt(raw, brainDump) {
  const explicit = finiteNumber(raw.brainDumpUpdatedAt);
  if (explicit !== null) return explicit;

  // Legacy payloads did not have field-level metadata. If legacy brainDump
  // items exist, use the payload timestamp as the best available age signal.
  if (brainDump.length) {
    const payloadTimestamp = finiteNumber(raw.timestamp);
    if (payloadTimestamp !== null) return payloadTimestamp;
  }

  return 0;
}

// database.rules.json caps these config strings and rejects the write when one
// is over. Like a malformed task (sanitizeTaskForRules), one over-long value
// held locally makes EVERY later full-payload write fail atomically — the app
// keeps showing the edit from cache while nothing saves any more. Nothing
// upstream caps them (Settings, onboarding and the Coach all write freely).
export const CONFIG_STRING_LIMITS = { userName: 100, mentorName: 100, deadlineLabel: 100, intentionMessage: 500 };
export const CHAT_TEXT_LIMIT = 5000;

// Clamps the rule-limited config strings in a whole config or a partial
// patch. Returns the same object when nothing needed clamping. Non-string
// values for these keys are coerced, since the rule accepts only a string or
// no value at all.
export function clampConfigStringsForRules(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  let out = config;
  for (const [key, limit] of Object.entries(CONFIG_STRING_LIMITS)) {
    if (!hasOwn(config, key)) continue;
    const value = config[key];
    if (value == null) continue;
    const str = typeof value === "string" ? value : String(value);
    if (str === value && str.length <= limit) continue;
    if (out === config) out = { ...config };
    out[key] = str.slice(0, limit);
  }
  return out;
}

// chatHistory messages may carry only text (string, ≤ CHAT_TEXT_LIMIT),
// isUser (boolean) and actions — the rules reject any other key. A Coach
// reply can exceed the cap at the current token budget, and a single such
// message fails every later full-payload write the same way as above.
export function sanitizeChatHistoryForRules(history) {
  if (!Array.isArray(history)) return history;
  return history
    .filter(m => m && typeof m === "object")
    .map(m => {
      const text = typeof m.text === "string" ? m.text : String(m.text ?? "");
      const msg = { text: text.slice(0, CHAT_TEXT_LIMIT), isUser: !!m.isUser };
      if (m.actions !== undefined) msg.actions = m.actions;
      return msg;
    });
}

export function normalizePayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { tasks: [], config: {}, contributions: [], brainDump: [], brainDumpUpdatedAt: 0 };
  }
  const brainDump = arrayOrEmpty(raw.brainDump);
  const config = clampConfigStringsForRules(objectOrEmpty(raw.config));
  const fallbackUserId = sanitizeString(raw.userId, 200, sanitizeString(config.userId, 200, ""));
  return {
    ...raw,
    tasks: sanitizeTasksForRules(raw.tasks, fallbackUserId),
    config,
    contributions: arrayOrEmpty(raw.contributions),
    brainDump,
    brainDumpUpdatedAt: inferBrainDumpUpdatedAt(raw, brainDump),
    ...(Array.isArray(raw.chatHistory) ? { chatHistory: sanitizeChatHistoryForRules(raw.chatHistory) } : {}),
  };
}

export function prepareBrainDumpForSave(updatedPayload = {}, currentPayload = {}, now = Date.now()) {
  const currentBrainDump = arrayOrEmpty(currentPayload?.brainDump);
  const incomingHasBrainDump = updatedPayload?.brainDump !== undefined;
  let nextBrainDump = incomingHasBrainDump
    ? arrayOrEmpty(updatedPayload.brainDump)
    : currentBrainDump;

  if (incomingHasBrainDump && nextBrainDump.length > BRAIN_DUMP_LIMIT) {
    if (currentBrainDump.length >= BRAIN_DUMP_LIMIT && nextBrainDump.length > currentBrainDump.length) {
      nextBrainDump = currentBrainDump;
    } else {
      nextBrainDump = nextBrainDump.slice(0, BRAIN_DUMP_LIMIT);
    }
  }

  const patch = { brainDump: nextBrainDump };
  const brainDumpChanged = incomingHasBrainDump && !brainDumpsEqual(nextBrainDump, currentBrainDump);
  const requestedBrainDumpUpdatedAt = finiteNumber(updatedPayload?.brainDumpUpdatedAt);
  const currentBrainDumpUpdatedAt = finiteNumber(currentPayload?.brainDumpUpdatedAt);

  if (brainDumpChanged) {
    patch.brainDumpUpdatedAt = now;
  } else if (requestedBrainDumpUpdatedAt !== null || currentBrainDumpUpdatedAt !== null) {
    patch.brainDumpUpdatedAt = requestedBrainDumpUpdatedAt ?? currentBrainDumpUpdatedAt;
  }

  return patch;
}

// Returns true when a savePayload call would reduce the active (non-deleted) task
// count by `threshold` or more relative to the currently-held payload. Completed
// and parked tasks are counted as active - only `isDeleted: true` is excluded.
// The guard is skipped when the current active count is below `threshold` itself
// (e.g. fresh user, demo mode) so it never fires on an empty or near-empty state.
export function isTaskCountDropSuspicious(nextTasks, currentTasks, threshold = 3) {
  const currentActive = arrayOrEmpty(currentTasks).filter(t => !t.isDeleted).length;
  if (currentActive < threshold) return false;
  const nextActive = arrayOrEmpty(nextTasks).filter(t => !t.isDeleted).length;
  return (currentActive - nextActive) >= threshold;
}

// Merges remote and local task arrays by uuid.
// For shared UUIDs: the task with the newer lastUpdated wins; remote wins on tie
// (avoids endless local/remote flip-flopping when timestamps are equal or absent).
// Local-only non-deleted tasks are appended (unsynced additions from another device).
// Local-only soft-deleted tasks are not resurrected.
// Returns { tasks, hasLocalContribution } where hasLocalContribution is true when
// any local-newer task won a conflict or any local-only non-deleted task was appended.
// Callers use hasLocalContribution to know whether to write the merged result back
// to RTDB for cross-device convergence.
function mergeTasks(remoteTasks, localTasks) {
  const sanitizedRemoteTasks = sanitizeTasksForRules(remoteTasks);
  const sanitizedLocalTasks = sanitizeTasksForRules(localTasks);
  // Matched on taskIdentity (uuid, or id for legacy rows that never had one)
  // rather than uuid alone, since sanitizeTasksForRules gives a uuid-less row
  // a fresh repaired-* uuid on each side and they would merge as two tasks.
  const localByKey = new Map(
    sanitizedLocalTasks
      .filter(taskIdentity)
      .map(t => [taskIdentity(t), t])
  );

  let hasLocalContribution = false;

  const merged = sanitizedRemoteTasks.map(remoteTask => {
    const key = taskIdentity(remoteTask);
    if (!key) return remoteTask;
    const localTask = localByKey.get(key);
    if (!localTask) return remoteTask;
    const localTs = finiteNumber(localTask.lastUpdated) ?? 0;
    const remoteTs = finiteNumber(remoteTask.lastUpdated) ?? 0;
    if (localTs > remoteTs) {
      hasLocalContribution = true;
      return localTask;
    }
    return remoteTask;
  });

  const remoteKeys = new Set(sanitizedRemoteTasks.map(taskIdentity).filter(Boolean));
  const localOnlyTasks = sanitizedLocalTasks.filter(
    t => taskIdentity(t) && !remoteKeys.has(taskIdentity(t)) && !t.isDeleted
  );

  if (localOnlyTasks.length > 0) hasLocalContribution = true;

  return { tasks: [...merged, ...localOnlyTasks], hasLocalContribution };
}

// Structural equality for config values. Config holds primitives plus arrays
// (dailyAnchors, focusWindows) and plain objects (coachMemory), all produced by
// this app, so a recursive walk is enough — no Date/Map/Set/cycle handling needed.
// null and undefined compare equal on purpose: RTDB drops keys written as null,
// so the same logical "unset" arrives as `undefined` from the server but may sit
// as `null` in a local object, and treating that round-trip as a change would
// make every device look like it had edited the field.
export function configValuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, i) => configValuesEqual(item, b[i]));
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!configValuesEqual(a[key], b[key])) return false;
  }
  return true;
}

// Three-way merges config: remote is the base of the result, and only the keys
// this device actually changed since the last remote config it saw (`base`) are
// re-applied on top.
//
// The whole-object last-write-wins this replaces compared a single
// `config.lastUpdated` and let the newer side win *entirely*. That is wrong
// whenever a device bumps `lastUpdated` while holding a stale config — which
// happens routinely, e.g. the visit-streak effect firing on a laptop resumed
// from sleep before RTDB has re-delivered. Every unrelated field that device
// still held (a Key Deadline edited on another device that morning, say) then
// beat the newer remote value AND, via localConfigWon, got written back to
// RTDB, destroying the edit for every device. Diffing against `base` keeps the
// legitimate half of that write (the streak fields it meant to change) while
// leaving fields it never touched to remote.
//
// Conflicts — both sides changed the same key since base — resolve to remote,
// matching mergeTasks's "remote wins on tie" convention.
//
// Without a base (first sync on a device, or a cache written before this
// existed) there is no way to tell a local edit from stale drift, so remote
// wins outright. Taking local wholesale there is exactly the data-loss bug
// above; the cost is that a config edit made while offline, on a device that
// has never synced, is dropped — narrow, and strictly safer than the reverse.
//
// Returns { config, localConfigWon } where localConfigWon is true when at least
// one local key was re-applied, so the caller knows to write the merged result
// back to RTDB for convergence.
function mergeConfig(remoteConfig, localConfig, baseConfig) {
  const remote = objectOrEmpty(remoteConfig);
  const local = objectOrEmpty(localConfig);
  if (!baseConfig) return { config: remoteConfig, localConfigWon: false };
  const base = objectOrEmpty(baseConfig);

  const merged = { ...remote };
  let localConfigWon = false;

  // Only keys PRESENT locally can be local edits. Walking base's keys too would
  // read every key the local config happens to lack as a deletion to replay —
  // so a mount with a base but no cached payload (cache evicted, or a stale
  // base outliving its cache) would "delete" the entire config and, via
  // localConfigWon, write that wipe back to RTDB. The app never removes config
  // keys anyway (clearing a deadline writes "", it does not delete), so there
  // is no deletion to propagate and no reason to accept that risk.
  for (const key of Object.keys(local)) {
    // Bookkeeping, not user data — it tracks *when* config changed, so it can
    // never itself count as an edit worth preserving. Recomputed below.
    if (key === "lastUpdated") continue;
    // Unchanged locally since base: nothing of this device's to preserve.
    if (configValuesEqual(local[key], base[key])) continue;
    // Changed on both sides since base — remote wins, per mergeTasks's convention.
    if (!configValuesEqual(remote[key], base[key])) continue;
    merged[key] = local[key];
    localConfigWon = true;
  }

  if (!localConfigWon) return { config: remoteConfig, localConfigWon: false };

  // The result now carries local edits that remote hasn't seen, so it must not
  // claim remote's (older) timestamp — a later merge would read it as "nothing
  // new here" and the re-applied keys would be lost on the next round trip.
  merged.lastUpdated = Math.max(
    finiteNumber(remote.lastUpdated) ?? 0,
    finiteNumber(local.lastUpdated) ?? 0
  );
  return { config: merged, localConfigWon: true };
}

// If RTDB omits `brainDump`, field-level metadata tells us whether that omission
// means "legacy/missing key, preserve newer local items" or "newer remote clear".
// Returns { merged, hasLocalContribution } where hasLocalContribution signals that
// the merged payload differs from remote due to local-newer tasks, and must be
// written back to RTDB so other devices converge on the correct state.
// `baseConfig` is the last config this device received from RTDB — see
// mergeConfig for why config needs it and what happens when it's absent.
// `baseContributions` likewise for contribution rows (see mergeContributions),
// `baseBrainDump` for brain-dump items (see mergeBrainDump) and
// `baseChatHistory` for the chat list (see mergeChatHistory); without them the
// remote rows/items/list are taken wholesale, as before they existed.
export function mergeRemotePayloadWithMeta(remote, local, baseConfig, baseContributions, baseBrainDump, baseChatHistory) {
  const normalized = normalizePayload(remote);
  if (!remote || typeof remote !== "object") return { merged: normalized, hasLocalContribution: false };

  const remoteHasBrainDump = hasOwn(remote, "brainDump");
  const remoteHasBrainDumpMeta = hasOwn(remote, "brainDumpUpdatedAt");
  const localBrainDump = arrayOrEmpty(local?.brainDump);
  const localBrainDumpUpdatedAt = finiteNumber(local?.brainDumpUpdatedAt) || 0;
  const remoteBrainDumpUpdatedAt = finiteNumber(remote.brainDumpUpdatedAt) || 0;

  if (!remoteHasBrainDump && localBrainDump.length) {
    const shouldPreserveLegacyLocal = !remoteHasBrainDumpMeta;
    const localIsNewerThanRemoteClear = remoteHasBrainDumpMeta && localBrainDumpUpdatedAt > remoteBrainDumpUpdatedAt;

    if (shouldPreserveLegacyLocal || localIsNewerThanRemoteClear) {
      normalized.brainDump = localBrainDump;
      normalized.brainDumpUpdatedAt = Math.max(localBrainDumpUpdatedAt, normalized.brainDumpUpdatedAt || 0);
    }
  }

  const { tasks, hasLocalContribution: tasksContribution } = mergeTasks(normalized.tasks, local?.tasks);
  normalized.tasks = tasks;

  const { config, localConfigWon } = mergeConfig(normalized.config, local?.config, baseConfig);
  normalized.config = config;

  let contributionsContribution = false;
  if (baseContributions) {
    const result = mergeContributions(normalized.contributions, local?.contributions, baseContributions);
    normalized.contributions = result.contributions;
    contributionsContribution = result.hasLocalContribution;
  }

  let brainDumpContribution = false;
  const brainDumpMerge = mergeBrainDump(normalized.brainDump, local?.brainDump, baseBrainDump);
  if (brainDumpMerge) {
    normalized.brainDump = brainDumpMerge.items;
    brainDumpContribution = brainDumpMerge.hasLocalContribution;
    if (brainDumpContribution) {
      normalized.brainDumpUpdatedAt = Math.max(normalized.brainDumpUpdatedAt || 0, localBrainDumpUpdatedAt);
    }
  }

  let chatContribution = false;
  const chatMerge = mergeChatHistory(normalized.chatHistory, local?.chatHistory, baseChatHistory);
  if (chatMerge) {
    normalized.chatHistory = chatMerge.chatHistory;
    chatContribution = chatMerge.hasLocalContribution;
  }

  return { merged: normalized, hasLocalContribution: tasksContribution || localConfigWon || contributionsContribution || brainDumpContribution || chatContribution };
}

export function mergeRemotePayload(remote, local, baseConfig) {
  return mergeRemotePayloadWithMeta(remote, local, baseConfig).merged;
}

// ── Outgoing merge: what this device is about to WRITE ────────────────────
//
// mergeRemotePayloadWithMeta above shapes data coming IN. Nothing shaped data
// going OUT: every full-payload save was a blind overwrite of sync/{uid}, so a
// device that had missed a delivery (offline, asleep, or mid-debounce when the
// other device wrote) replaced the other device's work with its own stale copy.
// The other device could only repair it if it was still open. These helpers
// run inside the write transaction, with `server` being what RTDB actually
// holds at that moment, so the write carries both sides.
//
// Tie-breaks deliberately differ from the incoming merge: this is our own
// write, so on equal timestamps local wins (an edit that did not bump its own
// timestamp must still land), and the server wins only when strictly newer.

// Per-task identity. A task that never had a uuid (legacy rows, which the
// rules permit) is given a fresh `repaired-*` uuid by sanitizeTaskForRules on
// every normalization, so the local and server copies of the same row would
// carry different repaired uuids and be merged as two tasks. Such rows are
// matched on their `id` instead, which every task has and which is stable.
function taskIdentity(task) {
  const uuid = task?.uuid;
  if (typeof uuid === "string" && uuid && !uuid.startsWith("repaired-")) return uuid;
  return task?.id != null ? `id:${task.id}` : null;
}

// Per-task by identity. Tasks only the server has are kept — including its
// tombstones, so a delete made elsewhere is not resurrected.
function mergeTasksForWrite(serverTasks, localTasks) {
  const server = sanitizeTasksForRules(serverTasks);
  const local = sanitizeTasksForRules(localTasks);
  const serverByKey = new Map(server.filter(taskIdentity).map(t => [taskIdentity(t), t]));
  const merged = local.map(localTask => {
    const key = taskIdentity(localTask);
    const serverTask = key ? serverByKey.get(key) : undefined;
    if (!serverTask) return localTask;
    const serverTs = finiteNumber(serverTask.lastUpdated) ?? 0;
    const localTs = finiteNumber(localTask.lastUpdated) ?? 0;
    return serverTs > localTs ? serverTask : localTask;
  });
  const localKeys = new Set(local.map(taskIdentity).filter(Boolean));
  const serverOnly = server.filter(t => taskIdentity(t) && !localKeys.has(taskIdentity(t)));
  return [...merged, ...serverOnly];
}

// Per-key against `base` (the config this device last agreed with RTDB on):
// keys this device changed since base are its edits and win; every other key
// is the server's — including keys the server no longer has, so a nudge or
// check-in cleared elsewhere stays cleared. Without a base an edit cannot be
// told from stale drift, so the server's config is authoritative, matching
// the incoming merge (mergeConfig). useSync persists the base alongside the
// payload cache so a fresh mount has one too, and an offline config edit
// recovered from cache is still recognised as this device's own.
function mergeConfigForWrite(serverConfig, localConfig, baseConfig) {
  const server = objectOrEmpty(serverConfig);
  const local = objectOrEmpty(localConfig);
  const merged = { ...server };
  if (baseConfig) {
    const base = objectOrEmpty(baseConfig);
    for (const key of Object.keys(local)) {
      if (key === "lastUpdated") continue;
      if (configValuesEqual(local[key], base[key])) continue;
      merged[key] = local[key];
    }
  }
  merged.lastUpdated = Math.max(
    finiteNumber(server.lastUpdated) ?? 0,
    finiteNumber(local.lastUpdated) ?? 0
  );
  return merged;
}

// Per-day by compositeKey (dateString as fallback for legacy rows), used by
// both the incoming and the outgoing merge. `base` is the rows this device
// last received from RTDB. Every rule here is idempotent: RTDB echoes a
// device's own write back through onValue before the write's promise
// resolves, so a rule that added "this device's change since base" would
// count that change twice on the echo. Instead:
// - a day both sides hold: a count changed only on this side since base is
//   this device's edit (a completion, or an un-complete, which lowers it) and
//   is written; changed only on the server, the server's stands; changed on
//   both, the larger count is kept — this never drops a device's own
//   completions, and can under-count by the smaller side when both devices
//   completed tasks on the same day before syncing, or over-count by one
//   when one un-completes while the other completes — the lesser errors for
//   a streak/heatmap counter;
// - a day only this device holds is new work and is kept, unless base holds
//   it too, in which case the server removed it ("Reset progress" writes an
//   empty list) and it stays removed;
// - a day only the server holds is kept, unless base holds it too, in which
//   case it was removed here;
// - with no base a local change cannot be told from drift, so the server's
//   rows are authoritative, as for config.
// Returns { contributions, hasLocalContribution }, the flag set when the
// result differs from the server's rows and so must be written back.
function mergeContributions(serverContributions, localContributions, baseContributions) {
  const keyOf = c => c?.compositeKey || c?.dateString || null;
  const clean = rows => arrayOrEmpty(rows).filter(c => c && typeof c === "object");
  const countOf = row => finiteNumber(row?.count) ?? 0;
  const server = clean(serverContributions);
  const local = clean(localContributions);
  const baseByKey = baseContributions ? new Map(clean(baseContributions).filter(keyOf).map(c => [keyOf(c), c])) : null;
  const serverByKey = new Map(server.filter(keyOf).map(c => [keyOf(c), c]));
  const localKeys = new Set(local.map(keyOf).filter(Boolean));

  const merged = [];
  for (const localRow of local) {
    const key = keyOf(localRow);
    const serverRow = key ? serverByKey.get(key) : undefined;
    if (serverRow) {
      if (!baseByKey) { merged.push(serverRow); continue; }
      const baseRow = baseByKey.get(key);
      const baseCount = baseRow ? countOf(baseRow) : 0;
      const localChanged = countOf(localRow) !== baseCount;
      const serverChanged = countOf(serverRow) !== baseCount;
      if (localChanged && !serverChanged) merged.push(localRow);
      else if (!localChanged) merged.push(serverRow);
      else merged.push(countOf(localRow) > countOf(serverRow) ? localRow : serverRow);
      continue;
    }
    if (!baseByKey || baseByKey.has(key)) continue;
    merged.push(localRow);
  }
  for (const serverRow of server) {
    const key = keyOf(serverRow);
    if (!key || localKeys.has(key)) continue;
    if (baseByKey && baseByKey.has(key)) continue;
    merged.push(serverRow);
  }

  const hasLocalContribution =
    merged.length !== server.length ||
    merged.some(row => {
      const serverRow = keyOf(row) ? serverByKey.get(keyOf(row)) : undefined;
      return !serverRow || countOf(serverRow) !== countOf(row);
    });
  return { contributions: merged, hasLocalContribution };
}

// chatHistory is only ever changed through the chatHistory sub-path writer,
// never through a full-payload save, so a full write must not carry this
// device's older copy over a newer server list: three-way against `base`
// (the list this device last received), the side that changed since base
// wins, the server on a two-sided change. Without a base, null — callers
// keep their previous whole-list rule.
function mergeChatHistory(serverHistory, localHistory, baseHistory) {
  if (!baseHistory) return null;
  const canon = list => JSON.stringify(sanitizeChatHistoryForRules(arrayOrEmpty(list)));
  const server = canon(serverHistory);
  const local = canon(localHistory);
  const base = canon(baseHistory);
  const localChanged = local !== base;
  const serverChanged = server !== base;
  if (localChanged && !serverChanged) {
    return { chatHistory: sanitizeChatHistoryForRules(arrayOrEmpty(localHistory)), hasLocalContribution: true };
  }
  return { chatHistory: sanitizeChatHistoryForRules(arrayOrEmpty(serverHistory)), hasLocalContribution: false };
}

// Per-item brainDump merge, used by both paths when a base (the items this
// device last received from RTDB) is known. Items are matched by id (legacy
// items without one by createdAt+text). Local order is kept and server-only
// items appended; an item base holds that one side lacks was deleted on that
// side and stays deleted. Idempotent for the same reason as mergeContributions.
// Returns null without a base, so callers keep their whole-list rules.
function mergeBrainDump(serverItems, localItems, baseItems) {
  if (!baseItems) return null;
  const keyOf = item => item?.id ?? (item && typeof item === "object" ? `${item.createdAt ?? ""}:${item.text ?? ""}` : null);
  const clean = items => arrayOrEmpty(items).filter(item => item && typeof item === "object");
  const server = clean(serverItems);
  const local = clean(localItems);
  const baseKeys = new Set(clean(baseItems).map(keyOf).filter(k => k !== null));
  const serverKeys = new Set(server.map(keyOf).filter(k => k !== null));
  const localKeys = new Set(local.map(keyOf).filter(k => k !== null));
  const merged = local.filter(item => serverKeys.has(keyOf(item)) || !baseKeys.has(keyOf(item)));
  for (const item of server) {
    const key = keyOf(item);
    if (localKeys.has(key) || baseKeys.has(key)) continue;
    merged.push(item);
  }
  // Not trimmed to BRAIN_DUMP_LIMIT: the rules allow more, the UI blocks new
  // additions at the cap, and trimming here would delete an item the other
  // device just added when both sides added one near the cap.
  const hasLocalContribution =
    merged.length !== server.length || merged.some((item, i) => keyOf(item) !== keyOf(server[i]));
  return { items: merged, hasLocalContribution };
}

// Re-applies the edits this device made AFTER `written` was submitted to a
// write transaction, on top of `merged` (the committed result merged into
// local state). Those edits are newer in real time than anything the commit
// carries, so they win even where the standard per-key conflict rule would
// prefer the committed value; a debounce is already pending to write them
// (or, for chat, the sub-path write already landed).
// Tasks need no overlay: a post-submit edit has a newer lastUpdated and wins
// in the merge already.
export function applyEditsSince(merged, local, written) {
  const localConfig = objectOrEmpty(local?.config);
  const writtenConfig = objectOrEmpty(written?.config);
  const config = { ...objectOrEmpty(merged.config) };
  for (const key of Object.keys(localConfig)) {
    if (key === "lastUpdated") continue;
    if (!configValuesEqual(localConfig[key], writtenConfig[key])) config[key] = localConfig[key];
  }

  const rowKey = c => c?.compositeKey || c?.dateString || null;
  const rows = items => arrayOrEmpty(items).filter(c => c && typeof c === "object");
  const localRows = new Map(rows(local?.contributions).filter(rowKey).map(c => [rowKey(c), c]));
  const writtenRows = new Map(rows(written?.contributions).filter(rowKey).map(c => [rowKey(c), c]));
  const countOf = row => finiteNumber(row?.count) ?? 0;
  const contributions = [];
  const seen = new Set();
  for (const row of rows(merged.contributions)) {
    const key = rowKey(row);
    if (!key) { contributions.push(row); continue; }
    seen.add(key);
    const localRow = localRows.get(key);
    const writtenRow = writtenRows.get(key);
    if (!localRow && writtenRow) continue; // removed here since submit
    if (localRow && (!writtenRow || countOf(localRow) !== countOf(writtenRow))) { contributions.push(localRow); continue; }
    contributions.push(row);
  }
  for (const [key, localRow] of localRows) {
    if (!seen.has(key) && !writtenRows.has(key)) contributions.push(localRow); // added here since submit
  }

  const itemKey = item => item?.id ?? (item && typeof item === "object" ? `${item.createdAt ?? ""}:${item.text ?? ""}` : null);
  const items = list => arrayOrEmpty(list).filter(item => item && typeof item === "object");
  const localItems = items(local?.brainDump);
  const localKeys = new Set(localItems.map(itemKey));
  const writtenKeys = new Set(items(written?.brainDump).map(itemKey));
  const mergedKeys = new Set(items(merged.brainDump).map(itemKey));
  const brainDump = items(merged.brainDump).filter(item => localKeys.has(itemKey(item)) || !writtenKeys.has(itemKey(item)));
  for (const item of localItems) {
    if (!mergedKeys.has(itemKey(item)) && !writtenKeys.has(itemKey(item))) brainDump.push(item);
  }

  const result = { ...merged, config, contributions, brainDump };
  // A chat change made here since submit went through the sub-path writer and
  // is already on the server; the commit's older copy must not replace it.
  const chatCanon = list => JSON.stringify(sanitizeChatHistoryForRules(arrayOrEmpty(list)));
  if (chatCanon(local?.chatHistory) !== chatCanon(written?.chatHistory)) {
    result.chatHistory = sanitizeChatHistoryForRules(arrayOrEmpty(local?.chatHistory));
  }
  return result;
}

// Update function for the full-payload write transaction. `server` is null
// when RTDB has nothing at this path yet (or the SDK has no cached value on
// the transaction's first, speculative run — the server then rejects and
// re-runs it with the real value), in which case the local payload is
// written as-is.
//
// chatHistory is merged three-way against the base (see mergeChatHistory);
// without a base it stays this device's list, as before. The written
// `timestamp` is the max of both sides so neither device later reads this
// write as older than what it holds.
// `base` is { config, contributions } as this device last received them from
// RTDB, or null when it has never received a delivery for this account. Every
// rule here is idempotent (see mergeContributions for why that matters).
export function mergeLocalIntoServer(server, local, base) {
  const normalizedLocal = normalizePayload(local);
  if (!server || typeof server !== "object" || Array.isArray(server)) return normalizedLocal;
  const normalizedServer = normalizePayload(server);

  const serverBrainDumpIsNewer =
    (finiteNumber(normalizedServer.brainDumpUpdatedAt) ?? 0) > (finiteNumber(normalizedLocal.brainDumpUpdatedAt) ?? 0);
  const brainDumpMerge = mergeBrainDump(normalizedServer.brainDump, normalizedLocal.brainDump, base ? arrayOrEmpty(base.brainDump) : null);
  const chatMerge = mergeChatHistory(normalizedServer.chatHistory, normalizedLocal.chatHistory, base ? arrayOrEmpty(base.chatHistory) : null);

  return {
    ...normalizedLocal,
    ...(chatMerge ? { chatHistory: chatMerge.chatHistory } : {}),
    tasks: mergeTasksForWrite(normalizedServer.tasks, normalizedLocal.tasks),
    config: mergeConfigForWrite(normalizedServer.config, normalizedLocal.config, base ? base.config : null),
    contributions: mergeContributions(normalizedServer.contributions, normalizedLocal.contributions, base ? arrayOrEmpty(base.contributions) : null).contributions,
    brainDump: brainDumpMerge ? brainDumpMerge.items : (serverBrainDumpIsNewer ? normalizedServer.brainDump : normalizedLocal.brainDump),
    brainDumpUpdatedAt: Math.max(
      finiteNumber(normalizedServer.brainDumpUpdatedAt) ?? 0,
      finiteNumber(normalizedLocal.brainDumpUpdatedAt) ?? 0
    ),
    timestamp: Math.max(
      finiteNumber(normalizedServer.timestamp) ?? 0,
      finiteNumber(normalizedLocal.timestamp) ?? 0
    ),
  };
}
