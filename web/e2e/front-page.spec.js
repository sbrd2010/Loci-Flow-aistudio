import { test, expect } from "@playwright/test";

// A front's own page (52f–g), opened from its card in Plan's Fronts (45i):
// its open tasks by horizon, Add to this front, and Park / Close with Undo.
// Demo mode, so nothing here touches Firebase.

async function enterDemo(page, width = 375, height = 812) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
}

const sheet = (page) => page.getByTestId("task-detail");
const card = (page, name) => page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: name }) });
const back = (page) => page.getByRole("button", { name: "Back to Fronts" });

// Makes a front (with a deadline, 18 days after the fixed clock) and puts
// the first task of each named horizon on it from the task's sheet. Returns
// the titles, in that order.
async function frontWith(page, name, horizons, dueAt = "2024-07-03") {
  await page.getByRole("tab", { name: "Fronts" }).click();
  await page.getByRole("button", { name: "New front" }).click();
  await page.locator("#plan-new-name").fill(name);
  if (dueAt) await page.locator("#plan-new-date").fill(dueAt);
  await page.getByRole("button", { name: "Add the front" }).click();
  const titles = [];
  for (const h of horizons) {
    await page.getByRole("tab", { name: "Horizons" }).click();
    const row = page.locator(".plan-horizon", { has: page.locator(`#plan-h-${h}`) })
      .locator(".plan-row").filter({ hasNot: page.locator(".plan-row-front") }).first();
    titles.push((await row.locator(".plan-row-title").innerText()).trim());
    await row.click();
    await sheet(page).getByRole("button", { name: /^Front/ }).click();
    await sheet(page).getByRole("radio", { name, exact: true }).click();
    await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet(page)).toHaveCount(0);
  }
  await page.getByRole("tab", { name: "Fronts" }).click();
  return titles;
}

test("the card opens the front's page: its tasks by horizon and its figures; Back returns to the card", async ({ page }) => {
  await enterDemo(page);
  const titles = await frontWith(page, "Thesis", ["week", "week", "month"]);

  await expect(card(page, "Thesis").locator(".plan-front-open")).toHaveText("3 OPEN");
  await card(page, "Thesis").click();

  // The page replaces the switch; Back takes focus.
  await expect(page.getByRole("tab", { name: "Fronts" })).toHaveCount(0);
  await expect(back(page)).toBeFocused();
  await expect(page.getByRole("heading", { name: "Thesis", level: 2 })).toBeVisible();
  await expect(page.locator(".plan-fp-stats")).toHaveText("3 OPEN · 0 DONE · DUE 3 JUL · 18 DAYS");

  // Only this front's tasks, in only the horizons that hold any.
  const sections = page.locator(".plan-front-tasks .plan-horizon");
  await expect(sections.locator(".plan-horizon-name")).toHaveText(["This week 2", "This month 1"]);
  const rows = page.locator(".plan-front-tasks .plan-row");
  await expect(rows).toHaveCount(3);
  for (const t of titles) await expect(rows.filter({ hasText: t })).toHaveCount(1);
  // The front is the page's title, so the rows don't repeat it.
  await expect(page.locator(".plan-front-tasks .plan-row-front")).toHaveCount(0);

  // Done on a row counts as done.
  await page.locator(".plan-front-tasks .plan-row").first().getByRole("button", { name: /^Mark done/ }).click();
  await expect(page.locator(".plan-fp-stats")).toHaveText("2 OPEN · 1 DONE · DUE 3 JUL · 18 DAYS");

  await back(page).click();
  await expect(page.getByRole("tab", { name: "Fronts" })).toHaveAttribute("aria-selected", "true");
  await expect(card(page, "Thesis")).toBeFocused();
});

test("a row opens the task sheet; moving the task off the front takes it off the page", async ({ page }) => {
  await enterDemo(page);
  const [title] = await frontWith(page, "Thesis", ["week", "month"]);
  await card(page, "Thesis").click();

  await page.locator(".plan-front-tasks .plan-row", { hasText: title }).click();
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText("THIS WEEK · 1 OF 1");
  await sheet(page).getByRole("button", { name: /^Front/ }).click();
  await sheet(page).getByRole("radio", { name: "None", exact: true }).click();

  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".plan-front-tasks .plan-row", { hasText: title })).toHaveCount(0);
  await expect(page.locator(".plan-fp-stats")).toHaveText(/^1 OPEN · 0 DONE/);
});

test("laptop: Esc goes back to Fronts, but closes an open drawer first", async ({ page }) => {
  await enterDemo(page, 1280, 800);
  await frontWith(page, "Thesis", ["week"]);
  await card(page, "Thesis").click();
  await expect(page.locator(".plan-fp-key")).toBeVisible();
  // Laptop: the buttons sit beside the name; there is no bar.
  await expect(page.locator(".plan-fp-actions.is-inline")).toBeVisible();
  await expect(page.locator(".plan-fp-actions.is-bar")).toBeHidden();

  await page.locator(".plan-front-tasks .plan-row").first().click();
  await expect(sheet(page)).toBeVisible();
  // The drawer is not modal: with focus out on the page, Esc still doesn't
  // leave the page under it.
  await page.locator(".plan-fp-stats").click();
  await page.keyboard.press("Escape");
  await expect(back(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".plan-front-tasks .plan-row").first().click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(back(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(back(page)).toHaveCount(0);
  await expect(card(page, "Thesis")).toBeFocused();
});

test("Park front: back to Fronts, the card reads PARKED, and Undo restores it", async ({ page }) => {
  await enterDemo(page);
  await frontWith(page, "Thesis", ["week"]);
  await card(page, "Thesis").click();

  // Phone: Park and Close are a bar above the nav, clear of it.
  const bar = page.locator(".plan-fp-actions.is-bar");
  await expect(bar).toBeVisible();
  const barBox = await bar.boundingBox();
  const navBox = await page.locator(".tab-bar").boundingBox();
  expect(Math.abs(barBox.y + barBox.height - navBox.y)).toBeLessThanOrEqual(1);

  await bar.getByRole("button", { name: "Park front" }).click();
  await expect(back(page)).toHaveCount(0);
  await expect(card(page, "Thesis").locator(".plan-front-open")).toHaveText("PARKED");
  await expect(card(page, "Thesis")).toBeFocused();
  await expect(page.locator(".undo-toast")).toContainText("Parked: Thesis");

  // A parked front's page offers Unpark.
  await card(page, "Thesis").click();
  await expect(page.getByRole("button", { name: "Unpark front" }).first()).toBeAttached();
  await back(page).click();

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "Thesis").locator(".plan-front-open")).toHaveText("1 OPEN");
});

test("Close front: Undo puts it back where it was, with its tasks still on it", async ({ page }) => {
  await enterDemo(page);
  // Undated fronts keep the order they were made in, so a front put back in
  // the wrong place would show.
  const [title] = await frontWith(page, "Alpha", ["week"], null);
  await frontWith(page, "Beta", [], null);
  const order = await page.locator(".plan-front-name").allInnerTexts();
  expect(order.indexOf("Alpha")).toBe(order.indexOf("Beta") - 1);

  await card(page, "Alpha").click();
  await page.getByRole("button", { name: "Close front" }).click();
  await expect(card(page, "Alpha")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New front" })).toBeFocused();

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".plan-front-name")).toHaveText(order);
  await expect(card(page, "Alpha").locator(".plan-front-move-text")).toHaveText(title);
  await expect(card(page, "Alpha")).toBeFocused();
});

test("Add to this front opens Add task on that front, and the new task lands on the page", async ({ page }) => {
  await enterDemo(page);
  await frontWith(page, "Thesis", ["week"]);
  await card(page, "Thesis").click();

  await page.getByRole("button", { name: "Add to this front" }).click();
  await expect(page.locator("#task-front option:checked")).toHaveText("Thesis");
  await page.getByTestId("add-task-title").fill("Draft the methods section");
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".plan-front-tasks .plan-horizon", { has: page.locator("#plan-h-week") })
    .locator(".plan-row", { hasText: "Draft the methods section" })).toBeVisible();
  await expect(page.locator(".plan-fp-stats")).toHaveText(/^2 OPEN/);
});

test("a task moved to Today leaves the rows but still counts: the figures say it is on Today", async ({ page }) => {
  await enterDemo(page);
  const [title] = await frontWith(page, "Thesis", ["week", "month"]);
  await card(page, "Thesis").click();
  await expect(page.locator(".plan-fp-stats")).toHaveText("2 OPEN · 0 DONE · DUE 3 JUL · 18 DAYS");

  await page.locator(".plan-front-tasks .plan-row", { hasText: title }).click();
  await sheet(page).getByRole("button", { name: "Move to Today" }).click();

  await expect(page.locator(".plan-front-tasks .plan-row")).toHaveCount(1);
  await expect(page.locator(".plan-fp-stats")).toHaveText("2 OPEN · 1 ON TODAY · 0 DONE · DUE 3 JUL · 18 DAYS");
  // The card counts it too.
  await back(page).click();
  await expect(card(page, "Thesis").locator(".plan-front-open")).toHaveText("2 OPEN");
});
