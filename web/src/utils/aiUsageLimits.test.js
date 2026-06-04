import { describe, expect, it } from "vitest";
import {
  appendAIUsageWarning,
  checkAndRecordAIUsage,
  formatAIUsageWarning,
  getDailyAIUsageWarning,
} from "./aiUsageLimits";

function makeStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

function makeThrowingStorage() {
  return {
    getItem: () => { throw new Error("storage blocked"); },
    setItem: () => { throw new Error("storage blocked"); },
  };
}

describe("AI usage guardrails", () => {
  const now = new Date(2026, 5, 4, 15, 30, 0);

  it("records allowed AI usage for the signed-in user", () => {
    const storage = makeStorage();
    const result = checkAndRecordAIUsage({ userId: "user-a", now, storage });

    expect(result.allowed).toBe(true);
    expect(result.hourly).toEqual({ used: 1, limit: 40 });
    expect(result.daily).toEqual({ used: 1, limit: 120 });
  });

  it("blocks the 41st call in the same hour", () => {
    const storage = makeStorage();

    for (let i = 0; i < 40; i += 1) {
      expect(checkAndRecordAIUsage({ userId: "user-a", now, storage }).allowed).toBe(true);
    }

    const blocked = checkAndRecordAIUsage({ userId: "user-a", now, storage });
    expect(blocked.allowed).toBe(false);
    expect(blocked.limitType).toBe("hourly");
    expect(blocked.message).toContain("40/40");
  });

  it("allows a new hour while preserving the daily counter", () => {
    const storage = makeStorage();
    const nextHour = new Date(2026, 5, 4, 16, 0, 0);

    for (let i = 0; i < 40; i += 1) {
      checkAndRecordAIUsage({ userId: "user-a", now, storage });
    }

    const result = checkAndRecordAIUsage({ userId: "user-a", now: nextHour, storage });
    expect(result.allowed).toBe(true);
    expect(result.hourly.used).toBe(1);
    expect(result.daily.used).toBe(41);
  });

  it("blocks the 121st call in the same day", () => {
    const storage = makeStorage();

    for (let hour = 0; hour < 3; hour += 1) {
      const currentHour = new Date(2026, 5, 4, 10 + hour, 0, 0);
      for (let i = 0; i < 40; i += 1) {
        expect(checkAndRecordAIUsage({ userId: "user-a", now: currentHour, storage }).allowed).toBe(true);
      }
    }

    const blocked = checkAndRecordAIUsage({ userId: "user-a", now: new Date(2026, 5, 4, 13, 0, 0), storage });
    expect(blocked.allowed).toBe(false);
    expect(blocked.limitType).toBe("daily");
    expect(blocked.message).toContain("120/120");
  });

  it("keeps separate users isolated", () => {
    const storage = makeStorage();

    for (let i = 0; i < 40; i += 1) {
      checkAndRecordAIUsage({ userId: "user-a", now, storage });
    }

    const userA = checkAndRecordAIUsage({ userId: "user-a", now, storage });
    const userB = checkAndRecordAIUsage({ userId: "user-b", now, storage });

    expect(userA.allowed).toBe(false);
    expect(userB.allowed).toBe(true);
    expect(userB.hourly.used).toBe(1);
  });

  it("fails open when browser storage is unavailable", () => {
    const result = checkAndRecordAIUsage({ userId: "user-a", now, storage: makeThrowingStorage() });

    expect(result.allowed).toBe(true);
    expect(result.storageAvailable).toBe(false);
    expect(result.warning).toBeNull();
  });

  it("warns exactly when daily usage crosses 50%, 80%, 95%, and 100%", () => {
    expect(getDailyAIUsageWarning(59, 60)).toMatchObject({ threshold: "50%", used: 60, remaining: 60 });
    expect(getDailyAIUsageWarning(60, 61)).toBeNull();
    expect(getDailyAIUsageWarning(95, 96)).toMatchObject({ threshold: "80%", used: 96, remaining: 24 });
    expect(getDailyAIUsageWarning(113, 114)).toMatchObject({ threshold: "95%", used: 114, remaining: 6 });
    expect(getDailyAIUsageWarning(119, 120)).toMatchObject({ threshold: "100%", used: 120, remaining: 0, isExhausted: true });
  });

  it("formats warnings as user-facing messages", () => {
    expect(formatAIUsageWarning({ threshold: "80%", used: 96, limit: 120, remaining: 24 })).toContain("96/120");
    expect(formatAIUsageWarning({ threshold: "100%", used: 120, limit: 120, remaining: 0, isExhausted: true })).toContain("pause after this");
  });

  it("appends the warning without changing replies that do not need a warning", () => {
    expect(appendAIUsageWarning("Start with the first tiny step.", null)).toBe("Start with the first tiny step.");
    expect(appendAIUsageWarning("Start with the first tiny step.", { threshold: "50%", used: 60, limit: 120, remaining: 60 })).toContain("AI usage note");
  });
});
