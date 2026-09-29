import { test, expect } from "@playwright/test";

// Q36.3, Q36a: something at a set time still open 5 minutes after it ends
// asks "Did it happen?" — Done, or Move (a new time, or Tomorrow). Demo
// mode at 11:35; nothing reaches Firebase.

async function openDayMapWithPastCall(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "Auto-fill" }).click();
  // A 30-minute call at 11:00: it ended at 11:30.
  await page.getByRole("button", { name: "Fixed time" }).click();
  await page.getByRole("dialog", { name: "Fix a time" }).getByRole("button", { name: /Something else/ }).click();
  const step2 = page.getByRole("dialog", { name: /^Fix a time: Something else/ });
  await step2.getByRole("textbox", { name: "What" }).fill("Call with the recruiter");
  await step2.getByRole("radio", { name: "11:00" }).click();
  await step2.getByRole("button", { name: "Fix at 11:00" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const ask = (page) => page.getByRole("group", { name: "Did it happen? Call with the recruiter" });

test("a call that ended asks Did it happen?, and Done takes it off the route", async ({ page }) => {
  await openDayMapWithPastCall(page);
  const row = page.locator(".dm-stop.is-asking");
  await expect(row.locator(".dm-time")).toHaveText("11:00");
  await expect(row).not.toHaveClass(/is-late/);
  await ask(page).getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".dm-stop", { hasText: "Call with the recruiter" })).toHaveCount(0);
});

test("Move opens the time picker with Tomorrow, which moves it off today", async ({ page }) => {
  await openDayMapWithPastCall(page);
  await ask(page).getByRole("button", { name: "Move" }).click();
  const sheet = page.getByRole("dialog", { name: "Fix a time: Call with the recruiter" });
  await expect(sheet).toContainText("A new time today, or tomorrow.");
  await sheet.getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".dm-stop", { hasText: "Call with the recruiter" })).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toContainText("Moved to tomorrow: Call with the recruiter");
});
