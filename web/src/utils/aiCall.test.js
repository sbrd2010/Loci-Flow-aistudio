import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../firebase", () => ({
  auth: { currentUser: null },
}));

import { callAI, extractJsonArray } from "./aiCall";

function makeStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

function usageKeys(now = new Date()) {
  const pad2 = (value) => String(value).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const hour = `${day}T${pad2(now.getHours())}`;
  return {
    dayKey: `loci_ai_usage_v1:signed-out:day:${day}`,
    hourKey: `loci_ai_usage_v1:signed-out:hour:${hour}`,
  };
}

function seedUsage(storage, { daily = 0, hourly = 0 } = {}) {
  const keys = usageKeys(new Date());
  storage.setItem(keys.dayKey, daily);
  storage.setItem(keys.hourKey, hourly);
}

function groqOk(content = "One tiny step is enough.") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function geminiOk(content = "Gemini fallback reply.") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: content }] } }] }),
  };
}

function providerError(status) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message: String(status) } }),
  };
}

function baseRequest(overrides = {}) {
  return {
    groqKey: "test-groq-key",
    geminiKey: "",
    systemPrompt: "You are a focus coach.",
    messages: [{ role: "user", content: "What should I do next?" }],
    maxTokens: 120,
    ...overrides,
  };
}

describe("AI call resilience", () => {
  let storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 4, 15, 30, 0));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws a plain 429 error when Groq is rate-limited and no fallback key exists", async () => {
    fetch.mockResolvedValue(providerError(429));

    await expect(callAI(baseRequest())).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("falls back to Gemini when Groq fails and a Gemini key is present", async () => {
    fetch
      .mockResolvedValueOnce(providerError(429))
      .mockResolvedValueOnce(geminiOk("Use the smallest next step."));

    const reply = await callAI(baseRequest({ geminiKey: "test-gemini-key" }));

    expect(reply).toBe("Use the smallest next step.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toContain("generativelanguage.googleapis.com");
  });

  it("appends the 100 percent daily usage warning on the final allowed call", async () => {
    seedUsage(storage, { daily: 119, hourly: 0 });
    fetch.mockResolvedValue(groqOk("One tiny step is enough."));

    const reply = await callAI(baseRequest());

    expect(reply).toContain("One tiny step is enough.");
    expect(reply).toContain("120/120 daily AI calls");
    expect(reply).toContain("AI will pause after this until tomorrow");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a daily-limit message without calling an AI provider after the limit is reached", async () => {
    seedUsage(storage, { daily: 120, hourly: 0 });

    const reply = await callAI(baseRequest());

    expect(reply).toContain("AI daily limit reached");
    expect(reply).toContain("120/120");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("extractJsonArray", () => {
  it("parses a clean JSON array", () => {
    expect(extractJsonArray('["Open the doc", "Write one sentence"]')).toEqual(["Open the doc", "Write one sentence"]);
  });

  it("strips markdown code fences around a JSON array", () => {
    expect(extractJsonArray('```json\n["Open the doc"]\n```')).toEqual(["Open the doc"]);
  });

  it("extracts a JSON array wrapped in stray text", () => {
    const raw = 'Sure, here you go:\n["Open the doc", "Write one sentence"]\nHope that helps!';
    expect(extractJsonArray(raw)).toEqual(["Open the doc", "Write one sentence"]);
  });

  it("throws when no JSON array is present", () => {
    expect(() => extractJsonArray("Sorry, I can't help with that.")).toThrow();
  });

  it("throws when the parsed JSON is not an array", () => {
    expect(() => extractJsonArray('{"steps": ["Open the doc"]}')).toThrow();
  });
});
