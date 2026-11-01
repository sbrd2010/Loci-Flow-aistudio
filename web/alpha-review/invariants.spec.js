import { test, expect } from "@playwright/test";
import { user, seed, payload, database, isolate, login } from "./local-fixture.js";

test("local emulators: separate accounts cannot access nested paths or mix owners in a PATCH", async () => {
  const a = await user(), b = await user();
  await seed(a); await seed(b);
  for (const path of [`sync/${a.uid}/tasks/0/title`, `sync/${a.uid}/config`, `activityLogs/${a.uid}`, `deletedAccounts/${a.uid}`]) {
    expect((await database(b, path)).status).toBe(401);
  }
  expect((await database(b, "", "PATCH", {
    [`sync/${a.uid}/tasks/0/title`]: "Cross-account attempt",
    [`sync/${b.uid}/tasks/0/title`]: "Own edit in rejected batch",
  })).status).toBe(401);
  expect((await (await database(b, `sync/${b.uid}`)).json()).tasks[0].title).toBe("Synthetic review task");
});

test("two signed-in clients preserve unrelated edits after an offline client reconnects", async ({ browser }) => {
  const u = await user(); await seed(u);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const c of contexts) await isolate(c);
    const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
    await login(a, u); await login(b, u);
    await b.evaluate(async () => (await import("/src/firebase.js")).reviewOffline());
    await b.evaluate(() => window.review.saveConfigPatch({ mentorName: "Offline coach" }));
    await a.evaluate(() => window.review.saveConfigPatch({ deadlineLabel: "Remote milestone" }));
    await expect.poll(async () => (await (await database(u, `sync/${u.uid}`)).json()).config.deadlineLabel).toBe("Remote milestone");
    await b.evaluate(async () => (await import("/src/firebase.js")).reviewOnline());
    for (const page of [a, b]) {
      await expect.poll(() => page.evaluate(() => window.review.payload?.config?.mentorName)).toBe("Offline coach");
      await expect.poll(() => page.evaluate(() => window.review.payload?.config?.deadlineLabel)).toBe("Remote milestone");
    }
  } finally { await Promise.all(contexts.map(c => c.close())); }
});

test("a normal task delete remains deleted when a stale client reconnects without editing it", async ({ browser }) => {
  const u = await user(); await seed(u);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const c of contexts) await isolate(c);
    const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
    await login(a, u); await login(b, u);
    await b.evaluate(async () => (await import("/src/firebase.js")).reviewOffline());
    await a.evaluate(async () => {
      const s = window.review;
      await s.savePayloadAsync({ ...s.payload, tasks: s.payload.tasks.map(t => ({ ...t, isDeleted: true, lastUpdated: Date.now() })) });
    });
    await b.evaluate(async () => (await import("/src/firebase.js")).reviewOnline());
    await expect.poll(() => b.evaluate(() => window.review.payload?.tasks?.[0]?.isDeleted)).toBe(true);
    expect((await (await database(u, `sync/${u.uid}`)).json()).tasks[0].isDeleted).toBe(true);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});

test("signing out through Settings removes personal AI keys before the next account", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const a = await user(); await seed(a, { ...payload(a), config: { ...payload(a).config, onboardingDone: true, onboardingComplete: true } });
  await isolate(context); await login(page, a, false);
  await expect(page.locator(".app-container")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("loci_groq_key", "synthetic-personal-key"));
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out of Loci" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByTestId("demo-btn")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("loci_groq_key"))).toBeNull();
});

test("two real browser tabs cannot both acquire the focus-session lock", async ({ context }) => {
  await isolate(context);
  const a = await context.newPage(), b = await context.newPage();
  await a.goto("/alpha-review/hook.html"); await b.goto("/alpha-review/hook.html");
  const claim = page => page.evaluate(async () => (await import("/src/utils/openFocusSession.js")).claimSessionLock());
  expect(await claim(a)).toBe(true);
  expect(await claim(b)).toBe(false);
  await a.evaluate(async () => (await import("/src/utils/openFocusSession.js")).dropSessionLock());
  expect(await claim(b)).toBe(true);
});

test("an offline client cannot restore data after account deletion", async ({ browser }) => {
  const u = await user(); await seed(u);
  const context = await browser.newContext();
  try {
    await isolate(context); const page = await context.newPage(); await login(page, u);
    await page.evaluate(async () => (await import("/src/firebase.js")).reviewOffline());
    await page.evaluate(() => {
      const p = window.review.payload;
      window.review.savePayload({ ...p, tasks: p.tasks.map(t => ({ ...t, title: "Offline edit before deletion", lastUpdated: Date.now() })) });
    });
    const snapshot = await (await database(u, `sync/${u.uid}`)).json();
    const time = { ".sv": "timestamp" };
    expect((await database(u, "", "PATCH", {
      [`sync/${u.uid}`]: null,
      [`activityLogs/${u.uid}`]: { accountDeletedAt: time },
      [`deletedAccounts/${u.uid}`]: { deletedAt: time, sync: snapshot },
    })).ok).toBe(true);
    await page.evaluate(async () => (await import("/src/firebase.js")).reviewOnline());
    await expect.poll(() => page.evaluate(() => window.review.accountDeleted)).toBe(u.uid);
    expect(await (await database(u, `sync/${u.uid}`)).json()).toBeNull();
    // The queued save must also be refused by the rules with the old token.
    expect((await database(u, `sync/${u.uid}`, "PUT", snapshot)).status).toBe(401);
  } finally { await context.close(); }
});

