import { test, expect } from "@playwright/test";

// #658: the shared date field. On a mouse/trackpad device a date is typed or
// picked on Loci's calendar; on a touch-primary device the browser's own
// picker stays. Saved values are still "YYYY-MM-DD".

async function enterDemo(page, viewport = { width: 1280, height: 860 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openKeyDeadline(page) {
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  // "Key deadline" on a phone, "Your goal" in the wide Settings list.
  await page.getByRole("button", { name: /^(Key deadline|Your goal)/ }).first().click();
}

test("desktop: a deadline is picked on the calendar with the keyboard only, and saved", async ({ page }) => {
  await enterDemo(page);
  await openKeyDeadline(page);
  const field = page.getByLabel("Deadline", { exact: true });
  // The demo's deadline is a year on.
  await expect(field).toHaveValue("15 Jun 2025");

  await field.focus();
  await page.keyboard.press("Tab");
  const open = page.getByRole("button", { name: "Deadline: choose on a calendar" });
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  const calendar = page.getByRole("dialog", { name: "Deadline: calendar" });
  await expect(calendar).toBeVisible();
  // The chosen day has focus; one day on, then take it.
  await expect(calendar.locator("button:focus")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(calendar).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(field).toHaveValue("16 Jun 2025");
  await expect(page.locator(".set-preview")).toContainText("366 days left");

  // Escape closes the calendar without changing anything, and gives focus back.
  await page.keyboard.press("Enter");
  await expect(calendar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(field).toHaveValue("16 Jun 2025");
});

test("desktop: a date can be typed; nonsense is refused with a hint and nothing changes", async ({ page }) => {
  await enterDemo(page);
  await openKeyDeadline(page);
  const field = page.getByLabel("Deadline", { exact: true });
  await field.fill("1 Jan 2026");
  await field.press("Enter");
  await expect(field).toHaveValue("1 Jan 2026");
  await expect(page.locator(".set-preview")).toContainText("565 days left");

  await field.fill("31 Feb 2026");
  await field.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Type a date like 13 Nov 2026");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".set-preview")).toContainText("565 days left");

  // Started can be cleared from its calendar.
  const started = page.getByLabel("Started", { exact: true });
  await started.fill("2024-06-01");
  await expect(started).toHaveValue("2024-06-01"); // a full date is taken at once; shown formatted after leaving
  await page.getByRole("button", { name: "Started: choose on a calendar" }).click();
  await page.getByRole("dialog", { name: "Started: calendar" }).getByRole("button", { name: "Clear" }).click();
  await expect(started).toHaveValue("");
});

// ChatGPT review of #668: Tab out of the open calendar closes it, and focus
// stays where the person moved it.
test("desktop: tabbing out of the open calendar closes it without pulling focus back", async ({ page }) => {
  await enterDemo(page);
  await openKeyDeadline(page);
  const open = page.getByRole("button", { name: "Deadline: choose on a calendar" });
  await open.click();
  const calendar = page.getByRole("dialog", { name: "Deadline: calendar" });
  await expect(calendar).toBeVisible();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  await expect(calendar).toHaveCount(0);
  await expect(open).not.toBeFocused();
  expect(await page.evaluate(() => !!document.activeElement?.closest(".df-pop"))).toBe(false);
});

// ChatGPT review of #668: a refused entry doesn't outlive a change made elsewhere.
test("desktop: a refused entry and its hint go when the date is changed elsewhere", async ({ page }) => {
  await enterDemo(page);
  await openKeyDeadline(page);
  const field = page.getByLabel("Deadline", { exact: true });
  await field.fill("31 Feb 2026");
  await field.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Type a date like 13 Nov 2026");
  await page.getByRole("button", { name: "Clear goal" }).click();
  await expect(field).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("desktop: a reminder day before today is refused", async ({ page }) => {
  await enterDemo(page);
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("button", { name: "More details" }).click();
  await dialog.getByRole("button", { name: "Set a reminder" }).click();
  const day = dialog.getByLabel("Reminder date", { exact: true });
  await day.fill("2024-06-14");
  await day.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Pick 15 Jun 2024 or later");
  // Days before today can't be picked on the calendar either.
  await dialog.getByRole("button", { name: "Reminder date: choose on a calendar" }).click();
  const calendar = dialog.getByRole("dialog", { name: "Reminder date: calendar" });
  await expect(calendar.getByRole("button", { name: /June 14th, 2024/ })).toBeDisabled();
  await expect(calendar.getByRole("button", { name: /June 16th, 2024/ })).toBeEnabled();
});

// Loopcheck of #668 ------------------------------------------------------

async function openReminder(page, title) {
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  if (title) await dialog.getByTestId("add-task-title").fill(title);
  await dialog.getByRole("button", { name: "More details" }).click();
  await dialog.getByRole("button", { name: "Set a reminder" }).click();
  return dialog;
}

test("desktop: ⌘↵ in the typed reminder day saves that day; a refused one stops it", async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ } });
  await enterDemo(page);
  const dialog = await openReminder(page, "Call the bank");
  const day = dialog.getByLabel("Reminder date", { exact: true });
  await day.fill("31 Feb 2024");
  await day.press("Control+Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Type a date like 13 Nov 2026");
  await expect(dialog).toBeVisible();
  await day.fill("16 Jun 2024");
  await day.press("Control+Enter");
  await expect(page.locator(".add-card")).toHaveCount(0, { timeout: 5_000 });
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { hasText: "Call the bank" });
  await expect(row).toContainText("Tomorrow");
});

test("desktop: clicks inside the calendar keep it open: a day before today, and its blank parts", async ({ page }) => {
  await enterDemo(page);
  const dialog = await openReminder(page);
  await dialog.getByRole("button", { name: "Reminder date: choose on a calendar" }).click();
  const calendar = dialog.getByRole("dialog", { name: "Reminder date: calendar" });
  await calendar.getByRole("button", { name: /June 14th, 2024/ }).click({ force: true });
  await expect(calendar).toBeVisible();
  await calendar.locator(".rdp-caption_label").click();
  await expect(calendar).toBeVisible();
  await expect(dialog.getByLabel("Reminder date", { exact: true })).not.toBeFocused();
});

test("desktop: in Edit horizons, Escape in the calendar closes only the calendar, and a typed end date adds in one click", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Edit horizons" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit horizons" });
  await dialog.getByRole("radio", { name: "Something else…" }).click();
  await dialog.locator("#eh-add-name").fill("Grant round");
  await dialog.getByRole("button", { name: "Ends: choose on a calendar" }).click();
  const calendar = dialog.getByRole("dialog", { name: "Ends: calendar" });
  await expect(calendar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#eh-add-name")).toHaveValue("Grant round");
  await dialog.getByLabel("Ends", { exact: true }).fill("30 Jun 2024");
  await dialog.getByRole("button", { name: "Add horizon" }).click();
  await expect(page.locator(".plan-rung", { hasText: "Grant round" })).toHaveCount(1);
});

test("desktop: if the calendar can't load, it says so and the app stays; typing still works", async ({ page }) => {
  await page.route("**/DayPickerPanel*", route => route.abort());
  await enterDemo(page);
  await openKeyDeadline(page);
  await page.getByRole("button", { name: "Deadline: choose on a calendar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The calendar couldn’t load. Type the date instead." })).toBeVisible();
  await expect(page.locator(".app-container")).toBeVisible();
  const field = page.getByLabel("Deadline", { exact: true });
  await field.fill("1 Jan 2026");
  await field.press("Enter");
  await expect(field).toHaveValue("1 Jan 2026");
});

test.describe("touch-primary device", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("keeps the browser's own date picker", async ({ page }) => {
    await enterDemo(page, { width: 390, height: 844 });
    await openKeyDeadline(page);
    const field = page.getByLabel("Deadline", { exact: true });
    await expect(field).toHaveAttribute("type", "date");
    await expect(page.getByRole("button", { name: /choose on a calendar/ })).toHaveCount(0);
    await field.fill("2024-06-25");
    await expect(page.locator(".set-preview")).toContainText("10 days left");
  });
});
