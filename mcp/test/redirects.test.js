import { describe, expect, it } from "vitest";
import { redirectAllowed } from "../src/config.js";

describe("redirectAllowed", () => {
  it("accepts the addresses Claude and ChatGPT use", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "https://chatgpt.com/connector/oauth/abc123",
      "https://chatgpt.com/connector_platform_oauth_redirect",
    ]) expect(redirectAllowed(ok)).toBe(true);
  });

  it("refuses everything else, including look-alikes", () => {
    for (const bad of [
      "https://evil.example/cb",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "https://claude.ai@evil.example/api/mcp/auth_callback",
      "https://evil.example/https://claude.ai/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/auth_callback/extra",
      "https://claude.ai/some/other/page",
      "https://chatgpt.com/connector/oauth/",
      "https://chatgpt.com/connector/oauthevil",
      "https://chatgpt.com/other",
      "http://localhost:3000/callback",
      "javascript:alert(1)",
      "not a url",
      "",
      undefined,
    ]) expect(redirectAllowed(bad), String(bad)).toBe(false);
  });

  it("takes extra addresses from EXTRA_REDIRECT_URIS, in the same format", () => {
    const env = { EXTRA_REDIRECT_URIS: " https://app.example.com/callback , https://other.example.com/oauth/ " };
    expect(redirectAllowed("https://app.example.com/callback", env)).toBe(true);
    expect(redirectAllowed("https://other.example.com/oauth/xyz", env)).toBe(true);
    expect(redirectAllowed("https://app.example.com/other", env)).toBe(false);
    expect(redirectAllowed("https://evil.example/cb", env)).toBe(false);
  });
});
