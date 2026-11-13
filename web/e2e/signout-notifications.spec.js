import { test, expect } from "@playwright/test";

// #664: leaving a session (sign-out, or here leaving demo) doesn't reload the
// tab. A reminder armed for that session must never show its task title on
// the signed-out screen. The demo has a task with a reminder 2 hours ahead.
test.setTimeout(90_000);

async function enterDemoWithNotifications(page, context, baseURL) {
  await context.grantPermissions(["notifications"], { origin: new URL(baseURL).origin });
  // Record every notification the page shows, by either path.
  await page.addInitScript(() => {
    window.__shown = [];
    const record = (title, opts) => window.__shown.push(`${title} | ${opts?.body || ""}`);
    if (window.ServiceWorkerRegistration) {
      const show = ServiceWorkerRegistration.prototype.showNotification;
      ServiceWorkerRegistration.prototype.showNotification = function (title, opts) { record(title, opts); return show.call(this, title, opts); };
    }
    const Native = window.Notification;
    if (Native) {
      const Recording = function (title, opts) { record(title, opts); return new Native(title, opts); };
      Recording.permission = Native.permission;
      Recording.requestPermission = Native.requestPermission.bind(Native);
      window.Notification = Recording;
    }
  });
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 15_000 });
  // The service worker is registered on load; the reminder path waits for it.
  await page.evaluate(() => navigator.serviceWorker?.ready);
}

// Jump to just before the reminder, then let the last minutes run in order
// (one big jump can reschedule the reminder as already past before it fires).
async function passTheReminder(page) {
  await page.clock.fastForward("01:58:00");
  await page.clock.runFor(180_000);
}

const shown = (page) => page.evaluate(() => window.__shown);

test("control: in demo, the demo task's reminder is shown when due", async ({ page, context, baseURL }) => {
  await enterDemoWithNotifications(page, context, baseURL);
  await passTheReminder(page);
  await expect.poll(() => shown(page)).toContainEqual(expect.stringContaining("Task reminder"));
});

test("after leaving demo, the demo task's reminder is never shown (#664)", async ({ page, context, baseURL }) => {
  await enterDemoWithNotifications(page, context, baseURL);
  await page.getByRole("button", { name: "Exit" }).click();
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 10_000 });
  await passTheReminder(page);
  // Let any timer callback that started finish its await on the service worker.
  await page.waitForTimeout(1000);
  expect(await shown(page)).toEqual([]);
});
