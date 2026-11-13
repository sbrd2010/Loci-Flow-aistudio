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
