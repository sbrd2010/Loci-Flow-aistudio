import { test, expect } from "@playwright/test";

// #680, demo mode: Add task with a reminder waits for the notification
// prompt, then saves through the functional save against the live demo
// payload, and says "Added" only when it really was. The prompt is stubbed so
// the test decides when it answers.

async function setup(page, { at, eveningGuard = false }) {
  await page.addInitScript(({ eveningGuard }) => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
    let release;
    const answered = new Promise(r => { release = r; });
    window.__permissionAsks = 0;
    window.__releasePermission = (value) => release(value);
    class FakeNotification { constructor() {} close() {} }
    FakeNotification.permission = "default";
    FakeNotification.requestPermission = () => {
      window.__permissionAsks += 1;
      if (window.__permissionAsks === 1) return Promise.resolve("default"); // the first prompt, dismissed
      return answered.then(v => { FakeNotification.permission = v; return v; });
    };
    Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
    window.__LOCI_DEMO_FIXTURE__ = () => ({
      userId: "demo",
      tasks: [{ id: 1, uuid: "d1", userId: "demo", title: "Sample existing task", horizonLevel: "today", priority: "P3", category: "Personal", isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false, orderIndex: 0, dateCompletedString: null, lastUpdated: 1, subSteps: [] }],
      contributions: [], brainDump: [],
      config: { userId: "demo", userName: "Sample", isOnboardingCompleted: true, dayStartHour: 0, dayEndHour: 24, eveningGuardWindowActive: eveningGuard },
      timestamp: 1,
    });
  }, { eveningGuard });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(at);
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function addWithReminderAndHold(page, title) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByTestId("add-task-title").fill(title);
  await dialog.getByRole("button", { name: "More details" }).click();
  await dialog.getByRole("button", { name: "Set a reminder" }).click();
  await dialog.getByRole("group", { name: "Quick reminders" }).getByRole("button", { name: /^Tomorrow/ }).click();
  await dialog.getByTestId("add-task-submit").click();
  await expect.poll(() => page.evaluate(() => window.__permissionAsks)).toBe(2);
  return dialog;
}

test("demo: Add task waits for the permission prompt, then adds the task and says so", async ({ page }) => {
  await setup(page, { at: new Date("2024-06-15T10:00:00") });
  const dialog = await addWithReminderAndHold(page, "Sample demo reminder task");
  await expect(dialog.getByRole("status").filter({ hasText: "Added to Today" })).toHaveCount(0);
  await page.evaluate(() => window.__releasePermission("granted"));
  await expect(dialog.getByRole("status").filter({ hasText: "Added to Today" })).toBeVisible();
  await expect(page.getByTestId("today-tasks-list").getByText("Sample demo reminder task")).toBeVisible();
  await expect(page.getByTestId("today-tasks-list").getByTestId("task-row").filter({ hasText: "Sample demo reminder task" })).toContainText("Reminder");
  await expect(page.getByTestId("today-tasks-list").getByText("Sample existing task")).toBeVisible();
});

test("demo: if the Evening Guard starts while the prompt waits, nothing is added, it says why, and the draft stays", async ({ page }) => {
  await setup(page, { at: new Date("2024-06-15T19:59:30"), eveningGuard: true });
  const dialog = await addWithReminderAndHold(page, "Sample late demo task");
  await page.clock.setFixedTime(new Date("2024-06-15T20:00:30"));
  await page.evaluate(() => window.__releasePermission("granted"));
  await expect(dialog.getByText("Evening Guard is on: no new tasks at or after 8 PM. Rest now.")).toBeVisible();
  await expect(dialog.getByRole("status").filter({ hasText: "Added to Today" })).toHaveCount(0);
  await expect(dialog.getByTestId("add-task-title")).toHaveValue("Sample late demo task");
  await expect(page.getByTestId("today-tasks-list").getByText("Sample late demo task")).toHaveCount(0);
});

// Moved here from the signed-in spec (loopcheck of #681): the clock is fixed,
// so the reminder passes during the prompt without a real two-minute wait.
test("demo: a reminder time that passes while the prompt waits: the task is added without it", async ({ page }) => {
  await setup(page, { at: new Date("2024-06-15T10:00:00") });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByTestId("add-task-title").fill("Sample passing reminder task");
  await dialog.getByRole("button", { name: "More details" }).click();
  await dialog.getByRole("button", { name: "Set a reminder" }).click();
  const typed = dialog.getByLabel("Reminder time, typed");
  await typed.fill("1005");
  await typed.press("Enter");
  await dialog.getByTestId("add-task-submit").click();
  await expect.poll(() => page.evaluate(() => window.__permissionAsks)).toBe(2);
  await expect(dialog.getByRole("status").filter({ hasText: "Waiting for notification permission" })).toBeVisible();
  await page.clock.setFixedTime(new Date("2024-06-15T10:06:00"));
  await page.evaluate(() => window.__releasePermission("granted"));
  await expect(dialog.getByRole("status").filter({ hasText: "Added to Today" })).toBeVisible();
  const row = page.getByTestId("today-tasks-list").getByTestId("task-row").filter({ hasText: "Sample passing reminder task" });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Reminder");
});

test("demo: while the prompt waits, a click on the page behind does not close Add task", async ({ page }) => {
  await setup(page, { at: new Date("2024-06-15T10:00:00") });
  const dialog = await addWithReminderAndHold(page, "Sample backdrop task");
  await page.mouse.click(5, 5); // the dimmed backdrop, where a click also dismisses the browser's prompt
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.__releasePermission("granted"));
  await expect(dialog.getByRole("status").filter({ hasText: "Added to Today" })).toBeVisible();
});
