// #650: why a sign-out's final save didn't confirm. Sign-out still needs a
// confirmed save of the latest local data (nothing unsaved is ever dropped);
// this only names the outcome, so a failure on a phone can be read off the
// screen. Reasons are fixed short codes: never a uid, email, path, token or
// any task or chat text.

export const SIGN_OUT_WAIT_MS = 5000;

// A Firebase or transaction error as a short code: its `code`, else the first
// word of its message ("permission_denied at /sync/<uid>: …" → "permission_denied").
export function safeErrorCode(err) {
  const raw = String(err?.code || err?.message || "unknown").trim();
  // writeWithRetry's own error for a resolved-but-uncommitted transaction.
  if (/^transaction not committed/i.test(raw)) return "not-committed";
  const word = raw.split(/[\s:(/]/)[0] || "unknown";
  return word.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "unknown";
}

// The outcome of a confirmed save that did commit.
export function flushOutcome({ sameAccount, noNewerEdit }) {
  if (!sameAccount) return "account-changed";
  return noNewerEdit ? "confirmed" : "newer-edit-during-save";
}

// Waits up to `waitMs` for `flushDetailed()` ({ ok, reason }). A save still
// running then is reported as timed out, not as refused: it may yet finish,
// and no second save is started here. Resolves { ok, reason, ms }.
export async function confirmBeforeSignOut(flushDetailed, { waitMs = SIGN_OUT_WAIT_MS, now = Date.now } = {}) {
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
  return "The save wasn't confirmed.";
}
