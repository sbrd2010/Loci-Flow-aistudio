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

test("Move offers Later today, Tomorrow and Pick a time; Tomorrow moves it off today (Q47.5)", async ({ page }) => {
  await openDayMapWithPastCall(page);
  await ask(page).getByRole("button", { name: "Move" }).click();
  const menu = page.getByRole("menu", { name: "Move Call with the recruiter" });
  await expect(menu.getByRole("menuitem")).toHaveText([/^Later today\d\d:\d\d$/, "Tomorrowtime cleared", "Pick a time…"]);
  // Esc closes it, back on Move.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(ask(page).getByRole("button", { name: "Move" })).toBeFocused();
  await ask(page).getByRole("button", { name: "Move" }).click();
  await menu.getByRole("menuitem", { name: /Tomorrow/ }).click();
  await expect(page.locator(".dm-stop", { hasText: "Call with the recruiter" })).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toContainText("Moved to tomorrow: Call with the recruiter");
});

test("Later today sets it at the next free slot; Pick a time opens the time sheet", async ({ page }) => {
  await openDayMapWithPastCall(page);
  await ask(page).getByRole("button", { name: "Move" }).click();
  const later = page.getByRole("menuitem", { name: /Later today/ });
  const at = (await later.locator(".dih-meta").innerText()).trim();
  await later.click();
  const row = page.locator(".dm-stop", { hasText: "Call with the recruiter" });
  await expect(row.locator(".dm-time")).toHaveText(at);
  await expect(ask(page)).toHaveCount(0);

  // Once it has ended again, Pick a time… opens the sheet on it.
  await page.clock.setFixedTime(new Date(`2024-06-15T${at}:00`).getTime() + 40 * 60_000);
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await ask(page).getByRole("button", { name: "Move" }).click();
  await page.getByRole("menuitem", { name: "Pick a time…" }).click();
  await expect(page.getByRole("dialog", { name: "Fix a time: Call with the recruiter" })).toBeVisible();
});

test("Today's Day map view asks too: Done with Undo (Q47.5)", async ({ page }) => {
  await openDayMapWithPastCall(page);
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.keyboard.press("Escape");
  // The list put away, L brings it back, with its switch.
  await page.keyboard.press("l");
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Day map", exact: true }).click();
  const column = page.getByRole("region", { name: "Day map" });
  const line = column.getByRole("group", { name: "Did it happen? Call with the recruiter" });
  await expect(line).toBeVisible();
  await line.getByRole("button", { name: "Done" }).click();
  await expect(column.getByText("Call with the recruiter")).toHaveCount(0);
  await page.locator(".undo-toast").getByRole("button", { name: /Undo/ }).click();
  await expect(line).toBeVisible();
  await line.getByRole("button", { name: "Move" }).click();
  await page.getByRole("menuitem", { name: "Pick a time…" }).click();
  const sheet = page.getByRole("dialog", { name: "Fix a time: Call with the recruiter" });
  // It starts from now, not the missed 11:00, and offers Tomorrow.
  await expect(sheet).toContainText("A new time today, or tomorrow.");
  await sheet.getByRole("button", { name: "Tomorrow" }).click();
  await expect(column.getByText("Call with the recruiter")).toHaveCount(0);
});
