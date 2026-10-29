import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

export const PROJECT = "demo-loci-review";
const NAMESPACE = `${PROJECT}-default-rtdb`;
export const PASSWORD = "Synthetic-review-password-42";

export async function user() {
  const email = `review-${randomUUID()}@example.test`;
  const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=review-key", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  expect(res.ok).toBe(true);
  const body = await res.json();
  return { uid: body.localId, token: body.idToken, email };
}

export function payload(u, title = "Synthetic review task") {
  return {
    userId: u.email,
    tasks: [{ id: 1, uuid: "review-task", title, userId: u.email, horizonLevel: "today", priority: "P3", lastUpdated: Date.now(), isDeleted: false }],
    config: { userId: u.email, userName: "Synthetic", onboardingDone: true },
    timestamp: Date.now(),
  };
}

export async function database(u, path, method = "GET", value) {
  const params = new URLSearchParams({ ns: NAMESPACE, auth: u.token });
  return fetch(`http://127.0.0.1:9000/${path}.json?${params}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

export async function seed(u, value = payload(u)) {
  const res = await database(u, `sync/${u.uid}`, "PUT", value);
  expect(res.ok, await res.text()).toBe(true);
}

export async function isolate(context) {
  const external = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(`${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await context.route("**/src/firebase.js*", async route => {
    // Reuse Vite's resolved Firebase import URLs, but never initialize the
    // production app. All connections are explicitly bound to local emulators.
    const source = await (await route.fetch()).text();
    const moduleUrl = name => {
      const match = source.match(new RegExp(`from "([^"\\n]*firebase_${name}\\.js[^"\\n]*)"`));
      if (!match) throw new Error(`Missing Vite Firebase ${name} module`);
      return match[1];
    };
    await route.fulfill({ contentType: "text/javascript", body: `
      import { initializeApp } from ${JSON.stringify(moduleUrl("app"))};
      import { getDatabase, connectDatabaseEmulator, forceLongPolling, goOffline, goOnline } from ${JSON.stringify(moduleUrl("database"))};
      import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from ${JSON.stringify(moduleUrl("auth"))};
      forceLongPolling();
      const app = initializeApp({ apiKey: "review-key", projectId: "${PROJECT}", databaseURL: "https://${NAMESPACE}.firebaseio.com" });
      export const db = getDatabase(app);
      connectDatabaseEmulator(db, "127.0.0.1", 9000);
      export const auth = getAuth(app);
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      export const reviewSignIn = email => signInWithEmailAndPassword(auth, email, ${JSON.stringify(PASSWORD)});
      export const reviewSignOut = () => signOut(auth);
      export const reviewOffline = () => goOffline(db);
      export const reviewOnline = () => goOnline(db);
      export const track = () => {};
      export const setAnalyticsUser = () => {};
    ` });
  });
  return external;
}

export async function login(page, u, hook = true) {
  await page.goto(hook ? "/alpha-review/hook.html" : "/");
  await page.evaluate(async email => (await import("/src/firebase.js")).reviewSignIn(email), u.email);
  if (hook) await expect.poll(() => page.evaluate(() => window.review?.payload?.tasks?.[0]?.title)).toBe("Synthetic review task");
}

export async function exposeSyncForReview(context) {
  // Test-only instrumentation so the full App can be driven into a precise
  // unsaved state while its real Settings sign-out UI remains under test.
  await context.route("**/src/useSync.js*", async route => {
    const source = await (await route.fetch()).text();
    const marker = "const effectiveLoading =";
    expect(source).toContain(marker);
    await route.fulfill({ contentType: "text/javascript", body: source.replace(marker,
      "window.reviewSync = { savePayload, payload: effectivePayload, flushNow }; const effectiveLoading =") });
  });
}
