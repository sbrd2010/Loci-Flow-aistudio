import { describe, it, expect } from "vitest";
import {
  createResendPolicy, isConnectionDrop,
  RESEND_AFTER_RECONNECT_MS, RESEND_RETRY_MS, MAX_QUICK_RESENDS,
} from "./resendPolicy";

const drop = () => new Error("disconnect");
const refused = () => new Error("PERMISSION_DENIED: Permission denied");

describe("isConnectionDrop", () => {
  it("is true for the SDK's cancelled-transaction and network errors", () => {
    expect(isConnectionDrop(new Error("disconnect"))).toBe(true);
    expect(isConnectionDrop(new Error("Firebase: network error (database/unavailable)"))).toBe(true);
    expect(isConnectionDrop({ code: "unavailable" })).toBe(true);
    expect(isConnectionDrop(new Error("client is offline"))).toBe(true);
  });

  it("is false for a refusal, an abort or nothing", () => {
    expect(isConnectionDrop(refused())).toBe(false);
    expect(isConnectionDrop(new Error("set"))).toBe(false);
    expect(isConnectionDrop(new Error("transaction not committed"))).toBe(false);
    expect(isConnectionDrop(null)).toBe(false);
    expect(isConnectionDrop(undefined)).toBe(false);
  });
});

describe("createResendPolicy: a failed save", () => {
  it("while offline waits for the reconnect, then sends after a moment", () => {
    const p = createResendPolicy();
    p.connection(false);
    expect(p.failed(drop())).toBeNull();
    expect(p.connection(true)).toBe(RESEND_AFTER_RECONNECT_MS);
  });

  it("sends only once per reconnect", () => {
    const p = createResendPolicy();
    p.connection(false);
    p.failed(drop());
    expect(p.connection(true)).toBe(RESEND_AFTER_RECONNECT_MS);
    p.connection(false);
    expect(p.connection(true)).toBeNull();
  });

  it("when the connection is already back, sends again shortly", () => {
    const p = createResendPolicy();
    p.connection(true);
    expect(p.failed(drop())).toBe(RESEND_RETRY_MS);
  });

  it("stops after a few quick re-sends, so a save that keeps failing cannot loop", () => {
    const p = createResendPolicy();
    p.connection(true);
    for (let i = 0; i < MAX_QUICK_RESENDS; i++) expect(p.failed(drop())).toBe(RESEND_RETRY_MS);
    expect(p.failed(drop())).toBeNull();
  });

  it("after the quick re-sends are used up, the next reconnect sends once more", () => {
    const p = createResendPolicy();
    p.connection(true);
    for (let i = 0; i < MAX_QUICK_RESENDS; i++) p.failed(drop());
    expect(p.failed(drop())).toBeNull();
    p.connection(false);
    expect(p.connection(true)).toBe(RESEND_AFTER_RECONNECT_MS);
  });

  it("a save that goes through resets the count", () => {
    const p = createResendPolicy();
    p.connection(true);
    for (let i = 0; i < MAX_QUICK_RESENDS; i++) p.failed(drop());
    p.saved();
    expect(p.failed(drop())).toBe(RESEND_RETRY_MS);
  });

  it("is not re-sent when the server refused it", () => {
    const p = createResendPolicy();
    p.connection(true);
    expect(p.failed(refused())).toBeNull();
    p.connection(false);
    expect(p.failed(refused())).toBeNull();
    expect(p.connection(true)).toBeNull();
  });

  it("before any connection state is known counts as offline", () => {
    const p = createResendPolicy();
    expect(p.failed(drop())).toBeNull();
    expect(p.connection(true)).toBe(RESEND_AFTER_RECONNECT_MS);
  });
});

describe("createResendPolicy: sending again", () => {
  const ready = { hasPayload: true, savePending: false };

  it("needs a payload, no queued save and no re-send already running", () => {
    const p = createResendPolicy();
    expect(p.canResend(ready)).toBe(true);
    expect(p.canResend({ hasPayload: false, savePending: false })).toBe(false);
    expect(p.canResend({ hasPayload: true, savePending: true })).toBe(false);
    p.startResend();
    expect(p.canResend(ready)).toBe(false);
    p.endResend();
    expect(p.canResend(ready)).toBe(true);
  });

  it("clears the warning when no save failed meanwhile", () => {
    const p = createResendPolicy();
    p.failed(drop());
    const mark = p.startResend();
    expect(p.clearsWarning(mark)).toBe(true);
  });

  it("keeps the warning when a newer save failed meanwhile", () => {
    const p = createResendPolicy();
    p.failed(drop());
    const mark = p.startResend();
    p.failed(drop());
    expect(p.clearsWarning(mark)).toBe(false);
  });

  it("counts a failed child-path write as a newer failure, without re-sending it", () => {
    const p = createResendPolicy();
    p.connection(true);
    const mark = p.startResend();
    p.noteFailure();
    expect(p.clearsWarning(mark)).toBe(false);
    expect(p.connection(true)).toBeNull();
  });

  it("a re-send that drops again waits like any failed save", () => {
    const p = createResendPolicy();
    p.connection(false);
    p.startResend();
    expect(p.resendFailed(drop())).toBeNull();
    expect(p.connection(true)).toBe(RESEND_AFTER_RECONNECT_MS);
  });

  it("a re-send the server refuses is not tried again", () => {
    const p = createResendPolicy();
    p.connection(true);
    expect(p.resendFailed(refused())).toBeNull();
  });

  it("a failed re-send does not count as a failed save, so a later success still clears the warning", () => {
    const p = createResendPolicy();
    p.connection(true);
    const mark = p.startResend();
    p.resendFailed(drop());
    expect(p.clearsWarning(mark)).toBe(true);
  });
});

describe("createResendPolicy: another account", () => {
  it("forgets the last account's wait and counts, but keeps the live connection", () => {
    const p = createResendPolicy();
    p.connection(false);
    p.failed(drop());
    p.reset();
    expect(p.connection(true)).toBeNull();
    for (let i = 0; i < MAX_QUICK_RESENDS; i++) expect(p.failed(drop())).toBe(RESEND_RETRY_MS);
    p.reset();
    expect(p.failed(drop())).toBe(RESEND_RETRY_MS);
  });
});
