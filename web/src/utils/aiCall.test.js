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

function nvidiaOk(content = "NVIDIA reply.") {
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
    nvidiaKey: "",
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

  it("calls NVIDIA endpoint when NVIDIA key is provided and pref is nvidia", async () => {
    storage.setItem("loci_provider_pref", "nvidia");
    fetch.mockResolvedValue(nvidiaOk("Focus on the one task in front of you."));

    const reply = await callAI(baseRequest({ groqKey: "", nvidiaKey: "test-nvidia-key" }));

    expect(reply).toBe("Focus on the one task in front of you.");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
  });

  it("falls back through NVIDIA to Gemini when Groq fails in auto mode", async () => {
    fetch
      .mockResolvedValueOnce(providerError(429))   // Groq fails
      .mockResolvedValueOnce(providerError(503))   // NVIDIA fails
      .mockResolvedValueOnce(geminiOk("Gemini here."));

    const reply = await callAI(baseRequest({
      nvidiaKey: "test-nvidia-key",
      geminiKey: "test-gemini-key",
    }));

    expect(reply).toBe("Gemini here.");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(String(fetch.mock.calls[2][0])).toContain("generativelanguage.googleapis.com");
  });

  it("uses NVIDIA first then falls back to Groq when pref is nvidia and NVIDIA fails", async () => {
    storage.setItem("loci_provider_pref", "nvidia");
    fetch
      .mockResolvedValueOnce(providerError(503))   // NVIDIA fails
      .mockResolvedValueOnce(groqOk("Groq saved the day."));

    const reply = await callAI(baseRequest({ nvidiaKey: "test-nvidia-key" }));

    expect(reply).toBe("Groq saved the day.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("uses Gemini first when pref is gemini", async () => {
    storage.setItem("loci_provider_pref", "gemini");
    fetch.mockResolvedValue(geminiOk("Gemini first."));

    const reply = await callAI(baseRequest({ groqKey: "", geminiKey: "test-gemini-key" }));

    expect(reply).toBe("Gemini first.");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
  });

  it("throws no_key when all keys are empty", async () => {
    await expect(callAI(baseRequest({ groqKey: "", nvidiaKey: "", geminiKey: "" }))).rejects.toThrow("no_key");
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
