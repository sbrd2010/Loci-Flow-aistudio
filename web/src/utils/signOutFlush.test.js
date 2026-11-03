import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmBeforeSignOut, describeSignOutReason, flushOutcome, safeErrorCode } from "./signOutFlush";

// #650: sign-out names why its save didn't confirm; it never signs out on an
// unconfirmed save.
describe("safeErrorCode: a short code, never personal data", () => {
  it("uses the error's code, else the first word of its message", () => {
    expect(safeErrorCode({ code: "PERMISSION_DENIED" })).toBe("PERMISSION_DENIED");
    expect(safeErrorCode(new Error("permission_denied at /sync/uid-123: Client doesn't have permission"))).toBe("permission_denied");
    expect(safeErrorCode(new Error("maxretry"))).toBe("maxretry");
    expect(safeErrorCode(new Error("disconnect"))).toBe("disconnect");
  });
  it("drops paths, ids, emails and anything after the first word", () => {
    const code = safeErrorCode(new Error("transaction not committed for someone@example.test at /sync/abc"));
    expect(code).toBe("not-committed");
    expect(safeErrorCode({ message: "/sync/uid-123 failed" })).not.toMatch(/uid|sync/);
    expect(safeErrorCode(null)).toBe("unknown");
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
  it("flushNow still resolves a plain boolean for its other callers", () => {
    expect(sync).toMatch(/const flushNow = \(options\) => flushNowDetailed\(options\)\.then\(r => r\.ok\);/);
  });
});
