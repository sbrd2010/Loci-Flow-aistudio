import { test, expect } from "@playwright/test";
import { openRung } from "./helpers/plan.js";

// Plan (45h–j): Horizons | Fronts, the horizons as sections — one column on
// a phone, two on a tablet, four on a laptop — and the Day map reached from
// Today only (turn 50: "Plan is Horizons | Fronts, and that is final").

async function enterDemo(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

test("Plan opens on Horizons, switches to Fronts, and has no Day map door", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
  const horizons = page.getByRole("tab", { name: "Horizons" });
  const fronts = page.getByRole("tab", { name: "Fronts" });
  await expect(horizons).toHaveAttribute("aria-selected", "true");
  // A phone opens on the ladder (57d).
  await expect(page.locator(".plan-rung", { hasText: "This week" })).toBeVisible();
  await expect(page.getByRole("button", { name: /day map/i })).toHaveCount(0);

  await fronts.click();
  await expect(fronts).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "New front" })).toBeVisible();
  // Arrow keys move between the two, as in any tab list.
  await fronts.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(horizons).toHaveAttribute("aria-selected", "true");
  await expect(horizons).toBeFocused();

  // Today is the one door into the Day map, and Back returns there.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Day map →" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.locator(".dm-back").click();
  await expect(page.getByRole("button", { name: "Day map →" })).toBeVisible();
});

test("Horizons: on a phone a rung pushes its list; wider, the ladder sits beside it (57)", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const ladder = page.locator(".plan-ladder");
  const list = page.locator(".plan-open");
  await expect(page.locator(".plan-rung")).toHaveCount(4);
  await expect(page.locator(".plan-rung[aria-current='true']")).toHaveAttribute("data-horizon", "week");
  await expect(ladder).toBeVisible();
  await expect(list).toBeHidden();
  await page.locator(".plan-rung[data-horizon='quarter']").click();
  await expect(ladder).toBeHidden();
  await expect(list.getByRole("heading", { name: "This quarter" })).toBeVisible();
  await list.getByRole("button", { name: "Plan" }).click();
  await expect(ladder).toBeVisible();

  // Plan opens on the rung last opened on this device (42.1).
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  await nav.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.locator(".plan-rung[aria-current='true']")).toHaveAttribute("data-horizon", "quarter");

  const side = async () => {
    const l = await ladder.boundingBox();
    const o = await list.boundingBox();
    return !!(l && o) && o.x > l.x + 200;
  };
  await page.setViewportSize({ width: 900, height: 1200 });
  await expect.poll(side).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(side).toBe(true);
});

// 50f, 52e: Day map rows are time · task · how long, and the Unscheduled
// rows task · how long · +. No priority tag is drawn there, so none can carry
// the four old priority colours; the lengths share one colour everywhere.
test("Day Map draws no priority tags, and its lengths share one colour", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Day map →" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
  const color = (loc) => loc.first().evaluate(el => getComputedStyle(el).color);
  const poolLength = await color(page.locator(".dm-pool-row .dm-dur"));
  await page.getByRole("button", { name: /auto-fill/i }).click();
  await expect(page.locator(".dm-stop:not(.is-now)").first()).toBeVisible();
  expect(await color(page.locator(".dm-stop:not(.is-now) .dm-dur"))).toBe(poolLength);
  await expect(page.locator(".day-map-page .dm-p, .day-map-page .task-row-priority")).toHaveCount(0);
});

test("Horizons: each horizon's + and each row's circle are 44px targets", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  for (const [id, name] of [["week", "This week"], ["month", "This month"], ["quarter", "This quarter"], ["halfyear", "6 months"]]) {
    await openRung(page, id);
    const box = await page.getByRole("button", { name: `Add to ${name}` }).boundingBox();
    expect(Math.round(box.width), name).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height), name).toBeGreaterThanOrEqual(44);
  }
  const circle = await page.locator(".plan-row-circle").first().boundingBox();
  expect(Math.round(circle.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(circle.height)).toBeGreaterThanOrEqual(44);

  // + opens Add task on that horizon (45a).
  await openRung(page, "quarter");
  await page.getByRole("button", { name: "Add to This quarter" }).click();
  await expect(page.getByTestId("add-task-submit")).toHaveText("Add to This quarter");
});

test("Horizons: the circle marks a task done; Work shows only when it holds tasks", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await openRung(page, "week");
  const week = page.locator(".plan-open", { has: page.getByRole("heading", { name: /^This week/ }) });
  const rows = week.locator(".plan-row");
  const before = await rows.count();
  const title = (await rows.first().locator(".plan-row-title").innerText()).trim();
  await rows.first().getByRole("button", { name: `Mark done: ${title}` }).click();
  await expect(rows).toHaveCount(before - 1);
  await expect(page.locator(".plan-rung[data-horizon='week'] .plan-rung-count")).toHaveText(String(before - 1));
  // It waits in the list's Done fold (42.2).
  await week.getByRole("button", { name: /^Done · / }).click();
  await expect(week.locator(".plan-done-row", { hasText: title })).toBeVisible();
  // The demo has no Work tasks, so there is no Work · older rung.
  await expect(page.locator(".plan-rung-older")).toHaveCount(0);
});

// Codex review of #410: in Drag anywhere mode the row is the drag handle, so
// Space or Enter on its circle must mark the task done, not pick the row up.
test("Horizons in Drag anywhere mode: Space and Enter on the circle mark the task done", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Drag anywhere" }).click();
  await expect(page.getByRole("switch", { name: "Drag anywhere" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await openRung(page, "week");
  const week = page.locator(".plan-open", { has: page.getByRole("heading", { name: /^This week/ }) });
  const rows = week.locator(".plan-row");
  const before = await rows.count();
  for (const key of ["Space", "Enter"]) {
    const title = (await rows.first().locator(".plan-row-title").innerText()).trim();
    await rows.first().getByRole("button", { name: `Mark done: ${title}` }).focus();
    await page.keyboard.press(key);
    await expect(week.getByText(title, { exact: true })).toHaveCount(0);
  }
  await expect(rows).toHaveCount(before - 2);
});

// 57a, 57b.25: from 1600 the Fronts column sits beside the ladder and the
// switch is hidden; a front's page opens in the list's place, its card
// tinted, and a rung or Back brings the list back.
test("Horizons ≥1600: the Fronts column; a front's page opens in place of the list", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1000 });
  await enterDemo(page);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const column = page.locator(".plan-fronts-col");
  await expect(column.getByRole("heading", { name: /^Fronts · \d+ ACTIVE$/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Fronts" })).toBeHidden();

  await column.getByRole("button", { name: "New front" }).click();
  await page.locator("#plan-new-name").fill("Thesis");
  await page.getByRole("button", { name: "Add the front" }).click();
  const card = column.locator(".plan-front", { hasText: "Thesis" });
  await expect(card.locator(".plan-front-tally")).toHaveText("0 / 0");

  await card.click();
  await expect(page.getByRole("heading", { name: "Thesis", level: 2 })).toBeVisible();
  await expect(page.locator(".plan-open")).toHaveCount(0);
  await expect(card).toHaveClass(/is-open/);
  await expect(page.locator(".plan-ladder")).toBeVisible();
  const list = await page.locator(".plan-fp").boundingBox();
  const col = await column.boundingBox();
  expect(list.x + list.width).toBeLessThanOrEqual(col.x);

  // A rung brings its list back.
  await page.locator(".plan-rung[data-horizon='month']").click();
  await expect(page.locator(".plan-open").getByRole("heading", { name: "This month" })).toBeVisible();
  await expect(card).not.toHaveClass(/is-open/);

  // So does Back.
  await card.click();
  await page.getByRole("button", { name: "Back to Fronts" }).click();
  await expect(page.locator(".plan-open")).toBeVisible();
});

// 57c: drag a row onto a rung — a dashed ring and "Drop to move here", then
// "Moved to …" with Undo.
test("Horizons: a row dragged onto a rung moves there, with Undo", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterDemo(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const list = page.locator(".plan-open");
  const row = list.locator(".plan-row").first();
  const title = (await row.locator(".plan-row-title").innerText()).trim();
  await row.hover();
  const grip = await row.locator(".plan-row-grip").boundingBox();
  const rung = page.locator(".plan-rung[data-horizon='month']");
  const target = await rung.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 20, grip.y + 20, { steps: 5 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await expect(rung).toHaveClass(/is-drop/);
  await expect(rung).toContainText("Drop to move here");
  await page.mouse.up();

  await expect(list.getByText(title, { exact: true })).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toContainText(`Moved to This month: ${title}`);
  await page.locator(".undo-toast").getByRole("button", { name: /Undo/ }).click();
  await expect(list.getByText(title, { exact: true })).toBeVisible();
});

// 57g: Edit horizons — rename, hide, add one (Q45) and delete it, with Undo.
test("Edit horizons: rename, hide, add a 2-week horizon, delete it with Undo", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Edit horizons" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit horizons" });
  await expect(dialog.getByText("MON – SUN · REVIEW EACH MONDAY")).toBeVisible();

  await dialog.getByRole("button", { name: "Rename This week" }).click();
  await dialog.getByLabel("Name of This week").fill("Sprint");
  await dialog.getByLabel("Name of This week").press("Enter");
  await expect(page.locator(".plan-rung[data-horizon='week'] .plan-rung-name")).toHaveText("Sprint");

  await dialog.getByRole("button", { name: "Hide This quarter" }).click();
  await expect(page.locator(".plan-rung[data-horizon='quarter']")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Show This quarter" })).toBeVisible();

  await dialog.getByRole("radio", { name: "2 weeks" }).click();
  await expect(dialog.getByText("When it ends, you review it and it repeats for another 2 weeks.")).toBeVisible();
  await dialog.getByRole("button", { name: "Add horizon" }).click();
  await expect(page.locator(".plan-rung", { hasText: "2 weeks" })).toHaveCount(1);
  await expect(dialog.getByText(/^ENDS 23 JUN · REPEATS EVERY 2 WEEKS$/)).toBeVisible();

  await dialog.getByRole("button", { name: "Edit 2 weeks" }).click();
  await dialog.getByRole("button", { name: "Delete horizon" }).click();
  await expect(dialog.getByText("It holds no open tasks.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete horizon" }).click();
  await expect(page.locator(".plan-rung", { hasText: "2 weeks" })).toHaveCount(0);
  await dialog.locator(".undo-toast").getByRole("button", { name: /Undo/ }).click();
  await expect(page.locator(".plan-rung", { hasText: "2 weeks" })).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

// Q46: the drawer never covers the open list — over the ladder on a laptop,
// in the Fronts column's place from 1600.
for (const [width, cover] of [[1100, ".plan-ladder"], [1280, ".plan-ladder"], [1700, ".plan-fronts-col"]]) {
  test(`Horizons at ${width}: the task drawer leaves the open list whole (Q46)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await enterDemo(page);
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
    const list = page.locator(".plan-open");
    const listBox = await list.boundingBox();
    const coverBox = await page.locator(cover).boundingBox();
    await list.locator(".plan-row").first().click();
    const drawer = await page.getByTestId("task-detail").boundingBox();
    const overlap = Math.min(drawer.x + drawer.width, listBox.x + listBox.width) - Math.max(drawer.x, listBox.x);
    expect(overlap).toBeLessThanOrEqual(0);
    // It sits over what it replaces.
    expect(drawer.x).toBeLessThanOrEqual(coverBox.x + 1);
    // The list didn't move, and its next row takes a plain click.
    expect((await list.boundingBox()).x).toBe(listBox.x);
    await list.locator(".plan-row").nth(1).click();
    await expect(page.getByTestId("task-detail")).toContainText((await list.locator(".plan-row-title").nth(1).innerText()).trim());
  });
}
