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

describe("/authorize", () => {
  const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
  const fakeConsent = (redirectUri, clientName = "Claude") => {
    const headers = new Headers();
    return {
      parseAuthRequest: vi.fn(async () => ({ clientId: "c1", redirectUri, scope: ["mcp:read"] })),
      describeConsent: vi.fn(async () => ({ clientName, redirectHost: new URL(redirectUri).hostname, redirectIsLoopback: false, scope: ["mcp:read"] })),
      beginConsent: vi.fn(async () => ({ handle: "h-1", headers })),
      approveConsent: vi.fn(async () => ({ request: { clientId: "c1", redirectUri, scope: ["mcp:read"] }, headers: new Headers() })),
      denyConsent: vi.fn(async () => ({ headers: new Headers({ Location: `${redirectUri}?error=access_denied` }) })),
      beginUpstream: vi.fn(async (_req, { headers }) => ({ state: "st-1", headers })),
    };
  };
  const handler = createAuthorizeHandler();
  const get = (o) => handler.fetch(new Request("https://loci.example.workers.dev/authorize?x=1"), env(o));
  const post = (o, fields) => handler.fetch(new Request("https://loci.example.workers.dev/authorize", { method: "POST", body: new URLSearchParams(fields) }), env(o));

  it("shows the consent page for an allowed app, with its name escaped", async () => {
    const o = fakeConsent(CLAUDE, `<img src=x onerror=alert(1)> & "Co"`);
    const res = await get(o);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('name="handle" value="h-1"');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&#60;img src=x onerror=alert(1)&#62;");
  });

  it("refuses an app whose redirect address is not on the list, before any consent is started", async () => {
    const o = fakeConsent("https://evil.example/cb", "Claude");
    const res = await get(o);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("That app is not on this connector's list of allowed apps.");
    expect(o.beginConsent).not.toHaveBeenCalled();
  });

  it("on approve, grants only the read scope whatever the form says, and sends the user to Google with PKCE", async () => {
    const o = fakeConsent(CLAUDE);
    const res = await post(o, { handle: "h-1", decision: "approve", scope: "mcp:write" });
    expect(o.approveConsent).toHaveBeenCalledWith(expect.anything(), "h-1", { scope: ["mcp:read"] });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("Location"));
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("state")).toBe("st-1");
    expect(to.searchParams.get("redirect_uri")).toBe("https://loci.example.workers.dev/callback");
  });

  it("does not go to Google if the approved request turns out to have a disallowed address", async () => {
    const o = fakeConsent("https://evil.example/cb");
    const res = await post(o, { handle: "h-1", decision: "approve" });
    expect(res.status).toBe(400);
    expect(o.beginUpstream).not.toHaveBeenCalled();
  });

  it("on deny, answers the app with access_denied and never reaches Google", async () => {
    const o = fakeConsent(CLAUDE);
    const res = await post(o, { handle: "h-1", decision: "deny" });
    expect(o.denyConsent).toHaveBeenCalled();
    expect(res.headers.get("Location")).toBe(`${CLAUDE}?error=access_denied`);
    expect(o.approveConsent).not.toHaveBeenCalled();
    expect(o.beginUpstream).not.toHaveBeenCalled();
  });
});
