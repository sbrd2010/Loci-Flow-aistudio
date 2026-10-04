import { test, expect } from "@playwright/test";

// Fixed time (58c–e). Demo mode at 11:35: the route holds three 25-minute
// stops from 11:35 (11:35, 12:05, 12:35). Nothing reaches Firebase.

async function openDayMap(page, viewport = { width: 1280, height: 800 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
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
  await expect(dialog.locator(".fx-option").first()).toContainText("11:35 · 25m");
  await dialog.getByRole("button", { name: /Something else/ }).click();

  // Step 2: what, how long, and when; the sentence says what moves first.
  const step2 = page.getByRole("dialog", { name: /^Fix a time: Something else/ });
  await step2.getByRole("textbox", { name: "What" }).fill("Call with the recruiter");
  await step2.getByRole("radio", { name: "12:00" }).click();
  await expect(step2.getByRole("radio", { name: "12:00" })).toHaveAttribute("aria-checked", "true");
  await expect(step2.locator(".fx-moves-text")).toHaveText(
    `${titles[0]} (11:35–12:00) still fits before it. ${titles[1]} moves from 12:05 to 12:35, after it; 1 more stop moves too. Your day now ends at 13:30.`);
  await step2.getByRole("button", { name: "Fix at 12:00" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The route: the call keeps 12:00 behind a lock, what it moved says WAS.
  const call = route(page).locator(".dm-stop", { hasText: "Call with the recruiter" });
  await expect(call.locator(".dm-time")).toHaveText("12:00");
  await expect(call.locator(".dm-main")).toHaveAttribute("aria-label", /, fixed time/);
  // The first stop ends at 12:00, as the call starts: no buffer, no gap (Q35).
  await expect(route(page).locator(".dm-free")).toHaveCount(0);
  expect(await times(page)).toEqual(["NOW", "12:00", "12:35", "13:05"]);
  await expect(route(page).locator(".dm-stop", { hasText: titles[1] })).toContainText("WAS 12:05");
  await expect(route(page).locator(".dm-stop", { hasText: titles[2] })).toContainText("WAS 12:35");
  await expect(page.locator(".undo-toast")).toContainText("Call with the recruiter fixed at 12:00 · 2 stops moved");

  // Undo: the call is gone (it was made for this), and the route is as it was.
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(route(page).locator(".dm-stop", { hasText: "Call with the recruiter" })).toHaveCount(0);
  // Gone from Today altogether.
  expect(await times(page)).toEqual(["NOW", "12:05", "12:35"]);
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
  await expect(step2.getByRole("textbox", { name: "At" })).toHaveValue("12:35");
  // ↑ moves 5 minutes; Enter fixes it.
  await step2.getByRole("textbox", { name: "At" }).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(step2.getByRole("textbox", { name: "At" })).toHaveValue("12:45");
  await page.keyboard.press("Enter");
  await expect(route(page).locator(".dm-stop", { hasText: title }).locator(".dm-time")).toHaveText("12:45");

  await route(page).locator(".dm-stop", { hasText: title }).locator(".dm-main").click();
  await expect(sheet.getByRole("button", { name: "Fixed at 12:45 · Change time" })).toBeVisible();
  await sheet.getByRole("button", { name: "Unfix" }).click();
  await expect(route(page).locator(".dm-stop", { hasText: title }).locator(".dm-time")).toHaveText("12:35");
  await expect(page.locator(".undo-toast")).toContainText(`No fixed time: ${title}`);
});

// Codex review of #425: the WAS badges were about the fix, so Unfix clears them.
test("Unfix clears the WAS badges of the stops the fix moved", async ({ page }) => {
  await openDayMap(page);
  const last = route(page).locator(".dm-stop").nth(2);
  const title = (await last.locator(".dm-title").innerText()).trim();
  await last.locator(".dm-main").click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: "Fix time" }).click();
  const at = page.getByRole("dialog", { name: `Fix a time: ${title}` }).getByRole("textbox", { name: "At" });
  await at.focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("ArrowDown");
  await expect(at).toHaveValue("12:05");
  await page.keyboard.press("Enter");
  await expect(route(page).getByText(/^WAS /)).not.toHaveCount(0);

  await route(page).locator(".dm-stop", { hasText: title }).locator(".dm-main").click();
  await sheet.getByRole("button", { name: "Unfix" }).click();
  await expect(page.locator(".undo-toast")).toContainText(`No fixed time: ${title}`);
  await expect(route(page).getByText(/^WAS /)).toHaveCount(0);
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

// Codex review of #425: an empty day can take a fixed time too — a call can
// be the first thing on it.
test("an empty day offers Fixed time, and Something else puts the first stop on it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  // Empty Today: the demo's tasks go to Plan.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("l");
  const list = page.getByTestId("today-tasks-list");
  const rows = list.locator("[data-testid='task-row']");
  while (await rows.count()) {
    await rows.first().click();
    await page.getByTestId("task-detail").getByRole("button", { name: "Delete" }).click();
  }
  await page.locator(".wall-title").click();
  await page.getByTestId("task-detail").getByRole("button", { name: "Delete" }).click();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await expect(page.getByRole("heading", { name: "Nothing on Today yet" })).toBeVisible();
  await page.getByRole("button", { name: "Fixed time" }).click();
  await page.getByRole("dialog", { name: "Fix a time" }).getByRole("button", { name: /Something else/ }).click();
  await page.getByRole("textbox", { name: "What" }).fill("Call with the recruiter");
  await page.getByRole("radio", { name: "12:30" }).click();
  await page.getByRole("button", { name: "Fix at 12:30" }).click();
  await expect(route(page).locator(".dm-stop", { hasText: "Call with the recruiter" }).locator(".dm-time")).toHaveText("12:30");
});

// Codex review of #425: Evening Guard holds here too. Something new is a new
// task, so at or after 20:00 it is blocked; fixing a task's time is not.
test("Evening Guard: after 20:00 Something else is blocked, fixing an existing stop still works", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T20:30:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  // On a laptop Settings opens in two panes; the switch is under "The day".
  await page.getByRole("button", { name: "The day", exact: true }).first().click();
  const guard = page.getByRole("switch", { name: /Evening guard/ });
  if ((await guard.getAttribute("aria-checked")) !== "true") await guard.click();
  await expect(guard).toHaveAttribute("aria-checked", "true");
  await page.getByRole("banner").getByRole("button", { name: "Today", exact: true }).click();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");

  await page.getByRole("button", { name: "Fixed time" }).click();
  await page.getByRole("dialog", { name: "Fix a time" }).getByRole("button", { name: /Something else/ }).click();
  await page.getByRole("textbox", { name: "What" }).fill("Call with the recruiter");
  await expect(page.locator(".fx-dialog .add-warning")).toHaveText("Evening Guard is on: adding tasks after 8 PM is blocked. Rest now.");
  await expect(page.getByRole("button", { name: /^Fix at/ })).toBeDisabled();

  // Back to the list: a stop already on Today can still take a fixed time.
  await page.locator(".fx-dialog").getByRole("button", { name: "Back", exact: true }).click();
  await page.locator(".fx-dialog").getByRole("button", { name: "Close", exact: true }).click();
  const last = route(page).locator(".dm-stop").last();
  const title = (await last.locator(".dm-title").innerText()).trim();
  await last.locator(".dm-main").click();
  await page.getByTestId("task-detail").getByRole("button", { name: "Fix time" }).click();
  await expect(page.locator(".fx-dialog .add-warning")).toHaveCount(0);
  await page.getByRole("button", { name: /^Fix at/ }).click();
  await expect(route(page).locator(".dm-stop", { hasText: title }).locator(".dm-main")).toHaveAttribute("aria-label", /, fixed time/);
});
