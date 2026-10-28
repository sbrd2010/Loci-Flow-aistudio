import { describe, it, expect, vi } from "vitest";
import { deletionUpdate, tombstonePath, clearLocalLociData, deleteAllMyData } from "./deleteAccount";

vi.mock("firebase/database", () => ({ ref: vi.fn(), update: vi.fn() }));
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
  it("removes the payload and replaces the activity log with only the tombstone", () => {
    expect(deletionUpdate("u1", 123)).toEqual({
      "sync/u1": null,
      "activityLogs/u1": { accountDeletedAt: 123 },
    });
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

describe("deleteAllMyData", () => {
  const user = { uid: "u1" };
  const make = () => {
    const calls = [];
    return {
      calls,
      reauthenticate: vi.fn(async () => { calls.push("reauth"); }),
      deps: {
        ref: vi.fn(() => "root"),
        update: vi.fn(async (r, v) => { calls.push(["update", r, v]); }),
        deleteUser: vi.fn(async () => { calls.push("deleteUser"); }),
      },
    };
  };

  it("signs in again, then deletes the data in one update, then the account", async () => {
    const m = make();
    await deleteAllMyData({ db: {}, user, reauthenticate: m.reauthenticate, now: 5, deps: m.deps });
    expect(m.calls).toEqual(["reauth", ["update", "root", deletionUpdate("u1", 5)], "deleteUser"]);
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
