import { test, expect } from "@playwright/test";

// Fixed time (58c–e). Demo mode at 11:35: Auto-fill lays three 25-minute
// stops from 11:45 (11:45, 12:15, 12:45). Nothing reaches Firebase.

async function openDayMap(page, viewport = { width: 1280, height: 800 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await expect(page.locator(".dm-stop")).toHaveCount(3);
}

const route = (page) => page.getByRole("list", { name: "Today's route" });
const times = (page) => route(page).locator(".dm-stop .dm-time").allInnerTexts();

test("Something else, fixed at 12:30: the route flows around it, moved stops say where they were, Undo puts it back (58c–e)", async ({ page }) => {
  await openDayMap(page);
  const titles = (await route(page).locator(".dm-stop .dm-title").allInnerTexts()).map(t => t.trim());

  await page.getByRole("button", { name: "Fixed time" }).click();
  const dialog = page.getByRole("dialog", { name: "Fix a time" });
  // Step 1: today's route, with each stop's time and length.
  await expect(dialog.locator(".fx-option")).toHaveCount(3);
  await expect(dialog.locator(".fx-option").first()).toContainText("11:45 · 25m");
  await dialog.getByRole("button", { name: /Something else/ }).click();

  // Step 2: what, how long, and when; the sentence says what moves first.
  const step2 = page.getByRole("dialog", { name: /^Fix a time: Something else/ });
  await step2.getByRole("textbox", { name: "What" }).fill("Call with the recruiter");
  await step2.getByRole("radio", { name: "12:30" }).click();
  await expect(step2.getByRole("radio", { name: "12:30" })).toHaveAttribute("aria-checked", "true");
  await expect(step2.locator(".fx-moves-text")).toHaveText(
    `${titles[0]} (11:45–12:10) still fits before it. ${titles[1]} moves from 12:15 to 13:05, after it; 1 more stop moves too. Your day now ends at 14:00.`);
  await step2.getByRole("button", { name: "Fix at 12:30" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The route: the call keeps 12:30 behind a lock, what it moved says WAS.
  const call = route(page).locator(".dm-stop", { hasText: "Call with the recruiter" });
  await expect(call.locator(".dm-time")).toHaveText("12:30");
  await expect(call.locator(".dm-main")).toHaveAttribute("aria-label", /, fixed time/);
  await expect(route(page).locator(".dm-free")).toHaveText(/12:15\s*free 15m/);
  expect(await times(page)).toEqual(["NOW", "12:30", "13:05", "13:35"]);
  await expect(route(page).locator(".dm-stop", { hasText: titles[1] })).toContainText("WAS 12:15");
  await expect(route(page).locator(".dm-stop", { hasText: titles[2] })).toContainText("WAS 12:45");
  await expect(page.locator(".undo-toast")).toContainText("Call with the recruiter fixed at 12:30 · 2 stops moved");

  // Undo: the call is gone (it was made for this), and the route is as it was.
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(route(page).locator(".dm-stop", { hasText: "Call with the recruiter" })).toHaveCount(0);
  // Gone from Today altogether, not left waiting in Unscheduled.
  await expect(page.locator(".dm-pool-count:visible").first()).toHaveText("0");
  expect(await times(page)).toEqual(["NOW", "12:15", "12:45"]);
  await expect(route(page).getByText(/^WAS /)).toHaveCount(0);
});

test("a stop's sheet fixes its time, then shows Change time and Unfix; Unfix lets it flow again", async ({ page }) => {
  await openDayMap(page);
  const last = route(page).locator(".dm-stop").nth(2);
  const title = (await last.locator(".dm-title").innerText()).trim();
  await last.locator(".dm-main").click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: "Fix time" }).click();
  await expect(sheet).toHaveCount(0);

  // Straight to step 2, at where it sits now.
  const step2 = page.getByRole("dialog", { name: `Fix a time: ${title}` });
  await expect(step2.getByRole("textbox", { name: "At" })).toHaveValue("12:45");
  // ↑ moves 5 minutes; Enter fixes it.
  await step2.getByRole("textbox", { name: "At" }).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(step2.getByRole("textbox", { name: "At" })).toHaveValue("12:55");
  await page.keyboard.press("Enter");
  await expect(route(page).locator(".dm-stop", { hasText: title }).locator(".dm-time")).toHaveText("12:55");

  await route(page).locator(".dm-stop", { hasText: title }).locator(".dm-main").click();
  await expect(sheet.getByRole("button", { name: "Fixed at 12:55 · Change time" })).toBeVisible();
  await sheet.getByRole("button", { name: "Unfix" }).click();
  await expect(route(page).locator(".dm-stop", { hasText: title }).locator(".dm-time")).toHaveText("12:45");
  await expect(page.locator(".undo-toast")).toContainText(`No fixed time: ${title}`);
});

test("the fixed-time dialog keeps Tab inside and Escape closes it", async ({ page }) => {
  await openDayMap(page);
  await page.getByRole("button", { name: "Fixed time" }).click();
  const dialog = page.getByRole("dialog", { name: "Fix a time" });
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".fx-dialog"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
