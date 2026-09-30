import { test, expect } from "@playwright/test";

// Q31: "Fixed time → A break" and "Something else". Demo mode at 11:35:
// Auto-fill lays three 25-minute stops (11:35, 12:05, 12:35). Nothing
// reaches Firebase.

async function openDayMap(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
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

test("A break starts now; the one thing continues after it; its row opens Length / Time / Remove (Q36.1)", async ({ page }) => {
  await openDayMap(page);
  await page.getByRole("button", { name: "Fixed time" }).click();
  await page.getByRole("dialog", { name: "Fix a time" }).getByRole("button", { name: /A break/ }).click();

  // Now, 15 minutes.
  const step2 = page.getByRole("dialog", { name: /^Fix a time: A break/ });
  await expect(step2.getByRole("combobox", { name: "Length" })).toHaveValue("15");
  await step2.getByRole("button", { name: "Add break at 11:35" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The one thing waits for it; no buffer after a break (Q35a).
  const brk = route(page).locator(".dm-break.is-added");
  await expect(brk.getByRole("button", { name: "11:35 to 11:50, Break" })).toBeVisible();
  expect(await times(page)).toEqual(["NOW", "12:20", "12:50"]);

  // Its row: Length, Time, Remove.
  await brk.getByRole("button").click();
  const sheet = page.getByRole("dialog", { name: "Break" });
  await sheet.getByRole("combobox", { name: "Length" }).selectOption("30");
  await sheet.getByRole("button", { name: "Save · 11:35" }).click();
  await expect(brk.getByRole("button", { name: "11:35 to 12:05, Break" })).toBeVisible();
  expect(await times(page)).toEqual(["12:05", "12:35", "13:05"]);
  // The sheet hands focus back to the break's row (10b).
  await expect(brk.getByRole("button")).toBeFocused();

  await brk.getByRole("button").click();
  await page.getByRole("dialog", { name: "Break" }).getByRole("button", { name: "Remove" }).click();
  await expect(route(page).locator(".dm-break")).toHaveCount(0);
  expect(await times(page)).toEqual(["NOW", "12:05", "12:35"]);

  // Undo puts it back.
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(brk.getByRole("button", { name: "11:35 to 12:05, Break" })).toBeVisible();
  expect(await times(page)).toEqual(["12:05", "12:35", "13:05"]);

  // Not a task: Today's list doesn't have it.
  await page.getByRole("button", { name: "Back to Today" }).click();
  await page.getByRole("button", { name: /^Show list/ }).click();
  await expect(page.getByTestId("today-tasks-list")).not.toContainText("Break");
});

test("Later… puts the break after what you're doing now; the next stop goes after it whole (Q36.1–2)", async ({ page }) => {
  await openDayMap(page);
  await page.getByRole("button", { name: "Fixed time" }).click();
  await page.getByRole("dialog", { name: "Fix a time" }).getByRole("button", { name: /A break/ }).click();
  const step2 = page.getByRole("dialog", { name: /^Fix a time: A break/ });
  await step2.getByRole("button", { name: "Later…" }).click();
  await step2.getByRole("button", { name: "Add break at 12:00" }).click();
  await expect(route(page).locator(".dm-break.is-added").getByRole("button", { name: "12:00 to 12:15, Break" })).toBeVisible();
  expect(await times(page)).toEqual(["NOW", "12:15", "12:45"]);
  await expect(route(page).locator(".dm-stop.is-continued")).toHaveCount(0);
});

test("Something else shows its lock and time in Today's list, and is never the one thing", async ({ page }) => {
  await openDayMap(page);
  await page.getByRole("button", { name: "Fixed time" }).click();
  await page.getByRole("dialog", { name: "Fix a time" }).getByRole("button", { name: /Something else/ }).click();
  const step2 = page.getByRole("dialog", { name: /^Fix a time: Something else/ });
  await step2.getByRole("textbox", { name: "What" }).fill("Call with the recruiter");
  await step2.getByRole("radio", { name: "12:30" }).click();
  await step2.getByRole("button", { name: "Fix at 12:30" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Back to Today" }).click();
  await page.getByRole("button", { name: /^Show list/ }).click();
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { hasText: "Call with the recruiter" });
  await expect(row.getByLabel("Fixed at 12:30")).toBeVisible();
  await expect(row.getByRole("button", { name: /^Make the one thing/ })).toHaveCount(0);
});
