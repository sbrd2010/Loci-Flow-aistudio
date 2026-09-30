import { test, expect } from "@playwright/test";

// Close the day (55d–e, Q47): from the Day map's header. Each leftover →
// Tomorrow (default) · Plan · Drop; "First thing tomorrow?"; an optional
// line. Today then shows only "Day closed. Tomorrow starts with …", Start
// anyway, Reopen the day and what got done. Undo for 10 s.
test("close the day from the Day map, then reopen it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T16:00:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  // M opens the Day map (as the other Day map specs do).
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "Close the day" }).click();

  const sheet = page.getByRole("dialog", { name: "Close the day" });
  await expect(sheet.getByText(/^Done today · \d+/)).toBeVisible();
  const groups = sheet.getByRole("radiogroup", { name: /^Where / });
  const n = await groups.count();
  expect(n).toBeGreaterThanOrEqual(3);
  // Tomorrow by default.
  for (let i = 0; i < n; i++) await expect(groups.nth(i).getByRole("radio", { name: "Tomorrow" })).toHaveAttribute("aria-checked", "true");
  const title = async (i) => (await groups.nth(i).getAttribute("aria-label")).replace(/^Where (.*) goes$/, "$1");
  const planned = await title(n - 1);
  const dropped = await title(n - 2);
  const first = await title(0);
  await groups.nth(n - 1).getByRole("radio", { name: "Plan" }).click();
  await groups.nth(n - 2).getByRole("radio", { name: "Drop" }).click();
  await sheet.getByRole("radio", { name: first }).check();
  await sheet.getByRole("button", { name: "Add a line about today" }).click();
  await sheet.getByPlaceholder("How did today go?").fill("Slow start, good finish");
  await sheet.getByRole("button", { name: "Close the day" }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole("button", { name: /^Back to/ }).click();
  await expect(page.getByRole("heading", { name: `Day closed. Tomorrow starts with ${first}.` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start anyway" })).toBeVisible();
  await expect(page.getByTestId("today-tasks-list")).toBeHidden();

  // Plan took one back to This week; Drop is in Recently dropped (not on Plan).
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const list = page.locator(".plan-open");
  await expect(list.getByText(planned, { exact: true })).toBeVisible();
  await expect(list.getByText(dropped, { exact: true })).toHaveCount(0);

  // Reopen: Today is back; what moved stays moved.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Reopen the day" }).click();
  await expect(page.getByRole("heading", { name: /^Day closed/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close the day" })).toHaveCount(0); // the line waits for 30 min before the end
});
