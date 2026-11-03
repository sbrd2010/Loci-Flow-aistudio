// #650: why a sign-out's final save didn't confirm. Sign-out still needs a
// confirmed save of the latest local data (nothing unsaved is ever dropped);
// this only names the outcome, so a failure on a phone can be read off the
// screen. Reasons are fixed short codes: never a uid, email, path, token or
// any task or chat text.

export const SIGN_OUT_WAIT_MS = 5000;

// A Firebase or transaction error as a short code, from a fixed list only
// (#650 review): the error's `code`, else the first word of its message
// ("permission_denied at /sync/<uid>: …" → "permission_denied"). Anything
// else becomes "other", so an unexpected message can't put a name, email,
// token or task word on screen or in the console.
const KNOWN_CODES = new Set([
  "permission_denied", "disconnect", "maxretry", "set", "datastale", "nodata",
  "unavailable", "too_big", "overriddenbyset", "network_error", "write_cancelled",
  "transaction", "unknown",
]);
export function safeErrorCode(err) {
  const raw = String(err?.code || err?.message || "unknown").trim();
  // writeWithRetry's own error for a resolved-but-uncommitted transaction.
  if (/^transaction not committed/i.test(raw)) return "not-committed";
  // Firebase Auth codes ("auth/network-request-failed").
  if (/^auth\/[a-z-]{1,40}$/.test(raw)) return raw;
  const word = (raw.split(/[\s:(]/)[0] || "unknown").toLowerCase().replace(/-/g, "_");
  return KNOWN_CODES.has(word) ? word : "other";
}

// Top-level keys the rules allow under sync/{uid} (database.rules.json). Any
// other one makes the rules refuse a full save with permission_denied, the
// same code as a sign-in refusal; counting them tells the two apart.
const ALLOWED_ROOT_KEYS = new Set(["userId", "tasks", "config", "chatHistory", "contributions", "brainDump", "brainDumpUpdatedAt", "timestamp"]);
export function unknownRootKeyCount(payload) {
  if (!payload || typeof payload !== "object") return 0;
  return Object.keys(payload).filter(k => !ALLOWED_ROOT_KEYS.has(k)).length;
}

// The outcome of a confirmed save that did commit.
export function flushOutcome({ sameAccount, noNewerEdit }) {
  if (!sameAccount) return "account-changed";
  return noNewerEdit ? "confirmed" : "newer-edit-during-save";
}

// Waits up to `waitMs` for `flushDetailed()` ({ ok, reason }). A save still
// running then is reported as timed out, not as refused: it may yet finish,
// and no second save is started here. Resolves { ok, reason, ms }. When a
// timed-out save settles later, `onLate({ ok, reason, ms })` says how, so a
// slow refusal isn't hidden behind "timed out".
export async function confirmBeforeSignOut(flushDetailed, { waitMs = SIGN_OUT_WAIT_MS, now = Date.now, onLate = null } = {}) {
  const started = now();
  let timer;
  const timedOut = new Promise(resolve => {
    timer = setTimeout(() => resolve({ ok: false, reason: `timeout-${Math.round(waitMs / 1000)}s` }), waitMs);
  });
  const flushed = Promise.resolve()
    .then(flushDetailed)
    .then(r => ({ ok: r?.ok === true, reason: r?.reason || (r?.ok === true ? "confirmed" : "unknown") }))
    .catch(err => ({ ok: false, reason: `write-error:${safeErrorCode(err)}` }));
  try {
    const result = await Promise.race([flushed, timedOut]);
    if (result.reason.startsWith("timeout-") && onLate) {
      flushed.then(late => onLate({ ...late, ms: Math.max(0, now() - started) }));
    }
    return { ...result, ms: Math.max(0, now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

// One plain sentence for the reason, shown under the sign-out failure.
export function describeSignOutReason(reason = "") {
  if (reason.startsWith("timeout-")) return `The save didn't confirm within ${reason.slice(8)} (it may still finish).`;
  if (reason === "newer-edit-during-save") return "A newer change was made while saving.";
  if (reason.startsWith("write-error:")) return `The server didn't accept the save (${reason.slice(12)}).`;
  if (reason === "account-changed") return "The account changed while saving.";
  if (reason.startsWith("auth-signout:")) return `Saved, but signing out of the account failed (${reason.slice(13)}).`;
  return "The save wasn't confirmed.";
}
