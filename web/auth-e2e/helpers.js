import { test as base, expect } from "@playwright/test";

export const PROJECT = "demo-loci-flow-e2e";
export const ORIGIN = "http://127.0.0.1:5175";
const DATABASE = "http://127.0.0.1:9000";
const AUTH = "http://127.0.0.1:9099";
const OWNER = { Authorization: "Bearer owner" }; // Emulator-only administrative credential.

export function databaseUrl(path) {
  return `${DATABASE}/${path}.json?ns=${PROJECT}-default-rtdb`;
}

export async function readServer(request, uid) {
  const response = await request.get(databaseUrl(`sync/${uid}`), { headers: OWNER });
  expect(response.ok()).toBe(true);
  return response.json();
}

function fixture(email) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const task = (uuid, title, id) => ({
    id, uuid, title, userId: email, concreteStep: "Open the sample folder",
    horizonLevel: "today", priority: "P2", category: "Personal", timeEstimateMinutes: 25,
    isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false,
    orderIndex: id, lastUpdated: now - 60_000,
  });
  return {
    userId: email,
    tasks: [task("seed-a", "Sort sample notes", 1), task("seed-b", "Water sample plants", 2)],
    config: {
      userId: email, userName: "Alpha Tester", mentorName: "Coach",
      isOnboardingCompleted: true, eveningGuardWindowActive: false,
      dayStartHour: 0, dayEndHour: 24, morningRitualShownDate: day,
      pomodoroDurationMinutes: 25, lastUpdated: now - 60_000,
    },
    timestamp: now - 60_000,
  };
}

export async function currentUid(page) {
  return page.evaluate(async () => (await import("/src/firebase.js")).auth.currentUser?.uid || null);
}

export async function signIn(page, email, { navigate = true } = {}) {
  if (navigate) await page.goto("/");
  // Fail before authentication or data access if the test server is misconfigured.
  expect(await page.evaluate(async () => (await import("/src/firebase.js")).auth.app.options.projectId)).toBe(PROJECT);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  const popup = await popupPromise;
  await popup.getByText("Add new account", { exact: true }).waitFor();
  // The emulator renders its buttons before a blocking external script and
  // the inline handlers. Wait on the widget document, not its initial blank page.
  await popup.waitForLoadState("domcontentloaded");
  const existing = popup.getByText(email, { exact: true });
  if (await existing.count()) {
    await existing.click();
  } else {
    await popup.getByText("Add new account", { exact: true }).click();
    await popup.locator("#email-input").fill(email);
    await popup.locator("#display-name-input").fill("Alpha Tester");
    await popup.getByRole("button", { name: "Sign in with Google.com", exact: true }).click();
  }
  await expect.poll(() => currentUid(page)).toBeTruthy();
  return currentUid(page);
}

export async function appReady(page) {
  await expect(page.locator(".app-container")).toBeVisible();
  await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  await expect(page.getByText("↻ Syncing with cloud…", { exact: true })).toHaveCount(0);
}

export const row = (page, title) => page.getByTestId("today-tasks-list").getByTestId("task-row").filter({ hasText: title });

export async function addTask(page, title) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByTestId("add-task-title").fill(title);
  await dialog.getByTestId("add-task-submit").click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, title)).toBeVisible();
}

export async function renameTask(page, from, to) {
  await row(page, from).locator(".task-title-text").click();
  const sheet = page.getByTestId("task-detail");
  await sheet.locator(".detail-title").click();
  await sheet.getByLabel("Title", { exact: true }).fill(to);
  await sheet.getByLabel("Title", { exact: true }).press("Enter");
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(row(page, to)).toBeVisible();
}

// discardUnsaved: a save the server never confirmed makes sign-out stop at
// "Couldn't finish saving" after 5 s; the user then has to discard on purpose.
export async function signOut(page, { discardUnsaved = false } = {}) {
  await page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /^Sign out(?: of Loci)?$/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out", exact: true }).click();
  if (discardUnsaved) {
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't finish saving" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out without saving", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Discard and sign out", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  expect(await currentUid(page)).toBeNull();
}

export async function cachedTasks(client) {
  return client.page.evaluate(uid => JSON.parse(localStorage.getItem(`loci_payload_v1_${uid}`))?.payload?.tasks || [], client.uid);
}

// Forward real traffic to the emulator, but hold the server's answer to the
// marked write. This lets the server commit a write while the browser is
// still awaiting its result.
//
// Two transports (#652): the SDK's default is WebSocket, with long-polling
// (HTTP) only as a fallback. Over HTTP, a response containing the marker is
// held. Over WebSocket, the page's frame carrying the marker is tagged by its
// request id; from the first server frame that answers it (or carries the
// marker) every later server frame waits too, in order, as a delayed
// connection would — until release().
export async function responseBarrier(context) {
  let active = false;
  let held = 0;
  let closed = false;
  let marker = "";
  let release = () => {};
  let gate = Promise.resolve();
  context.on("close", () => { closed = true; release(); });
  await context.route(`${DATABASE}/**`, async route => {
    try {
      const response = await route.fetch({ timeout: 60_000 });
      if (active && (await response.text()).includes(marker)) { held += 1; await gate; }
      if (!closed) await route.fulfill({ response });
    } catch (error) {
      if (!closed) throw error;
    }
  });
  const requestId = (text) => { try { return JSON.parse(text)?.d?.r; } catch { return undefined; } };
  await context.routeWebSocket(url => url.host === new URL(DATABASE).host, ws => {
    const server = ws.connectToServer();
    const marked = new Set();
    let queue = Promise.resolve();
    let holding = false;
    ws.onMessage(message => {
      const text = String(message);
      if (active && text.includes(marker)) { const r = requestId(text); if (r !== undefined) marked.add(r); }
      server.send(message);
    });
    server.onMessage(message => {
      const text = String(message);
      queue = queue.then(async () => {
        if (active && !holding && (text.includes(marker) || marked.has(requestId(text)))) {
          holding = true;
          held += 1;
        }
        if (holding) await gate;
        if (!active) holding = false;
        if (!closed) ws.send(message);
      }).catch(() => {});
    });
  });
  return {
    hold(text) { marker = text; active = true; held = 0; gate = new Promise(resolve => { release = resolve; }); },
    release() { active = false; release(); },
    count() { return held; },
  };
}

export const test = base.extend({
  clients: async ({ browser, request }, provide) => {
    const cleared = await request.delete(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`);
    expect(cleared.ok()).toBe(true);
    const emptied = await request.put(databaseUrl(""), { headers: OWNER, data: null });
    expect(emptied.ok()).toBe(true);
    // A wrong/empty emulator namespace defaults to permissive rules. Fail
    // immediately rather than reporting a false security/sync test success.
    const anonymous = await request.get(databaseUrl("sync/unauthorized"));
    expect(anonymous.status()).toBe(401);
    const opened = [];
    const seeded = new Map();
    const clients = {
      request,
      async open(email = "alpha-a@example.test", { phone = false, setupContext, onboarding = false } = {}) {
        const context = await browser.newContext({
          baseURL: ORIGIN,
          viewport: phone ? { width: 375, height: 812 } : { width: 1280, height: 800 },
        });
        opened.push(context);
        if (setupContext) await setupContext(context);
        await context.addInitScript(() => localStorage.setItem("loci_today_peek_open", "1"));
        const page = await context.newPage();
        const uid = await signIn(page, email);
        if (onboarding) {
          seeded.set(email, uid);
          return { page, context, uid, email };
        }
        const isNew = !seeded.has(email);
        if (isNew) {
          // Let new-account initialization commit, then stop this page before
          // preparing fixtures. All subsequent test edits go through the UI.
          await expect.poll(async () => !!(await readServer(request, uid))?.tasks).toBe(true);
          await page.goto("about:blank");
          const saved = await request.put(databaseUrl(`sync/${uid}`), { headers: OWNER, data: fixture(email) });
          expect(saved.ok()).toBe(true);
          seeded.set(email, uid);
          // New-account starter tasks were cached by the real sign-in path.
          // Remove that fixture-setup cache once, before the next app mount,
          // so it cannot legitimately merge starter tasks into the seed.
          await page.addInitScript(id => {
            const marker = `auth-sync-fixture-loaded:${id}`;
            if (!sessionStorage.getItem(marker)) {
              localStorage.removeItem(`loci_payload_v1_${id}`);
              sessionStorage.setItem(marker, "1");
            }
          }, uid);
          await page.goto("/");
        }
        expect(uid).toBe(seeded.get(email));
        await appReady(page);
        await expect(row(page, "Sort sample notes")).toBeVisible();
        if (isNew) {
          await expect.poll(async () => (await readServer(request, uid)).tasks.map(t => t.uuid).sort()).toEqual(["seed-a", "seed-b"]);
        }
        return { page, context, uid, email };
      },
      async fresh(email) {
        // A new browser context has neither the other client's cache nor auth.
        const context = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 1280, height: 800 } });
        opened.push(context);
        await context.addInitScript(() => localStorage.setItem("loci_today_peek_open", "1"));
        const page = await context.newPage();
        const uid = await signIn(page, email);
        expect(uid).toBe(seeded.get(email));
        await appReady(page);
        return { page, context, uid, email };
      },
    };
    try { await provide(clients); }
    finally {
      await Promise.all(opened.map(async context => {
        // Only teardown: outstanding long-poll fetches are canceled when the
        // context closes. Functional route failures still fail the test.
        await context.unrouteAll({ behavior: "ignoreErrors" });
        await context.close();
      }));
    }
  },
});

export { expect };
