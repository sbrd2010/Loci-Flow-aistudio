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
    expect(p.failed(drop()).resendIn).toBeNull();
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
    expect(p.failed(drop()).resendIn).toBe(RESEND_RETRY_MS);
  });

  it("stops after a few quick re-sends, so a save that keeps failing cannot loop", () => {
    const p = createResendPolicy();
    p.connection(true);
    for (let i = 0; i < MAX_QUICK_RESENDS; i++) expect(p.failed(drop()).resendIn).toBe(RESEND_RETRY_MS);
    expect(p.failed(drop()).resendIn).toBeNull();
  });

  it("after the quick re-sends are used up, the next reconnect sends once more", () => {
    const p = createResendPolicy();
    p.connection(true);
    for (let i = 0; i < MAX_QUICK_RESENDS; i++) p.failed(drop());
    expect(p.failed(drop()).resendIn).toBeNull();
    p.connection(false);
    expect(p.connection(true)).toBe(RESEND_AFTER_RECONNECT_MS);
  });

  it("a save that goes through resets the count", () => {
    const p = createResendPolicy();
    p.connection(true);
    for (let i = 0; i < MAX_QUICK_RESENDS; i++) p.failed(drop());
    p.saved();
    expect(p.failed(drop()).resendIn).toBe(RESEND_RETRY_MS);
  });

  it("is not re-sent when the server refused it", () => {
    const p = createResendPolicy();
    p.connection(true);
    expect(p.failed(refused()).resendIn).toBeNull();
    p.connection(false);
    expect(p.failed(refused()).resendIn).toBeNull();
    expect(p.connection(true)).toBeNull();
  });

  it("before any connection state is known counts as offline", () => {
    const p = createResendPolicy();
    expect(p.failed(drop()).resendIn).toBeNull();
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
});

// #524: a bad connection piles up many full saves that all fail together.
describe("createResendPolicy: failures that a later save has overtaken", () => {
  it("a failed save raises the warning", () => {
    const p = createResendPolicy();
    const n = p.startSave();
    expect(p.failed(drop(), n).warn).toBe(true);
  });

  it("a success clears the warning when every failure started before it", () => {
    const p = createResendPolicy();
    const a = p.startSave();
    p.failed(drop(), a);
    const b = p.startSave();
    expect(p.saved(b)).toBe(true);
  });

  it("a success does not clear the warning while a save that started after it has failed", () => {
    const p = createResendPolicy();
    const a = p.startSave();
    const b = p.startSave();
    p.failed(drop(), b);
    expect(p.saved(a)).toBe(false);
  });

  it("a save that failed late, after a later-started save went through, is stale: no warning, no re-send", () => {
    const p = createResendPolicy();
    p.connection(true);
    const older = p.startSave();
    const newer = p.startSave();
    p.saved(newer);
    expect(p.failed(drop(), older)).toEqual({ warn: false, resendIn: null });
  });

  it("dozens of saves failing together after a re-send went through leave the warning cleared", () => {
    const p = createResendPolicy();
    p.connection(true);
    const piled = Array.from({ length: 50 }, () => p.startSave());
    const resend = p.startSave();
    expect(p.saved(resend)).toBe(true);
    piled.forEach((n) => expect(p.failed(drop(), n).warn).toBe(false));
  });

  it("a failure of a save that started after the re-send keeps the warning", () => {
    const p = createResendPolicy();
    const resend = p.startSave();
    const after = p.startSave();
    expect(p.saved(resend)).toBe(true);
    expect(p.failed(drop(), after).warn).toBe(true);
    expect(p.saved(resend)).toBe(false);
  });

  it("a failed child-path write counts as newer than every save so far, and is not re-sent", () => {
    const p = createResendPolicy();
    p.connection(true);
    const n = p.startSave();
    p.noteFailure();
    expect(p.saved(n)).toBe(false);
    expect(p.saved(p.startSave())).toBe(true);
    expect(p.connection(true)).toBeNull();
  });

  it("a failure with no number counts as the newest save", () => {
    const p = createResendPolicy();
    const n = p.startSave();
    expect(p.failed(drop()).warn).toBe(true);
    expect(p.saved(n)).toBe(false);
  });
});

describe("createResendPolicy: another account", () => {
  it("forgets the last account's wait and tries, but keeps the live connection", () => {
    const p = createResendPolicy();
    p.connection(false);
    p.failed(drop());
    p.reset();
    expect(p.connection(true)).toBeNull();
    for (let i = 0; i < MAX_QUICK_RESENDS; i++) expect(p.failed(drop()).resendIn).toBe(RESEND_RETRY_MS);
    p.reset();
    expect(p.failed(drop()).resendIn).toBe(RESEND_RETRY_MS);
  });
});
