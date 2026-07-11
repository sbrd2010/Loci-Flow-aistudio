// Storage-neutral cache for the Insights "Ask Coach" recap. The web
// implementation uses localStorage internally, but InsightsPanel.jsx only
// ever calls this module's get/set/clear — never localStorage directly —
// so a future native build can swap in device storage as a module-level
// change, not a component rewrite.
//
// Every operation is fully fail-soft: unavailable storage, access/security
// errors, malformed JSON, quota errors, and an invalid stored shape all
// resolve to a safe default (null / no-op) rather than throwing. A cache
// failure must never block generating or displaying a recap.
const KEY_PREFIX = "loci_insights_recap_";
const RANGE_KEYS = new Set(["today", "7d", "30d"]);

function keyFor(uid, rangeKey) {
  return `${KEY_PREFIX}${uid}_${rangeKey}`;
}

function isValidRecord(parsed) {
  return (
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.recap === "string" &&
    parsed.recap.length > 0 &&
    typeof parsed.inputSignature === "string" &&
    typeof parsed.rangeEndDate === "string" &&
    typeof parsed.promptVersion === "number" &&
    typeof parsed.generatedAt === "number"
  );
}

// Never uses null/undefined/an email/task data as the cache identity — a
// falsy uid (including Demo Mode, where uid is always null) or a
// non-whitelisted rangeKey disables persistent caching entirely: get()
// returns null, set()/clear() no-op.
export function get(uid, rangeKey) {
  if (!uid || !RANGE_KEYS.has(rangeKey)) return null;
  try {
    const raw = localStorage.getItem(keyFor(uid, rangeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null; // malformed JSON, unavailable storage, access/security errors
  }
}

// One replaceable record per (uid, rangeKey) — always overwrites the same
// key, never accumulates. `record` should be the exact
// `{ rangeEndDate, inputSignature, promptVersion, recap, generatedAt }`
// shape; the *cleaned* recap only (usage-note stripped, never a usage-limit
// message — see insightsRecapContext.js's stripUsageNote/isUsageLimitMessage).
export function set(uid, rangeKey, record) {
  if (!uid || !RANGE_KEYS.has(rangeKey)) return;
  try {
    localStorage.setItem(keyFor(uid, rangeKey), JSON.stringify(record));
  } catch {
    // Quota exceeded, unavailable storage, etc. — the recap already
    // displayed for this session; failing to persist it is not fatal.
  }
}

export function clear(uid, rangeKey) {
  if (!uid || !RANGE_KEYS.has(rangeKey)) return;
  try {
    localStorage.removeItem(keyFor(uid, rangeKey));
  } catch {
    // Fail-soft, same as above.
  }
}
