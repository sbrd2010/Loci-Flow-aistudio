import { describe, it, expect, vi } from "vitest";
import { deletionUpdate, tombstonePath, clearLocalLociData, deleteAllMyData, markWipePending, finishPendingWipe } from "./deleteAccount";

vi.mock("firebase/database", () => ({ ref: vi.fn(), update: vi.fn(), get: vi.fn(), serverTimestamp: () => "SERVER_TIME" }));
vi.mock("firebase/auth", () => ({ deleteUser: vi.fn() }));

function memoryStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

describe("deletionUpdate (#612)", () => {
  it("removes the payload, leaves only the tombstone, and keeps a 30-day copy", () => {
    const copy = { email: "a@example.test", sync: { tasks: [] }, activityLogs: { events: {} } };
    expect(deletionUpdate("u1", copy)).toEqual({
      "deletedAccounts/u1": { deletedAt: "SERVER_TIME", email: "a@example.test", sync: { tasks: [] }, activityLogs: { events: {} } },
      "sync/u1": null,
      "activityLogs/u1": { accountDeletedAt: "SERVER_TIME" },
    });
    expect(deletionUpdate("u1")["deletedAccounts/u1"]).toEqual({ deletedAt: "SERVER_TIME", email: null, sync: null, activityLogs: null });
    expect(tombstonePath("u1")).toBe("activityLogs/u1/accountDeletedAt");
  });

  it("refuses without a uid, so it can never touch the root", () => {
    expect(() => deletionUpdate("")).toThrow();
    expect(() => deletionUpdate(undefined)).toThrow();
  });
});

describe("clearLocalLociData", () => {
  it("removes every loci_ key and nothing else", () => {
    const s = memoryStorage({ loci_payload_v1_u1: "{}", loci_theme: "dark", loci_groq_key: "x", other_app: "keep" });
    clearLocalLociData(s);
    expect(s.keys()).toEqual(["other_app"]);
  });

  it("does nothing without storage", () => {
    expect(() => clearLocalLociData(null)).not.toThrow();
  });
});

describe("finishPendingWipe", () => {
  const session = () => {
    const m = new Map();
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  };

  it("clears loci_ keys again on the load after a delete, once", () => {
    const local = memoryStorage({ loci_payload_v1_u1: "{}", other_app: "keep" });
    const s = session();
    markWipePending(s);
    expect(finishPendingWipe(local, s)).toBe(true);
    expect(local.keys()).toEqual(["other_app"]);
    expect(finishPendingWipe(memoryStorage({ loci_theme: "dark" }), s)).toBe(false);
  });

  it("does nothing on an ordinary load", () => {
    const local = memoryStorage({ loci_theme: "dark" });
    expect(finishPendingWipe(local, session())).toBe(false);
    expect(local.keys()).toEqual(["loci_theme"]);
  });
});

describe("deleteAllMyData", () => {
  const user = { uid: "u1", email: "a@example.test" };
  const make = () => {
    const calls = [];
    return {
      calls,
      reauthenticate: vi.fn(async () => { calls.push("reauth"); }),
      deps: {
        ref: vi.fn((db, path) => path || "root"),
        get: vi.fn(async (path) => { calls.push(["get", path]); return { val: () => ({ from: path }) }; }),
        update: vi.fn(async (r, v) => { calls.push(["update", r, v]); }),
        deleteUser: vi.fn(async () => { calls.push("deleteUser"); }),
      },
    };
  };

  it("signs in again, reads the server's data, then copies and deletes it in one update, then the account", async () => {
    const m = make();
    await deleteAllMyData({ db: {}, user, reauthenticate: m.reauthenticate, deps: m.deps });
    const copy = { email: "a@example.test", sync: { from: "sync/u1" }, activityLogs: { from: "activityLogs/u1" } };
    expect(m.calls).toEqual(["reauth", ["get", "sync/u1"], ["get", "activityLogs/u1"], ["update", "root", deletionUpdate("u1", copy)], "deleteUser"]);
  });

  it("deletes nothing when the data to keep can't be read", async () => {
    const m = make();
    m.deps.get.mockRejectedValueOnce(new Error("network"));
    await expect(deleteAllMyData({ db: {}, user, reauthenticate: m.reauthenticate, deps: m.deps })).rejects.toThrow("network");
    expect(m.deps.update).not.toHaveBeenCalled();
  });

  it("deletes nothing when the new sign-in fails or is cancelled", async () => {
    const m = make();
    m.reauthenticate.mockRejectedValueOnce(new Error("auth/popup-closed-by-user"));
    await expect(deleteAllMyData({ db: {}, user, reauthenticate: m.reauthenticate, deps: m.deps })).rejects.toThrow("popup-closed");
    expect(m.deps.update).not.toHaveBeenCalled();
    expect(m.deps.deleteUser).not.toHaveBeenCalled();
  });

  it("keeps the account when the data could not be deleted", async () => {
    const m = make();
    m.deps.update.mockRejectedValueOnce(new Error("network"));
    await expect(deleteAllMyData({ db: {}, user, reauthenticate: m.reauthenticate, deps: m.deps })).rejects.toThrow("network");
    expect(m.deps.deleteUser).not.toHaveBeenCalled();
  });

  it("says when the data is gone but the sign-in record is left", async () => {
    const m = make();
    m.deps.deleteUser.mockRejectedValueOnce(new Error("auth/network-request-failed"));
    await expect(deleteAllMyData({ db: {}, user, reauthenticate: m.reauthenticate, deps: m.deps })).rejects.toThrow("account_left");
  });

  it("refuses when nobody is signed in", async () => {
    const m = make();
    await expect(deleteAllMyData({ db: {}, user: null, reauthenticate: m.reauthenticate, deps: m.deps })).rejects.toThrow("not_signed_in");
    expect(m.reauthenticate).not.toHaveBeenCalled();
  });
});
