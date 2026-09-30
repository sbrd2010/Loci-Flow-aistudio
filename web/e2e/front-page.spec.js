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

// Codex review of #414: a drag on a front's page reorders the whole horizon,
// so the horizon's tasks on no front keep their places around it.
test("a drag on a front's page keeps the horizon's other tasks in place", async ({ page }) => {
  await enterDemo(page, 1280, 800);
  const week = () => page.locator(".plan-horizon", { has: page.locator("#plan-h-week") }).locator(".plan-row-title");
  const [w1, w2, w3] = (await week().allInnerTexts()).map(t => t.trim());
  // One priority for all three, so their order is theirs alone.
  for (const t of [w1, w2, w3]) {
    await page.locator(".plan-row", { hasText: t }).click();
    await sheet(page).getByRole("radio", { name: "Priority 2" }).click();
    await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
  }
  await expect.poll(async () => (await week().allInnerTexts()).map(t => t.trim())).toEqual([w1, w2, w3]);

  // The first and the last on a front; the middle one on none.
  await page.getByRole("tab", { name: "Fronts" }).click();
  await page.getByRole("button", { name: "New front" }).click();
  await page.locator("#plan-new-name").fill("Thesis");
  await page.getByRole("button", { name: "Add the front" }).click();
  for (const t of [w1, w3]) {
    await page.getByRole("tab", { name: "Horizons" }).click();
    await page.locator(".plan-row", { hasText: t }).click();
    await sheet(page).getByRole("button", { name: /^Front/ }).click();
    await sheet(page).getByRole("radio", { name: "Thesis", exact: true }).click();
    await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.getByRole("tab", { name: "Fronts" }).click();
  await card(page, "Thesis").click();

  // Keyboard drag: the first below the second.
  const held = page.locator(".plan-front-tasks .plan-row-grip[aria-pressed='true']");
  await page.getByRole("button", { name: `Drag to reorder: ${w1}` }).focus();
  await page.keyboard.press("Space");
  await expect(held).toHaveCount(1);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.keyboard.press("ArrowDown");
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.keyboard.press("Space");
  await expect(page.locator(".plan-front-tasks .plan-row-title")).toHaveText([w3, w1]);

  // In Horizons: w1 moved past w3, and w2 kept its place ahead of both.
  await back(page).click();
  await page.getByRole("tab", { name: "Horizons" }).click();
  await expect.poll(async () => (await week().allInnerTexts()).map(t => t.trim())).toEqual([w2, w3, w1]);
});

// Codex review of #414: the card is one button, so its next move is plain
// text — a link inside it would be a control inside a control.
test("a next move with a URL shows as text on the card, not a link", async ({ page }) => {
  await enterDemo(page);
  await frontWith(page, "Links", []);
  await card(page, "Links").click();
  await page.getByRole("button", { name: "Add to this front" }).click();
  await page.getByTestId("add-task-title").fill("Read https://example.com/brief");
  await page.getByTestId("add-task-submit").click();
  await back(page).click();
  await expect(card(page, "Links").locator(".plan-front-move-text")).toHaveText("Read https://example.com/brief");
  await expect(card(page, "Links").locator("a")).toHaveCount(0);
});

// Codex review of #414: a task moved to tomorrow keeps Today's horizon but
// is off Today until its day, so it is counted as tomorrow's, not Today's.
test("a task on this front moved to tomorrow counts as TOMORROW, not ON TODAY", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await enterDemo(page);
  const [title] = await frontWith(page, "Thesis", ["week", "month"]);
  await card(page, "Thesis").click();
  await page.locator(".plan-front-tasks .plan-row", { hasText: title }).click();
  await sheet(page).getByRole("button", { name: "Move to Today" }).click();
  await expect(page.locator(".plan-fp-stats")).toHaveText(/^2 OPEN · 1 ON TODAY · 0 DONE/);

  // From Today's own sheet: Tomorrow.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByTestId("today-tasks-list").getByText(title, { exact: true }).click();
  await sheet(page).getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(sheet(page)).toHaveCount(0);

  await nav.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Fronts" }).click();
  await card(page, "Thesis").click();
  await expect(page.locator(".plan-fp-stats")).toHaveText(/^2 OPEN · 1 TOMORROW · 0 DONE/);
});

// Q41: a block that ends off the focus page shows its end on the focus bar,
// with no prompt over the page: BLOCK 1 DONE, the break, Break's over.
test("laptop: a block ending on a front's page shows block end on the bar, with no prompt", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  // A focus session, left running in the background.
  await page.locator(".today-wall .wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await overlay.getByLabel("Leave focus").click();
  await expect(overlay).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Fronts" }).click();
  await page.locator(".plan-front").first().click();
  await expect(back(page)).toBeVisible();

  await page.clock.runFor(25 * 60_000 + 5_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const bar = page.getByRole("region", { name: "Focus session" });
  await expect(bar).toContainText("BLOCK 1 DONE");
  await expect(back(page)).toBeVisible();
  await bar.getByRole("button", { name: /Take a break/ }).click();
  await expect(bar).toContainText("BREAK");
  await page.clock.runFor(5 * 60_000 + 2_000);
  await expect(bar).toContainText("BREAK’S OVER");
  await bar.getByRole("button", { name: /Start block 2/ }).click();
  await expect(bar.getByRole("button", { name: "Pause focus timer" })).toBeVisible();
});

// Codex review of #414: with a window past midnight the Loci day moves on
// at the window's end, not at 00:00; a task moved to tomorrow comes back
// then, and the page says so without anything else changing.
test("at the end of a window past midnight, tomorrow's task counts as ON TODAY again", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  // The demo's window runs 07:00–02:00: at 01:50 it is still the 15th's day.
  await page.clock.install({ time: new Date("2024-06-16T01:50:00") });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const [title] = await frontWith(page, "Thesis", ["week"]);
  await card(page, "Thesis").click();
  await page.locator(".plan-front-tasks .plan-row", { hasText: title }).click();
  await sheet(page).getByRole("button", { name: "Move to Today" }).click();

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByTestId("today-tasks-list").getByText(title, { exact: true }).click();
  await sheet(page).getByRole("button", { name: /^Tomorrow/ }).click();
  await nav.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Fronts" }).click();
  await card(page, "Thesis").click();
  await expect(page.locator(".plan-fp-stats")).toHaveText(/^1 OPEN · 1 TOMORROW · 0 DONE/);

  // 02:05: the window has ended, the 16th has begun, and nothing else moved.
  await page.clock.runFor(15 * 60_000);
  await expect(page.locator(".plan-fp-stats")).toHaveText(/^1 OPEN · 1 ON TODAY · 0 DONE/);
});
