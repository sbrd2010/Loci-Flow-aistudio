import { test, expect } from "@playwright/test";
import { user, seed, payload, database, isolate, login, exposeSyncForReview } from "./local-fixture.js";

test("sign-out confirmation does not declare newer local edits saved", async ({ page, context }) => {
  const u = await user(); await seed(u); await isolate(context);
  await context.route("**/src/useSync.js*", async route => {
    const source = await (await route.fetch()).text();
    const instrumented = source.replace("update, runTransaction, get", "update, runTransaction as nativeTransaction, get");
    expect(instrumented).not.toBe(source);
    await route.fulfill({ contentType: "text/javascript", body: `${instrumented}\nconst runTransaction = (...args) => window.reviewTransaction ? window.reviewTransaction(nativeTransaction, ...args) : nativeTransaction(...args);` });
  });
  await login(page, u);
  await page.evaluate(() => {
    window.reviewTransaction = async (native, ...args) => {
      const result = await native(...args);
      window.confirmCommitted = true;
      await new Promise(resolve => { window.finishConfirm = resolve; });
      return result;
    };
    window.confirmation = window.review.flushNow({ confirm: true });
  });
  await expect.poll(() => page.evaluate(() => window.confirmCommitted)).toBe(true);
  const saved = await page.evaluate(async () => {
    window.review.saveConfigPatch({ mentorName: "Changed while signing out" });
    window.finishConfirm();
    return window.confirmation;
  });
  expect(saved).toBe(false);
  expect(await page.evaluate(() => window.review.payload.config.mentorName)).toBe("Changed while signing out");
});

for (const discard of [false, true]) {
  test(`offline Settings sign-out preserves unsynced work until ${discard ? "explicit discard is confirmed" : "a confirmed save after reconnect"}`, async ({ page, context }) => {
    const u = await user(); await seed(u);
    await isolate(context); await exposeSyncForReview(context);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, u, false);
    await expect.poll(() => page.evaluate(() => !!window.reviewSync?.payload?.tasks?.length)).toBe(true);
    await page.evaluate(async () => {
      await (await import("/src/firebase.js")).reviewOffline();
      const p = window.reviewSync.payload;
      window.reviewSync.savePayload({ ...p, tasks: [...p.tasks, {
        ...p.tasks[0], id: 2, uuid: "unsynced-task", title: "Unsaved task created offline", lastUpdated: Date.now(),
      }] });
    });
    await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
    const signOut = async () => {
      await page.getByRole("button", { name: "Sign out of Loci", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    };
    await signOut();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't finish saving" })).toBeVisible();
    // #650: the reason is named (offline, so the save can't confirm in 5 s).
    await expect(page.getByTestId("signout-reason")).toContainText("timeout-5s");
    await expect(page.getByTestId("signout-reason")).toContainText("offline");
    expect(await page.evaluate(() => window.reviewSync.payload.tasks.some(t => t.uuid === "unsynced-task"))).toBe(true);
    expect(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("loci_payload") && localStorage.getItem(k)?.includes("unsynced-task")))).toBe(true);
    if (discard) {
      await page.getByRole("button", { name: "Sign out without saving", exact: true }).click();
      await page.getByRole("button", { name: "Discard and sign out", exact: true }).click();
    } else {
      await page.evaluate(async () => (await import("/src/firebase.js")).reviewOnline());
      await signOut();
    }
    await expect(page.getByTestId("demo-btn")).toBeVisible();
    const saved = await (await database(u, `sync/${u.uid}`)).json();
    expect(saved.tasks.some(t => t.uuid === "unsynced-task")).toBe(!discard);
  });
}

// #664: sign-out doesn't reload the tab, so a reminder armed for the account
// that left must never show its task title on the signed-out screen. Service
// workers are blocked in this suite, so the app uses the plain Notification
// path; it is recorded here. Invented title, emulator account only.
async function seedReminderAndRecord(page, context, title, inMs) {
  const u = await user();
  const base = payload(u, title);
  await seed(u, { ...base, tasks: [{ ...base.tasks[0], reminderAt: Date.now() + inMs }], config: { ...base.config, onboardingComplete: true } });
  await context.grantPermissions(["notifications"]);
  await context.addInitScript(() => {
    delete Navigator.prototype.serviceWorker;
    window.__shown = [];
    const Native = window.Notification;
    const Recording = function (t, o) { window.__shown.push(`${t} | ${o?.body || ""}`); return new Native(t, o); };
    Recording.permission = Native.permission;
    Recording.requestPermission = Native.requestPermission.bind(Native);
    window.Notification = Recording;
  });
  await isolate(context);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, u, false);
  await expect(page.locator(".app-container")).toBeVisible();
  return Date.now();
}

test("control: a signed-in account's reminder is shown when due (#664)", async ({ page, context }) => {
  test.setTimeout(60_000);
  await seedReminderAndRecord(page, context, "Invented reminder task", 15_000);
  await expect.poll(() => page.evaluate(() => window.__shown), { timeout: 25_000 })
    .toContainEqual(expect.stringContaining("Invented reminder task"));
});

test("after signing out, the previous account's reminder is never shown (#664)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const seededAt = await seedReminderAndRecord(page, context, "Invented private task", 15_000);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out of Loci" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByTestId("demo-btn")).toBeVisible();
  expect(Date.now() - seededAt).toBeLessThan(15_000); // signed out before it was due
  await page.waitForTimeout(Math.max(0, seededAt + 18_000 - Date.now()));
  expect(await page.evaluate(() => window.__shown)).toEqual([]);
});
