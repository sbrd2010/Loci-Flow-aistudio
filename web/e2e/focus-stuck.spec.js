import { test, expect } from "@playwright/test";

// I'm stuck (59d) and Park a stray thought. Demo mode, so nothing reaches
// Firebase.

async function openSession(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.locator(".today-wall .wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  return overlay;
}

async function openStuck(page, overlay) {
  await overlay.getByRole("button", { name: "I'm stuck" }).click();
  const sheet = page.getByRole("dialog", { name: "Stuck?" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("Make the step smaller: it becomes the next step, and the timer runs again", async ({ page }) => {
  const overlay = await openSession(page);
  const sheet = await openStuck(page, overlay);
  await sheet.getByRole("button", { name: "Make the step smaller" }).click();
  await page.keyboard.type("Open the inbox");
  await page.keyboard.press("Enter");
  await expect(sheet).toHaveCount(0);
  await expect(overlay.locator(".focus-mode-concrete-step")).toHaveText("Next step — Open the inbox");
  await expect(overlay.getByLabel("Pause timer")).toBeVisible();
});

test("Switch to the next task: it becomes the one thing, and this one heads Today's list", async ({ page }) => {
  const overlay = await openSession(page);
  const title = (await overlay.getByRole("heading", { level: 1 }).innerText()).trim();
  const sheet = await openStuck(page, overlay);
  const switchBtn = sheet.getByRole("button", { name: /^Switch to the next task · / });
  const next = (await switchBtn.innerText()).replace(/^Switch to the next task · /, "").trim();
  await switchBtn.click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(".wall-title")).toHaveText(next);
  // Not started: the wall offers a fresh start.
  await expect(page.locator(".wall-primary")).toContainText("Start focus");
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  await expect(rows.nth(0).locator(".task-title-text")).toHaveText(title);
});

test("Talk it through with Coach: the task and its step wait in Coach's box; the session stays paused", async ({ page }) => {
  const overlay = await openSession(page);
  const title = (await overlay.getByRole("heading", { level: 1 }).innerText()).trim();
  const sheet = await openStuck(page, overlay);
  await sheet.getByRole("button", { name: "Talk it through with Coach" }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(".chat-input-row textarea")).toHaveValue(new RegExp(`^I'm stuck on "${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  const bar = page.getByRole("region", { name: "Focus session" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Resume focus timer" })).toBeVisible();
});

test("Park a stray thought: Enter parks it and counts it for this session", async ({ page }) => {
  const overlay = await openSession(page);
  const input = overlay.getByLabel("Capture a thought to Brain Dump");
  await input.fill("Buy stamps");
  await input.press("Enter");
  await input.fill("Call the landlord");
  await input.press("Enter");
  await expect(overlay.getByText("2 parked this session")).toBeVisible();
});
