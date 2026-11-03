import React from "react";
import { describeSignOutReason } from "../utils/signOutFlush";

// #650: why the sign-out's save didn't confirm, in one quiet line plus the
// short code, so it can be read off a phone screen. No personal data.
export default function SignOutReason({ detail }) {
  if (!detail?.reason) return null;
  return (
    <p className="signout-reason" data-testid="signout-reason">
      {describeSignOutReason(detail.reason)}{" "}
      <span className="signout-reason-code">({detail.reason} · {detail.ms} ms · {detail.online ? "online" : "offline"})</span>
    </p>
  );
}
