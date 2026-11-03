import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmBeforeSignOut, describeSignOutReason, flushOutcome, safeErrorCode, unknownRootKeyCount } from "./signOutFlush";

// #650: sign-out names why its save didn't confirm; it never signs out on an
// unconfirmed save.
describe("safeErrorCode: a code from a fixed list, never personal data", () => {
  it("uses the error's code, else the first word of its message", () => {
    expect(safeErrorCode({ code: "PERMISSION_DENIED" })).toBe("permission_denied");
    expect(safeErrorCode({ code: "auth/network-request-failed" })).toBe("auth/network-request-failed");
    expect(safeErrorCode(new Error("set"))).toBe("set");
    expect(safeErrorCode(new Error("permission_denied at /sync/uid-123: Client doesn't have permission"))).toBe("permission_denied");
    expect(safeErrorCode(new Error("maxretry"))).toBe("maxretry");
    expect(safeErrorCode(new Error("disconnect"))).toBe("disconnect");
  });
  it("anything not on the list is 'other': an email, a token, a task word", () => {
    expect(safeErrorCode(new Error("someone@example.test could not save"))).toBe("other");
    expect(safeErrorCode({ code: "eyJhbGciOiJSUzI1NiJ9.sample.token" })).toBe("other");
    expect(safeErrorCode(new Error("Dentist appointment failed"))).toBe("other");
    expect(safeErrorCode({ code: "auth/someone@example.test" })).toBe("other");
  });
  it("drops paths, ids, emails and anything after the first word", () => {
    const code = safeErrorCode(new Error("transaction not committed for someone@example.test at /sync/abc"));
    expect(code).toBe("not-committed");
    expect(safeErrorCode({ message: "/sync/uid-123 failed" })).toBe("other");
    expect(safeErrorCode(null)).toBe("unknown");
  });
});

describe("unknownRootKeyCount: tells a rules refusal from a sign-in refusal", () => {
  it("counts only top-level keys the rules don't allow", () => {
    expect(unknownRootKeyCount({ userId: "u", tasks: [], config: {}, chatHistory: [], contributions: [], brainDump: [], brainDumpUpdatedAt: 1, timestamp: 1 })).toBe(0);
    expect(unknownRootKeyCount({ userId: "u", tasks: [], config: {}, legacyThing: 1, other: {} })).toBe(2);
    expect(unknownRootKeyCount(null)).toBe(0);
  });
});

describe("flushOutcome", () => {
  it("confirmed only when the account is the same and nothing newer was edited", () => {
    expect(flushOutcome({ sameAccount: true, noNewerEdit: true })).toBe("confirmed");
    expect(flushOutcome({ sameAccount: true, noNewerEdit: false })).toBe("newer-edit-during-save");
    expect(flushOutcome({ sameAccount: false, noNewerEdit: true })).toBe("account-changed");
  });
});

describe("confirmBeforeSignOut", () => {
  afterEach(() => vi.useRealTimers());
  it("passes a confirmed save through", async () => {
    expect(await confirmBeforeSignOut(async () => ({ ok: true, reason: "confirmed" }))).toMatchObject({ ok: true, reason: "confirmed" });
  });
  it("a save that committed but a newer edit came in is not confirmed", async () => {
    expect(await confirmBeforeSignOut(async () => ({ ok: false, reason: "newer-edit-during-save" }))).toMatchObject({ ok: false, reason: "newer-edit-during-save" });
  });
  it("a refused save reports its code; an unexpected throw too", async () => {
    expect(await confirmBeforeSignOut(async () => ({ ok: false, reason: "write-error:permission_denied" }))).toMatchObject({ ok: false, reason: "write-error:permission_denied" });
    expect(await confirmBeforeSignOut(async () => { throw new Error("maxretry"); })).toMatchObject({ ok: false, reason: "write-error:maxretry" });
  });
  it("a save longer than 5 s is 'timed out', not refused, and a late success doesn't change it", async () => {
    vi.useFakeTimers();
    let finish;
    const flush = vi.fn(() => new Promise(r => { finish = r; }));
    const pending = confirmBeforeSignOut(flush, { now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: "timeout-5s" });
    finish({ ok: true, reason: "confirmed" });
    await vi.advanceTimersByTimeAsync(10);
    expect(result.ok).toBe(false);
    expect(flush).toHaveBeenCalledTimes(1); // no second save started
  });
  it("a timed-out save that settles later is reported through onLate", async () => {
    vi.useFakeTimers();
    let fail;
    const onLate = vi.fn();
    const pending = confirmBeforeSignOut(() => new Promise((_, rej) => { fail = rej; }), { onLate, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).reason).toBe("timeout-5s");
    fail(new Error("permission_denied at /sync/x"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(onLate).toHaveBeenCalledWith(expect.objectContaining({ ok: false, reason: "write-error:permission_denied" }));
  });
  it("anything without ok: true is not confirmed", async () => {
    expect((await confirmBeforeSignOut(async () => undefined)).ok).toBe(false);
    expect((await confirmBeforeSignOut(async () => ({ ok: "yes" }))).ok).toBe(false);
  });
});

describe("describeSignOutReason", () => {
  it("one plain sentence per reason", () => {
    expect(describeSignOutReason("timeout-5s")).toMatch(/within 5s.*may still finish/);
    expect(describeSignOutReason("newer-edit-during-save")).toMatch(/newer change/);
    expect(describeSignOutReason("write-error:permission_denied")).toMatch(/didn't accept.*permission_denied/);
    expect(describeSignOutReason("account-changed")).toMatch(/account changed/);
    expect(describeSignOutReason("auth-signout:auth/network-request-failed")).toMatch(/Saved, but signing out.*failed/);
    expect(describeSignOutReason("something-else")).toMatch(/wasn't confirmed/);
  });
});

// The wiring, guarded in the source (no harness renders App or the sync hook).
describe("sign-out safety wiring (#650)", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const sync = readFileSync(new URL("../useSync.js", import.meta.url), "utf8");
  const body = app.slice(app.indexOf("const handleSwitchUser"), app.indexOf("// #612: once the account is deleted"));
  it("nothing is cleared or signed out until the save is confirmed (or discard was chosen)", () => {
    const stop = body.indexOf("if (!saved.ok)");
    expect(stop).toBeGreaterThan(-1);
    expect(body.indexOf("return;", stop)).toBeLessThan(body.indexOf("clearCache()"));
    expect(body.indexOf("clearCache()")).toBeLessThan(body.indexOf("await signOut(auth)"));
    expect(body).toMatch(/if \(!discardUnsaved\) \{/);
  });
  it("sign-out asks for a confirmed save, and names a failed sign-out step", () => {
    expect(body).toMatch(/rtdbFlushNowDetailed\(\{ confirm: true \}\)/);
    expect(body).toMatch(/catch \(err\) \{\s*setSignOutReason\(\{ reason: `auth-signout:\$\{safeErrorCode\(err\)\}`/);
  });
  it("a late outcome is applied only to its own attempt, never a retry's", () => {
    expect(body).toMatch(/const attempt = \+\+signOutAttemptRef\.current;/);
    expect(body).toMatch(/prev\?\.attempt === attempt && prev\.reason\?\.startsWith\("timeout-"\)/);
    expect(body).toMatch(/const detail = \{ attempt, reason: saved\.reason/);
  });
  it("flushNow still resolves a plain boolean for its other callers", () => {
    expect(sync).toMatch(/const flushNow = \(options\) => flushNowDetailed\(options\)\.then\(r => r\.ok\);/);
  });
});
