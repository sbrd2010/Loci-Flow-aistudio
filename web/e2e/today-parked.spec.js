import { test, expect } from "@playwright/test";

// 62d: parked tasks fold at the bottom of Today's list ("PARKED · N"),
// collapsed, with Restore (back to the bottom of the list) and Drop (Undo).
// Demo mode, so nothing reaches Firebase.

async function parkTheOneThing(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".wall-title")).toBeVisible({ timeout: 10_000 });
  const title = (await page.locator(".wall-title").innerText()).trim();
  await page.locator(".wall-details").click();
  await page.getByTestId("task-detail").getByRole("button", { name: "Park", exact: true }).click();
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
  const showList = page.getByRole("button", { name: "Show list" });
  if (await showList.isVisible()) await showList.click();
  return title;
}

const fold = (page) => page.locator(".today-parked");

test("a parked task sits in the folded PARKED fold; Restore puts it back at the bottom of the list", async ({ page }) => {
  const title = await parkTheOneThing(page);
  const line = fold(page).locator(".today-parked-line");
  await expect(line).toContainText("Parked · 1");
  await expect(line).toContainText("since 15 Jun");
  await expect(line).toHaveAttribute("aria-expanded", "false");
  await line.click();
  await fold(page).getByRole("button", { name: `Restore: ${title}` }).click();
  await expect(fold(page)).toHaveCount(0);
  await expect(page.getByTestId("today-tasks-list").locator(".task-row").last()).toContainText(title);
  await expect(page.locator(".undo-toast-text")).toHaveText(`Restored: ${title}`);
});

test("Drop deletes the parked task, with Undo", async ({ page }) => {
  const title = await parkTheOneThing(page);
  await fold(page).locator(".today-parked-line").click();
  await fold(page).getByRole("button", { name: `Drop: ${title}` }).click();
  await expect(fold(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(fold(page).locator(".today-parked-line")).toContainText("Parked · 1");
});
