import { beforeEach, describe, expect, it, vi } from "vitest";

// The real package needs the Workers runtime. What is tested here is this
// project's decision logic, so the library's helpers are replaced by fakes.
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  AuthorizationError: class extends Error {},
  CimdFetchError: class extends Error {},
  authorizationErrorRedirect: (req, code) => `${req.redirectUri}?error=${code}`,
}));
const { createAuthorizeHandler } = await import("../src/authorize.js");

const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "");
const idToken = (email, over = {}) => `${b64({ alg: "RS256" })}.${b64({ iss: "https://accounts.google.com", aud: "cid", email, email_verified: true, ...over })}.sig`;

const env = (oauth) => ({
  OAUTH_PROVIDER: oauth, PUBLIC_URL: "https://loci.example.workers.dev", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec",
  ALLOWED_EMAIL: "owner@example.com", LOCI_UID: "uid-owner",
});

let oauth;
beforeEach(() => {
  oauth = {
    finishUpstream: vi.fn(async () => ({ request: { redirectUri: "https://chat.example.com/cb" }, data: { verifier: "v" }, headers: new Headers() })),
    completeAuthorization: vi.fn(async () => ({ redirectTo: "https://chat.example.com/cb?code=abc" })),
  };
});

const callback = (handler, query) => handler.fetch(
  new Request(`https://loci.example.workers.dev/callback?${query}`),
  env(oauth),
);
const withGoogle = (email, over) => createAuthorizeHandler({ fetchImpl: async () => Response.json({ id_token: idToken(email, over) }) });

describe("/callback", () => {
  it("grants read access for the owner's uid, and nothing broader, to the allowed account", async () => {
    const res = await callback(withGoogle("Owner@Example.com"), "code=g1&state=s");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://chat.example.com/cb?code=abc");
    expect(oauth.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      userId: "uid-owner", scope: ["mcp:read"], props: { uid: "uid-owner" },
    }));
  });

  it("never grants anything to another Google account", async () => {
    const res = await callback(withGoogle("intruder@example.com"), "code=g1&state=s");
    expect(res.headers.get("Location")).toBe("https://chat.example.com/cb?error=access_denied");
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
  });

  it("never grants anything to an unverified email, or an ID token meant for another app", async () => {
    for (const over of [{ email_verified: false }, { aud: "someone-elses-client" }]) {
      const res = await callback(withGoogle("owner@example.com", over), "code=g1&state=s");
      expect(res.headers.get("Location")).toContain("error=access_denied");
    }
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
  });

  it("sends access_denied back when Google reports an error or sends no code", async () => {
    for (const query of ["error=access_denied&state=s", "state=s"]) {
      const res = await callback(withGoogle("owner@example.com"), query);
      expect(res.headers.get("Location")).toBe("https://chat.example.com/cb?error=access_denied");
    }
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
  });

  it("fails with a plain message, not a stack, when Google rejects the exchange", async () => {
    const handler = createAuthorizeHandler({ fetchImpl: async () => new Response("bad", { status: 400 }) });
    const res = await callback(handler, "code=g1&state=s");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Something went wrong. Start again from the app.");
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
  });
});
