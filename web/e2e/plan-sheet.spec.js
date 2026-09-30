import { test, expect } from "@playwright/test";
import { openRung } from "./helpers/plan.js";

// Plan rows and the task sheet (52h): meta is priority · estimate · front,
// a pinned row carries a pin, the grip shows on hover or focus, and a row
// opens the same sheet as Today's with Plan's footer — Move to Today, then
// Pin to top · Park · Delete, each with Undo.

async function enterDemo(page, viewport = { width: 1280, height: 800 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.locator(".plan-ladder")).toBeVisible();
}

// The open rung's list (57): This week unless another rung is opened.
const horizon = (page, name) => page.locator(".plan-open", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });
const sheet = (page) => page.getByTestId("task-detail");

// Steps are edited in place (52), so their text is the fields' values.
const stepTexts = (page) => sheet(page).locator(".detail-step-input").evaluateAll(els => els.map(el => el.value));

test("a row opens the sheet: its horizon and place, no Must-do or one thing, and Plan's footer", async ({ page }) => {
  await enterDemo(page);
  const rows = horizon(page, "This week").locator(".plan-row");
  const n = await rows.count();
  await rows.nth(1).click();
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText(`THIS WEEK · 2 OF ${n}`);
  await expect(rows.nth(1)).toHaveClass(/is-open/);
  await expect(sheet(page).getByRole("switch", { name: "Must-do" })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: /Make this the one thing/ })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "Tomorrow" })).toHaveCount(0);
  const foot = sheet(page).locator(".detail-foot");
  await expect(foot.getByRole("button")).toHaveText(["Move to Today", "Pin to top", "Park", "Delete"]);

  // ↑/↓ move through the horizon; Esc closes and hands focus to the row.
  await sheet(page).locator(".detail-title").focus();
  await page.keyboard.press("ArrowDown");
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText(`THIS WEEK · 3 OF ${n}`);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(rows.nth(2)).toBeFocused();

  // Enter on a focused row opens it.
  await page.keyboard.press("Enter");
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText(`THIS WEEK · 3 OF ${n}`);
});

test("row meta is priority · estimate · front, and Pin to top puts a pin on the row", async ({ page }) => {
  await enterDemo(page);
  // Make a front, then put the last This week task on it from its sheet.
  await page.getByRole("tab", { name: "Fronts" }).click();
  await page.getByRole("button", { name: "New front" }).click();
  await page.locator("#plan-new-name").fill("Career");
  await page.getByRole("button", { name: "Add the front" }).click();
  await page.getByRole("tab", { name: "Horizons" }).click();

  const rows = horizon(page, "This week").locator(".plan-row");
  const last = rows.last();
  const title = (await last.locator(".plan-row-title").innerText()).trim();
  await last.click();
  await sheet(page).getByRole("button", { name: /^Front/ }).click();
  await sheet(page).getByRole("radio", { name: "Career", exact: true }).click();

  const row = horizon(page, "This week").locator(".plan-row", { hasText: title });
  await expect(row.locator(".plan-row-meta")).toHaveText(/^P\d · \d+m· Career$/);

  await sheet(page).getByRole("button", { name: "Pin to top" }).click();
  await expect(row.getByRole("img", { name: "Pinned to top" })).toBeVisible();
  await expect(rows.first()).toContainText(title);
  await expect(sheet(page).getByRole("button", { name: "Unpin" })).toBeVisible();
});

test("the grip shows on hover and focus only", async ({ page }) => {
  await enterDemo(page);
  const row = horizon(page, "This week").locator(".plan-row").first();
  const grip = row.locator(".plan-row-grip");
  await page.mouse.move(5, 5);
  await expect(grip).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(grip).toHaveCSS("opacity", "1");
  await page.mouse.move(5, 5);
  await grip.focus();
  await expect(grip).toHaveCSS("opacity", "1");
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("no grip on touch: a long press on the row drags instead", async ({ page }) => {
    await enterDemo(page, { width: 412, height: 915 });
    await expect(horizon(page, "This week").locator(".plan-row-grip").first()).toBeHidden();
  });
});

test("Move to Today, Park and Delete each leave Plan with Undo, and Undo brings the task back", async ({ page }) => {
  await enterDemo(page);
  const rows = horizon(page, "This week").locator(".plan-row");
  for (const [action, message] of [["Move to Today", "Moved to Today"], ["Park", "Parked"], ["Delete", "Deleted"]]) {
    const title = (await rows.first().locator(".plan-row-title").innerText()).trim();
    await rows.first().click();
    await sheet(page).getByRole("button", { name: action, exact: true }).click();
    await expect(sheet(page)).toHaveCount(0);
    // Focus goes to the next row in the horizon.
    await expect(rows.first()).toBeFocused();
    await expect(page.locator(".undo-toast")).toContainText(`${message}: ${title}`);
    await expect(horizon(page, "This week").getByText(title, { exact: true })).toHaveCount(0);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect(horizon(page, "This week").getByText(title, { exact: true })).toBeVisible();
  }
});

test("the sheet's circle marks it done, with Undo; a step removed comes back with Undo", async ({ page }) => {
  await enterDemo(page);
  const rows = horizon(page, "This week").locator(".plan-row");
  const title = (await rows.first().locator(".plan-row-title").innerText()).trim();
  await rows.first().click();
  // A first step the task already has is step 1 of STEPS (52).
  const before = await stepTexts(page);
  await sheet(page).getByLabel("Add a step").fill("Draft the outline");
  await sheet(page).getByLabel("Add a step").press("Enter");
  await expect(sheet(page).getByText(`STEPS · 0 OF ${before.length + 1}`)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Remove step Draft the outline" }).click();
  await expect.poll(() => stepTexts(page)).toEqual(before);
  await expect(page.locator(".undo-toast")).toContainText("Step removed: Draft the outline");
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => stepTexts(page)).toEqual([...before, "Draft the outline"]);

  await sheet(page).getByRole("button", { name: `Mark done: ${title}` }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toContainText(`Marked done: ${title}`);
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(horizon(page, "This week").getByText(title, { exact: true })).toBeVisible();
});

test("the Horizon picker moves the task and the sheet follows it", async ({ page }) => {
  await enterDemo(page);
  const title = (await horizon(page, "This week").locator(".plan-row-title").first().innerText()).trim();
  await horizon(page, "This week").locator(".plan-row").first().click();
  await sheet(page).getByRole("button", { name: /^Horizon/ }).click();
  // 57h: each horizon with its end date, a check on the current one.
  await expect(sheet(page).getByRole("radio", { name: /^This week/ })).toHaveAttribute("aria-checked", "true");
  await expect(sheet(page).getByRole("radio", { name: /^Work/ })).toHaveCount(0);
  await sheet(page).getByRole("radio", { name: /^This month [A-Z]{3} \d+ [A-Z]{3}$/ }).click();
  await expect(horizon(page, "This month").getByText(title, { exact: true })).toBeVisible();
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText(/^THIS MONTH · \d+ OF \d+$/);
});

test("Plan has no floating +, no 'Not on a front' and no 'I'm scattered' (52)", async ({ page }) => {
  await enterDemo(page, { width: 412, height: 915 });
  await expect(page.getByTestId("fab-add-task")).toHaveCount(0);
  await page.getByRole("tab", { name: "Fronts" }).click();
  await expect(page.getByText("Not on a front")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /I'm scattered/ })).toHaveCount(0);
});

// Codex review of #412, round three.
test("Undo of a removed step puts it back where it was; a step added since stays put", async ({ page }) => {
  await enterDemo(page);
  await horizon(page, "This week").locator(".plan-row").first().click();
  const before = await stepTexts(page);
  const add = sheet(page).getByLabel("Add a step");
  for (const text of ["Alpha step", "Beta step"]) { await add.fill(text); await add.press("Enter"); }
  await sheet(page).getByRole("button", { name: "Remove step Beta step" }).click();
  await add.fill("Gamma step");
  await add.press("Enter");
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => stepTexts(page)).toEqual([...before, "Alpha step", "Beta step", "Gamma step"]);
});

test("Drag anywhere: Enter on a Plan row opens its sheet; Space picks it up", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await page.getByTestId("demo-btn").click();
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Drag anywhere" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await openRung(page, "week");
  const rows = horizon(page, "This week").locator(".plan-row");
  await rows.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText(/^THIS WEEK · 2 OF \d+$/);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await rows.nth(1).focus();
  await page.keyboard.press("Space");
  // Each horizon is its own drag context, with its own announcer.
  await page.waitForFunction(() => [...document.querySelectorAll("[id^='DndLiveRegion']")].some(el => /Picked up|was moved over/.test(el.textContent)));
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
});
