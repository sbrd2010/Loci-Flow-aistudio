import { describe, expect, it, vi } from "vitest";
import { handleMcp } from "../src/mcp.js";

const env = { LOCI_UID: "u1", LOCI_TIMEZONE: "Asia/Kolkata", FIREBASE_DB_URL: "https://demo-default-rtdb.firebaseio.com", FIREBASE_SERVICE_ACCOUNT: "{}" };
const ctx = (over = {}) => ({ props: { uid: "u1" }, auth: { scope: ["mcp:read"] }, ...over });
const NOW = Date.UTC(2026, 9, 21, 19, 30, 0);

const rpc = (method, params = {}, id = 1) => new Request("https://x.test/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
});

// A stand-in for firebase.js: the token request, then the record.
const fakeFetch = (record, status = 200) => vi.fn(async (url) =>
  String(url).includes("oauth2") ? Response.json({ access_token: "tok", expires_in: 3600 })
    : status === 200 ? Response.json(record?.[String(url).split("/").pop().replace(".json", "")] ?? null) : new Response("nope", { status }));

describe("access checks", () => {
  it("refuses a token for another user, no user, or without the read scope", async () => {
    expect((await handleMcp(rpc("tools/list"), env, ctx({ props: { uid: "someone-else" } }))).status).toBe(403);
    expect((await handleMcp(rpc("tools/list"), env, ctx({ props: {} }))).status).toBe(403);
    expect((await handleMcp(rpc("tools/list"), env, ctx({ auth: { scope: [] } }))).status).toBe(403);
  });
});

describe("tools", () => {
  it("lists the page tools, every one marked read-only", async () => {
    const res = await handleMcp(rpc("tools/list"), env, ctx());
    const { result } = await res.json();
    expect(result.tools.map(t => t.name)).toEqual(["get_overview", "get_today", "get_day_map", "get_plan", "get_mind_box", "get_week", "get_stuck", "get_settings"]);
    for (const tool of result.tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  const call = async (name, args, record, extra = {}) => {
    const fetchImpl = fakeFetch(record);
    const res = await handleMcp(rpc("tools/call", { name, arguments: args }), { ...env, FIREBASE_SERVICE_ACCOUNT: await serviceAccount() }, ctx(), { fetchImpl, now: NOW, ...extra });
    const { result } = await res.json();
    const reads = fetchImpl.mock.calls.map(([url]) => String(url)).filter(u => !u.includes("oauth2")).map(u => u.split("/").pop().replace(".json", "")).sort();
    return { result, reads, body: result.isError ? null : JSON.parse(result.content[0].text) };
  };
  const plan = { tasks: [{ id: 1, userId: "u1", uuid: "a", title: "Draft section 2", horizonLevel: "week", priority: "P1", isCompleted: false, isParked: false, isDeleted: false }], config: { userId: "u1" }, contributions: [], brainDump: [{ id: "b", text: "a thought", createdAt: NOW, fmt: 1 }] };

  it("each tool fetches only the parts of the record it needs", async () => {
    expect((await call("get_mind_box", {}, plan)).reads).toEqual(["brainDump"]);
    expect((await call("get_settings", {}, plan)).reads).toEqual(["config"]);
    expect((await call("get_today", {}, plan)).reads).toEqual(["config", "tasks"]);
    expect((await call("get_week", {}, plan)).reads).toEqual(["config", "contributions", "tasks"]);
  });

  it("passes tool arguments through: a horizon for get_plan, a number of days for get_week", async () => {
    const { body } = await call("get_plan", { horizon: "week" }, plan);
    expect(body.horizons.map(h => h.id)).toEqual(["week"]);
    expect(body.horizons[0].tasks[0].title).toBe("Draft section 2");
    expect((await call("get_week", { days: 3 }, plan)).body.days).toHaveLength(3);
  });

  it("turns away arguments that are out of range instead of guessing", async () => {
    const res = await handleMcp(rpc("tools/call", { name: "get_week", arguments: { days: 9999 } }), { ...env, FIREBASE_SERVICE_ACCOUNT: await serviceAccount() }, ctx(), { fetchImpl: fakeFetch(plan), now: NOW });
    const out = await res.json();
    expect(out.error || out.result?.isError).toBeTruthy();
  });

  it("get_mind_box returns the thoughts", async () => {
    const { body } = await call("get_mind_box", {}, plan);
    expect(body.thoughts.map(x => x.text)).toEqual(["a thought"]);
  });

  it("get_overview returns the user's plan for today in their zone", async () => {
    const record = { userId: "u1", config: { userId: "u1" }, timestamp: 1, tasks: [{ id: 1, userId: "u1", uuid: "a", title: "Draft section 2", horizonLevel: "today", priority: "P1", timeEstimateMinutes: 50, isCompleted: false, isParked: false, isDeleted: false }] };
    const fetchImpl = fakeFetch(record);
    const res = await handleMcp(rpc("tools/call", { name: "get_overview", arguments: {} }), { ...env, FIREBASE_SERVICE_ACCOUNT: await serviceAccount() }, ctx(), { fetchImpl, now: NOW });
    const { result } = await res.json();
    const overview = JSON.parse(result.content[0].text);
    expect(overview.today).toBe("2026-10-22");
    expect(overview.todayList.tasks[0].title).toBe("Draft section 2");
    expect(overview.todayList.plannedMinutes).toBe(50);
    // Only ever reads: every call is a GET or the token POST.
    const methods = fetchImpl.mock.calls.map(([, init]) => init?.method ?? "GET");
    expect(methods).toEqual(["POST", "GET", "GET", "GET"]); // the token, then tasks, config, contributions
  });

  it("returns a plain error, with no internals, when the read fails", async () => {
    const res = await handleMcp(rpc("tools/call", { name: "get_overview", arguments: {} }), { ...env, FIREBASE_SERVICE_ACCOUNT: await serviceAccount() }, ctx(), { fetchImpl: fakeFetch(null, 403), now: NOW });
    const { result } = await res.json();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Could not read the Loci plan just now. Try again in a moment.");
  });
});

async function serviceAccount() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ client_email: "v@demo.iam.gserviceaccount.com", private_key: pem });
}
