import { describe, expect, it, beforeEach, vi } from "vitest";
import { get, set, clear } from "./insightsRecapCache";

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const validRecord = () => ({
  rangeEndDate: "2026-06-10",
  inputSignature: "sig1",
  promptVersion: 1,
  recap: "Loci recorded 3 completions this week.",
  generatedAt: 1750000000000,
});

describe("insightsRecapCache", () => {
  beforeEach(() => {
    global.localStorage = makeStorage();
  });

  it("get/set roundtrip returns exactly what was stored", () => {
    set("u1", "7d", validRecord());
    expect(get("u1", "7d")).toEqual(validRecord());
  });

  it("set overwrites the same (uid, rangeKey) key rather than accumulating", () => {
    set("u1", "7d", validRecord());
    const second = { ...validRecord(), recap: "Updated recap.", generatedAt: 1750000001000 };
    set("u1", "7d", second);
    expect(get("u1", "7d")).toEqual(second);
    expect(global.localStorage._map.size).toBe(1);
  });

  it("clear removes the stored record", () => {
    set("u1", "7d", validRecord());
    clear("u1", "7d");
    expect(get("u1", "7d")).toBeNull();
  });

  it("keeps separate records per rangeKey for the same uid", () => {
    set("u1", "7d", validRecord());
    set("u1", "30d", { ...validRecord(), rangeEndDate: "2026-06-30" });
    expect(get("u1", "7d").rangeEndDate).toBe("2026-06-10");
    expect(get("u1", "30d").rangeEndDate).toBe("2026-06-30");
  });

  it("keeps separate records per uid for the same rangeKey", () => {
    set("u1", "7d", validRecord());
    set("u2", "7d", { ...validRecord(), recap: "Different user's recap." });
    expect(get("u1", "7d").recap).toBe(validRecord().recap);
    expect(get("u2", "7d").recap).toBe("Different user's recap.");
  });

  it("get returns null for a missing key", () => {
    expect(get("u1", "7d")).toBeNull();
  });

  it("get returns null for malformed JSON instead of throwing", () => {
    global.localStorage.setItem("loci_insights_recap_u1_7d", "{not valid json");
    expect(() => get("u1", "7d")).not.toThrow();
    expect(get("u1", "7d")).toBeNull();
  });

  it("get returns null for a structurally invalid stored record (missing/wrong-typed fields)", () => {
    global.localStorage.setItem("loci_insights_recap_u1_7d", JSON.stringify({ recap: "" }));
    expect(get("u1", "7d")).toBeNull();

    global.localStorage.setItem("loci_insights_recap_u1_today", JSON.stringify({ ...validRecord(), promptVersion: "1" }));
    expect(get("u1", "today")).toBeNull();

    global.localStorage.setItem("loci_insights_recap_u1_30d", JSON.stringify(null));
    expect(get("u1", "30d")).toBeNull();
  });

  it("get returns null when localStorage.getItem throws (unavailable/security-restricted storage)", () => {
    global.localStorage.getItem = () => { throw new Error("SecurityError"); };
    expect(() => get("u1", "7d")).not.toThrow();
    expect(get("u1", "7d")).toBeNull();
  });

  it("set never throws when localStorage.setItem throws (quota exceeded)", () => {
    global.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => set("u1", "7d", validRecord())).not.toThrow();
  });

  it("clear never throws when localStorage.removeItem throws", () => {
    global.localStorage.removeItem = () => { throw new Error("SecurityError"); };
    expect(() => clear("u1", "7d")).not.toThrow();
  });

  it("get/set/clear are all no-ops when uid is falsy (covers Demo Mode, where uid is always null)", () => {
    const setItemSpy = vi.spyOn(global.localStorage, "setItem");
    expect(get(null, "7d")).toBeNull();
    expect(get(undefined, "7d")).toBeNull();
    expect(get("", "7d")).toBeNull();
    set(null, "7d", validRecord());
    set(undefined, "7d", validRecord());
    clear(null, "7d");
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(global.localStorage._map.size).toBe(0);
  });

  it("get/set/clear are no-ops for a non-whitelisted rangeKey", () => {
    set("u1", "not-a-real-range", validRecord());
    expect(get("u1", "not-a-real-range")).toBeNull();
    expect(global.localStorage._map.size).toBe(0);
  });

  it("never uses an email address or arbitrary object as the cache identity — only string uid + whitelisted rangeKey build the key", () => {
    set("someone@example.com", "7d", validRecord());
    // A different literal identity string must not collide with an unrelated one.
    expect(get("someone@example.com", "7d")).toEqual(validRecord());
    expect(get("someone", "7d")).toBeNull();
  });

  it("a matching cache record is returned immediately (no async delay) so it may display right away", () => {
    set("u1", "7d", validRecord());
    const result = get("u1", "7d");
    expect(result).not.toBeNull();
    expect(result.recap).toBe(validRecord().recap);
  });

  it("a stale record (caller-detected via isCacheRecordValid) is still returned structurally by get() — staleness is the caller's job, not the cache's", () => {
    // get() only validates SHAPE, not currency — confirms the cache module doesn't
    // silently hide a structurally-valid-but-stale record; InsightsPanel is
    // responsible for calling isCacheRecordValid() before treating it as current.
    set("u1", "7d", { ...validRecord(), inputSignature: "an-old-signature" });
    const result = get("u1", "7d");
    expect(result).not.toBeNull();
    expect(result.inputSignature).toBe("an-old-signature");
  });
});
