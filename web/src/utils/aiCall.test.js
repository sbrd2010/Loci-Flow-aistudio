import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../firebase", () => ({
  auth: { currentUser: null },
}));

import { callAI, classifyAIError, describeAIError, extractJsonArray, resetProviderCooldowns } from "./aiCall";

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

function cerebrasOk(content = "Cerebras reply.") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function cerebrasArrayContent(text = "Cerebras parts reply.") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: [{ type: "text", text }] } }] }),
  };
}

function cerebrasEmpty(finishReason = "stop") {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: "" }, finish_reason: finishReason }],
      usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
    }),
  };
}

function geminiOk(content = "Gemini fallback reply.") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: content }] } }] }),
  };
}

function providerError(status, headers = {}) {
  return {
    ok: false,
    status,
    headers: { get: (name) => headers[name] ?? null },
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
    resetProviderCooldowns();
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

  it("sends reasoning_effort high and reasoning_budget 4096 in NVIDIA request body", async () => {
    storage.setItem("loci_provider_pref", "nvidia");
    fetch.mockResolvedValue(nvidiaOk("reply"));
    await callAI(baseRequest({ groqKey: "", nvidiaKey: "test-nvidia-key" }));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning_budget).toBe(4096);
    expect(body.stream).toBe(false);
  });

  it("NVIDIA respects a small caller maxTokens (700)", async () => {
    storage.setItem("loci_provider_pref", "nvidia");
    fetch.mockResolvedValue(nvidiaOk("reply"));
    await callAI(baseRequest({ groqKey: "", nvidiaKey: "test-nvidia-key", maxTokens: 700 }));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(700);
  });

  it("NVIDIA allows a large caller maxTokens (4000)", async () => {
    storage.setItem("loci_provider_pref", "nvidia");
    fetch.mockResolvedValue(nvidiaOk("reply"));
    await callAI(baseRequest({ groqKey: "", nvidiaKey: "test-nvidia-key", maxTokens: 4000 }));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4000);
  });

  it("NVIDIA defaults to 1500 when maxTokens is not provided", async () => {
    storage.setItem("loci_provider_pref", "nvidia");
    fetch.mockResolvedValue(nvidiaOk("reply"));
    await callAI(baseRequest({ groqKey: "", nvidiaKey: "test-nvidia-key", maxTokens: undefined }));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1500);
  });

  it("NVIDIA caps max_tokens at 4000 when caller requests more", async () => {
    storage.setItem("loci_provider_pref", "nvidia");
    fetch.mockResolvedValue(nvidiaOk("reply"));
    await callAI(baseRequest({ groqKey: "", nvidiaKey: "test-nvidia-key", maxTokens: 9999 }));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4000);
  });

  it("groq pref falls back through Cerebras then Gemini when Groq fails", async () => {
    storage.setItem("loci_provider_pref", "groq");
    fetch
      .mockResolvedValueOnce(providerError(429))   // Groq fails
      .mockResolvedValueOnce(providerError(503))   // Cerebras fails
      .mockResolvedValueOnce(geminiOk("Gemini emergency."));

    const reply = await callAI(baseRequest({
      cerebrasKey: "test-cerebras-key",
      geminiKey: "test-gemini-key",
    }));

    expect(reply).toBe("Gemini emergency.");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(String(fetch.mock.calls[2][0])).toContain("generativelanguage.googleapis.com");
  });

  it("falls back through Cerebras to Gemini when Groq fails in auto mode", async () => {
    fetch
      .mockResolvedValueOnce(providerError(429))   // Groq fails
      .mockResolvedValueOnce(providerError(503))   // Cerebras fails
      .mockResolvedValueOnce(geminiOk("Gemini here."));

    const reply = await callAI(baseRequest({
      cerebrasKey: "test-cerebras-key",
      geminiKey: "test-gemini-key",
    }));

    expect(reply).toBe("Gemini here.");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(String(fetch.mock.calls[2][0])).toContain("generativelanguage.googleapis.com");
  });

  it("auto mode does not include NVIDIA even when an NVIDIA key is present", async () => {
    fetch
      .mockResolvedValueOnce(providerError(429))   // Groq fails
      .mockResolvedValueOnce(geminiOk("Gemini skipped NVIDIA."));

    const reply = await callAI(baseRequest({
      nvidiaKey: "test-nvidia-key",
      geminiKey: "test-gemini-key",
    }));

    expect(reply).toBe("Gemini skipped NVIDIA.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(String(fetch.mock.calls[1][0])).toContain("generativelanguage.googleapis.com");
  });

  it("calls Cerebras endpoint with the gpt-oss-120b model when pref is cerebras", async () => {
    storage.setItem("loci_provider_pref", "cerebras");
    fetch.mockResolvedValue(cerebrasOk("Cerebras first."));

    const reply = await callAI(baseRequest({ groqKey: "", cerebrasKey: "test-cerebras-key" }));

    expect(reply).toBe("Cerebras first.");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-oss-120b");
  });

  it("parses Cerebras content given as an array of parts", async () => {
    storage.setItem("loci_provider_pref", "cerebras");
    fetch.mockResolvedValue(cerebrasArrayContent("Cerebras parts reply."));

    const reply = await callAI(baseRequest({ groqKey: "", cerebrasKey: "test-cerebras-key" }));

    expect(reply).toBe("Cerebras parts reply.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries Cerebras once with a larger token budget when finish_reason is length", async () => {
    storage.setItem("loci_provider_pref", "cerebras");
    fetch
      .mockResolvedValueOnce(cerebrasEmpty("length"))
      .mockResolvedValueOnce(cerebrasOk("Cerebras reply after retry."));

    const reply = await callAI(baseRequest({ groqKey: "", cerebrasKey: "test-cerebras-key" }));

    expect(reply).toBe("Cerebras reply after retry.");
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetch.mock.calls[0][1].body);
    const retryBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(retryBody.max_completion_tokens).toBeGreaterThan(firstBody.max_completion_tokens);
    // baseRequest's maxTokens (120) doubles to 240 — below the 1000-token
    // floor needed for gpt-oss-120b's reasoning overhead to actually recover.
    expect(retryBody.max_completion_tokens).toBe(1000);
  });

  it("does not retry Cerebras when content is empty but finish_reason is not length", async () => {
    storage.setItem("loci_provider_pref", "cerebras");
    fetch
      .mockResolvedValueOnce(cerebrasEmpty("stop"))   // Cerebras returns empty, no retry
      .mockResolvedValueOnce(groqOk("Groq saved it after Cerebras empty."));

    const reply = await callAI(baseRequest({ cerebrasKey: "test-cerebras-key" }));

    expect(reply).toBe("Groq saved it after Cerebras empty.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("does not retry Cerebras when the initial budget already equals the retry cap", async () => {
    storage.setItem("loci_provider_pref", "cerebras");
    fetch
      .mockResolvedValueOnce(cerebrasEmpty("length"))   // Cerebras at the cap, still empty
      .mockResolvedValueOnce(groqOk("Groq saved it after Cerebras at cap."));

    const reply = await callAI(baseRequest({ cerebrasKey: "test-cerebras-key", maxTokens: 4000 }));

    expect(reply).toBe("Groq saved it after Cerebras at cap.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("falls back to Gemini when Cerebras stays empty after a length retry", async () => {
    storage.setItem("loci_provider_pref", "cerebras");
    fetch
      .mockResolvedValueOnce(cerebrasEmpty("length"))   // Cerebras first attempt: length, empty
      .mockResolvedValueOnce(cerebrasEmpty("length"))   // Cerebras retry: still empty
      .mockResolvedValueOnce(providerError(503))         // Groq fails
      .mockResolvedValueOnce(geminiOk("Gemini answered instead."));

    const reply = await callAI(baseRequest({ cerebrasKey: "test-cerebras-key", geminiKey: "test-gemini-key" }));

    expect(reply).toBe("Gemini answered instead.");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("does not log prompt/message content when Cerebras returns an empty reply", async () => {
    storage.setItem("loci_provider_pref", "cerebras");
    fetch
      .mockResolvedValueOnce(cerebrasEmpty("stop"))
      .mockResolvedValueOnce(groqOk("Groq saved it."));
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    await callAI(baseRequest({
      cerebrasKey: "test-cerebras-key",
      systemPrompt: "SECRET_SYSTEM_PROMPT_TEXT",
      messages: [{ role: "user", content: "SECRET_USER_MESSAGE_TEXT" }],
    }));

    const loggedText = JSON.stringify(debugSpy.mock.calls);
    expect(loggedText).not.toContain("SECRET_SYSTEM_PROMPT_TEXT");
    expect(loggedText).not.toContain("SECRET_USER_MESSAGE_TEXT");
    expect(loggedText).not.toContain("test-cerebras-key");
  });

  it("cerebras pref falls back to Groq then Gemini when Cerebras fails", async () => {
    storage.setItem("loci_provider_pref", "cerebras");
    fetch
      .mockResolvedValueOnce(providerError(503))   // Cerebras fails
      .mockResolvedValueOnce(groqOk("Groq saved it."));

    const reply = await callAI(baseRequest({ cerebrasKey: "test-cerebras-key" }));

    expect(reply).toBe("Groq saved it.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("gemini pref falls back through Groq then Cerebras", async () => {
    storage.setItem("loci_provider_pref", "gemini");
    fetch
      .mockResolvedValueOnce(providerError(503))   // Gemini fails
      .mockResolvedValueOnce(providerError(503))   // Groq fails
      .mockResolvedValueOnce(cerebrasOk("Cerebras last resort."));

    const reply = await callAI(baseRequest({ cerebrasKey: "test-cerebras-key", geminiKey: "test-gemini-key" }));

    expect(reply).toBe("Cerebras last resort.");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetch.mock.calls[2][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
  });

  it("nvidia pref order still includes Cerebras after Groq", async () => {
    storage.setItem("loci_provider_pref", "nvidia");
    fetch
      .mockResolvedValueOnce(providerError(503))   // NVIDIA fails
      .mockResolvedValueOnce(providerError(503))   // Groq fails
      .mockResolvedValueOnce(cerebrasOk("Cerebras via nvidia pref."));

    const reply = await callAI(baseRequest({ nvidiaKey: "test-nvidia-key", cerebrasKey: "test-cerebras-key" }));

    expect(reply).toBe("Cerebras via nvidia pref.");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetch.mock.calls[2][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
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

  it("Gemini respects a small caller maxTokens (700)", async () => {
    storage.setItem("loci_provider_pref", "gemini");
    fetch.mockResolvedValue(geminiOk("reply"));
    await callAI(baseRequest({ groqKey: "", geminiKey: "test-gemini-key", maxTokens: 700 }));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.generationConfig.maxOutputTokens).toBe(700);
  });

  it("Gemini does not include maxOutputTokens when maxTokens is invalid or zero", async () => {
    storage.setItem("loci_provider_pref", "gemini");
    fetch.mockResolvedValue(geminiOk("reply"));
    await callAI(baseRequest({ groqKey: "", geminiKey: "test-gemini-key", maxTokens: 0 }));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.generationConfig).toBeUndefined();
  });

  it("throws no_key when all keys are empty", async () => {
    await expect(callAI(baseRequest({ groqKey: "", nvidiaKey: "", geminiKey: "" }))).rejects.toThrow("no_key");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends temperature 0.4 and top_p 0.9 in Groq request body", async () => {
    fetch.mockResolvedValue(groqOk("reply"));
    await callAI(baseRequest());
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.4);
    expect(body.top_p).toBe(0.9);
    expect(body.model).toBe("openai/gpt-oss-120b");
  });

  it("throws all_providers_failed when all providers fail with non-rate-limit errors", async () => {
    fetch
      .mockResolvedValueOnce(providerError(401))  // Groq 401
      .mockResolvedValueOnce(providerError(400))  // NVIDIA 400
      .mockResolvedValueOnce(providerError(400)); // Gemini 400

    await expect(callAI(baseRequest({
      nvidiaKey: "test-nvidia-key",
      geminiKey: "test-gemini-key",
    }))).rejects.toThrow("all_providers_failed");
  });

  it("preserves 429 error when all providers are rate-limited", async () => {
    fetch
      .mockResolvedValueOnce(providerError(429))  // Groq 429
      .mockResolvedValueOnce(providerError(429)); // NVIDIA 429

    await expect(callAI(baseRequest({ nvidiaKey: "test-nvidia-key" }))).rejects.toThrow("429");
  });

  it("throws invalid_key when every attempted provider fails with 401/403", async () => {
    fetch
      .mockResolvedValueOnce(providerError(401))  // Groq 401
      .mockResolvedValueOnce(providerError(403)); // NVIDIA 403

    await expect(callAI(baseRequest({ nvidiaKey: "test-nvidia-key" }))).rejects.toThrow("invalid_key");
  });

  it("prefers the real rate-limit over a fallback's unrelated auth failure (Groq 429 + backup 401)", async () => {
    fetch
      .mockResolvedValueOnce(providerError(429))  // Groq rate-limited — the real bottleneck
      .mockResolvedValueOnce(providerError(401)); // NVIDIA backup unauthorized

    // Must surface as the rate limit, not invalid_key — an unrelated backup
    // failure shouldn't make the user think their primary key is bad.
    await expect(callAI(baseRequest({ nvidiaKey: "test-nvidia-key" }))).rejects.toThrow("429");
  });

  it("prefers service_unavailable over a network-only secondary failure (Groq 503 + backup network error)", async () => {
    fetch
      .mockResolvedValueOnce(providerError(503))            // Groq busy
      .mockRejectedValueOnce(new TypeError("Failed to fetch")); // NVIDIA network failure

    await expect(callAI(baseRequest({ nvidiaKey: "test-nvidia-key" }))).rejects.toThrow("503");
  });

  it("throws network when every attempted provider fails with a network/fetch error", async () => {
    fetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(callAI(baseRequest({ nvidiaKey: "test-nvidia-key" }))).rejects.toThrow("network");
  });

  it("attempts each configured provider at most once per call (no hammering)", async () => {
    fetch
      .mockResolvedValueOnce(providerError(500))
      .mockResolvedValueOnce(providerError(500))
      .mockResolvedValueOnce(providerError(500));

    await expect(callAI(baseRequest({
      cerebrasKey: "test-cerebras-key",
      geminiKey: "test-gemini-key",
    }))).rejects.toThrow("all_providers_failed");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("classifyAIError", () => {
  it("classifies 429 as rate_limit", () => {
    expect(classifyAIError(new Error("429"))).toBe("rate_limit");
  });

  it("classifies 503 as service_unavailable", () => {
    expect(classifyAIError(new Error("503"))).toBe("service_unavailable");
  });

  it("classifies provider-prefixed 401/403 as invalid_key", () => {
    expect(classifyAIError(new Error("groq_401"))).toBe("invalid_key");
    expect(classifyAIError(new Error("nvidia_403"))).toBe("invalid_key");
  });

  it("classifies a TypeError (fetch/network failure) as network", () => {
    expect(classifyAIError(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("classifies an AbortError (timeout) as network", () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    expect(classifyAIError(abortErr)).toBe("network");
  });

  it("classifies anything else as unknown", () => {
    expect(classifyAIError(new Error("groq_400"))).toBe("unknown");
    expect(classifyAIError(new Error("groq_empty"))).toBe("unknown");
  });
});

describe("describeAIError", () => {
  it("describes each known error code with calm, non-technical copy that reassures task data is safe", () => {
    expect(describeAIError(new Error("429"))).toMatch(/temporarily busy or rate-limited.*tasks are safe/i);
    expect(describeAIError(new Error("503"))).toMatch(/temporarily unavailable.*tasks are safe/i);
    expect(describeAIError(new Error("invalid_key"))).toMatch(/invalid or unauthorized.*tasks are safe/i);
    expect(describeAIError(new Error("network"))).toMatch(/couldn.t reach the ai service.*tasks are safe/i);
    expect(describeAIError(new Error("no_key"))).toMatch(/add an ai key in settings/i);
  });

  it("uses the calm rate-limit-style message specifically for all_providers_failed", () => {
    expect(describeAIError(new Error("all_providers_failed")))
      .toBe("AI is temporarily busy or rate-limited. Your tasks are safe. Please wait a minute and try again.");
  });

  it("falls back to a neutral generic message for any other unrecognized code, without implying a rate limit", () => {
    const fallback = "Something went wrong. Your tasks are safe — please try again.";
    expect(describeAIError(new Error("something_unexpected"))).toBe(fallback);
  });

  it("never leaks a raw status code or provider name into the user-facing copy", () => {
    const codes = ["429", "503", "invalid_key", "network", "no_key", "all_providers_failed", "groq_401"];
    for (const code of codes) {
      const text = describeAIError(new Error(code));
      expect(text).not.toMatch(/groq|nvidia|gemini|\b401\b|\b403\b/i);
    }
  });
});

describe("AI provider cooldown and fallback", () => {
  let storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 4, 15, 30, 0));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", vi.fn());
    resetProviderCooldowns();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls through to Cerebras when Groq returns 429, with no 429 thrown", async () => {
    fetch
      .mockResolvedValueOnce(providerError(429))
      .mockResolvedValueOnce(cerebrasOk("Cerebras saved it."));

    const reply = await callAI(baseRequest({ cerebrasKey: "test-cerebras-key" }));

    expect(reply).toBe("Cerebras saved it.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetch.mock.calls[1][0]).toBe("https://api.cerebras.ai/v1/chat/completions");
  });

  it("skips Groq on the very next call after a 429 with no fallback configured", async () => {
    fetch.mockResolvedValueOnce(providerError(429));
    await expect(callAI(baseRequest())).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);

    // Immediate next call: Groq is cooling down and should be skipped entirely.
    await expect(callAI(baseRequest())).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After for Groq cooldown duration", async () => {
    fetch.mockResolvedValueOnce(providerError(429, { "Retry-After": "60" }));
    await expect(callAI(baseRequest())).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);

    // Still within the 60s Retry-After window: Groq stays skipped.
    vi.setSystemTime(new Date(2026, 5, 4, 15, 30, 30));
    await expect(callAI(baseRequest())).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);

    // Past the 60s window: Groq is attempted again.
    vi.setSystemTime(new Date(2026, 5, 4, 15, 31, 1));
    fetch.mockResolvedValueOnce(groqOk("Groq is back."));
    const reply = await callAI(baseRequest());
    expect(reply).toBe("Groq is back.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("does not create a cooldown for a non-429/503 Groq error", async () => {
    fetch.mockResolvedValueOnce(providerError(401));
    await expect(callAI(baseRequest())).rejects.toThrow("invalid_key");
    expect(fetch).toHaveBeenCalledTimes(1);

    // Immediate next call: Groq was not put on cooldown, so it's attempted again.
    fetch.mockResolvedValueOnce(groqOk("Groq retried fine."));
    const reply = await callAI(baseRequest());
    expect(reply).toBe("Groq retried fine.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("does not block a brand-new key on the same provider after the old key's 429", async () => {
    fetch.mockResolvedValueOnce(providerError(429));
    await expect(callAI(baseRequest({ nvidiaKey: "", groqKey: "old-key" }))).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);

    // Same provider, brand-new key: must be attempted, not skipped via the old key's cooldown.
    fetch.mockResolvedValueOnce(groqOk("New key works."));
    const reply = await callAI(baseRequest({ nvidiaKey: "", groqKey: "brand-new-key" }));
    expect(reply).toBe("New key works.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("still cools down the old key itself on a subsequent call with that same key", async () => {
    fetch.mockResolvedValueOnce(providerError(429));
    await expect(callAI(baseRequest({ nvidiaKey: "", groqKey: "old-key" }))).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);

    // Same provider, same old key: still on cooldown, skipped entirely.
    await expect(callAI(baseRequest({ nvidiaKey: "", groqKey: "old-key" }))).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("prefers a live invalid_key failure over a stale cooldown reason from an earlier call", async () => {
    // Groq gets rate-limited on the first call (no fallback configured yet) and cools down...
    fetch.mockResolvedValueOnce(providerError(429));
    await expect(callAI(baseRequest())).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);

    // ...next call: Groq is skipped (stale cooldown), and the only live attempt
    // (Cerebras) fails with a fresh, real 401. The stale 429 cooldown reason must
    // not mask the live invalid-key failure that's actually happening now.
    fetch.mockResolvedValueOnce(providerError(401));
    await expect(callAI(baseRequest({ cerebrasKey: "test-cerebras-key" }))).rejects.toThrow("invalid_key");
    expect(fetch).toHaveBeenCalledTimes(2); // first call's Groq 429 + second call's Cerebras 401 only
  });
});

describe("AI call diagnostics", () => {
  let storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 4, 15, 30, 0));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", vi.fn());
    resetProviderCooldowns();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs provider name, contextMode, and char counts only — never the key, fingerprint, or prompt/message content", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    fetch.mockResolvedValue(groqOk("reply"));

    const secretKey = "super-secret-groq-key-12345";
    const systemPrompt = "CONFIDENTIAL SYSTEM PROMPT CONTENT";
    await callAI(baseRequest({ groqKey: secretKey, systemPrompt, contextMode: "light" }));

    expect(debugSpy).toHaveBeenCalled();
    const loggedArgs = debugSpy.mock.calls.flat();
    const loggedText = loggedArgs.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");

    expect(loggedText).not.toContain(secretKey);
    expect(loggedText).not.toContain(systemPrompt);
    expect(loggedText).not.toContain("What should I do next?"); // message content from baseRequest()

    const loggedPayload = loggedArgs.find(a => typeof a === "object" && a !== null);
    expect(loggedPayload).toMatchObject({
      provider: "groq",
      outcome: "ok",
      contextMode: "light",
      systemPromptChars: systemPrompt.length,
    });
    expect(typeof loggedPayload.messagesChars).toBe("number");
    expect(typeof loggedPayload.approxTotalChars).toBe("number");
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
