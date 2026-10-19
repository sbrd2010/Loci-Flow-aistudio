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
  let failures = 0; // every failed save so far, so a re-send can tell a newer failure from its own
  let busy = false;

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
    // A full-payload save failed. Returns the delay to send again, or null.
    failed(err) {
      failures += 1;
      return isConnectionDrop(err) ? arm() : null;
    },
    // Some other write failed (a child path): it counts as a failure, it is not re-sent.
    noteFailure() { failures += 1; },
    // A full-payload save went through.
    saved() { quickResends = 0; },
    // A re-send may start only with something to send, and when no save is queued
    // or in flight: that one carries the latest payload.
    canResend({ hasPayload, savePending }) { return hasPayload && !savePending && !busy; },
    // Marks a re-send in flight. Returns a mark to give to `clearsWarning`.
    startResend() { busy = true; return failures; },
    endResend() { busy = false; },
    // A re-send went through: it clears the failure warning only if no save
    // failed meanwhile, since that save's edit is not on the server.
    clearsWarning(mark) { return failures === mark; },
    // A re-send failed. Returns the delay to send again, or null.
    resendFailed(err) { return isConnectionDrop(err) ? arm() : null; },
    // Another account signed in: nothing of the last one's failures carries over.
    reset() { waitForReconnect = false; quickResends = 0; failures = 0; },
  };
}
