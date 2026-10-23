// When to send the full payload again after a save failed because the connection
// dropped (#524). Pure rules, no timers and no Firebase: the sync hook calls them
// and does the scheduling and the writing.

export const RESEND_AFTER_RECONNECT_MS = 1500; // a moment for the connection to settle
export const RESEND_RETRY_MS = 3000;
export const MAX_QUICK_RESENDS = 3;

// A save that failed because the connection dropped, not because the server
// refused it: the SDK cancels a transaction in flight with Error("disconnect").
// Such a failure is worth sending again once the connection is back.
export function isConnectionDrop(err) {
  const text = `${err?.code || ""} ${err?.message || ""}`;
  return /disconnect|network|unavailable|offline/i.test(text);
}

export function createResendPolicy() {
  let live = false; // whether the SDK reports a live connection right now
  let waitForReconnect = false;
  let quickResends = 0;
  let busy = false;
  // Full saves are numbered as they start. A failed save whose edits a later-started
  // save has already carried to the server is stale: it neither raises the warning
  // nor is sent again. (A bad connection piles up dozens of saves that all fail
  // together when the SDK notices; the older ones say nothing about the latest.)
  let started = 0;
  let lastOk = 0; // the latest-started save that went through
  let lastFail = 0; // the latest-started failure that no success has superseded

  // Milliseconds to wait before sending again, or null: either nothing to send,
  // or it waits for the next reconnect. If the connection is already back (the
  // drop ended before the failure reached us), no reconnect event will come, so
  // send again shortly, a few times at most.
  const arm = () => {
    if (!live) { waitForReconnect = true; return null; }
    // Out of quick tries: keep the save waiting for the next reconnect.
    if (quickResends >= MAX_QUICK_RESENDS) { waitForReconnect = true; return null; }
    quickResends += 1;
    return RESEND_RETRY_MS;
  };

  return {
    // The connection state changed. Returns the delay to send again, if a failed
    // save was waiting for the connection to come back.
    connection(isLive) {
      live = isLive;
      if (isLive && waitForReconnect) { waitForReconnect = false; return RESEND_AFTER_RECONNECT_MS; }
      return null;
    },
    // A full-payload save starts. Returns its number, to give back to `failed` or `saved`.
    startSave() { started += 1; return started; },
    // Save `n` failed. `warn`: whether to raise the warning (false: a later-started save
    // has gone through, so this one's edits are on the server). `resendIn`: the delay
    // to send again, or null.
    failed(err, n = started) {
      if (n < lastOk) return { warn: false, resendIn: null };
      lastFail = Math.max(lastFail, n);
      return { warn: true, resendIn: isConnectionDrop(err) ? arm() : null };
    },
    // Some other write failed (a child path): it counts as a failure newer than every
    // save so far, and it is not re-sent.
    noteFailure() { lastFail = Math.max(lastFail, started + 0.5); },
    // Save `n` went through. Returns whether the warning clears: only if every failure
    // still standing started before it, since a later one's edit is not on the server.
    saved(n = started) {
      quickResends = 0;
      lastOk = Math.max(lastOk, n);
      return lastFail < n;
    },
    // A re-send may start only with something to send, and when no save is queued
    // or in flight: that one carries the latest payload.
    canResend({ hasPayload, savePending }) { return hasPayload && !savePending && !busy; },
    // Marks a re-send in flight.
    startResend() { busy = true; },
    endResend() { busy = false; },
    // A re-send failed. Returns the delay to send again, or null.
    resendFailed(err) { return isConnectionDrop(err) ? arm() : null; },
    // Another account signed in: nothing of the last one's wait or tries carries over.
    reset() { waitForReconnect = false; quickResends = 0; },
  };
}
