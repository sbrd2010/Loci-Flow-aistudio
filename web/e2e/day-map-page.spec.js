import { test, expect } from "@playwright/test";

// 50e–f: the Day map is Today's own page — Back (Esc), the title, and a day
// clock; Today stays current in the nav, which stays on screen.

async function enterDemo(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openDayMapByKey(page) {
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await expect(page.locator(".day-map-page")).toBeVisible();
}

test("phone: the Day map keeps the bottom nav with Today current, and its own header takes the app header's place (50e)", async ({ page }) => {
  await enterDemo(page, { width: 412, height: 892 });
  await openDayMapByKey(page);
  const nav = page.locator(".tab-bar");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".shell-header")).toBeHidden();

  // 56c: the factual line, then the day bar with NOW on it.
  await expect(page.locator(".dm-fact")).toHaveText(/^On track: done by \d{2}:\d{2}\.$/);
  await expect(page.getByRole("img", { name: /^The day so far: it runs 07:00 to 02:00; now 11:35$/ })).toBeVisible();
  await expect(page.locator(".dm-daybar-labels")).toContainText("11:35 NOW");

  // Today in the nav takes you back.
  await nav.getByRole("button", { name: "Today" }).click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
});

test("laptop: the app header stays with Today current; ‹ Today and Esc go back (50f)", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  const header = page.locator(".shell-header");
  await expect(header).toBeVisible();
  await expect(header.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
  const back = page.getByRole("button", { name: "Back to Today" });
  await expect(back).toContainText("Today");
  await expect(page.locator(".dm-fact")).toHaveText(/^On track: done by \d{2}:\d{2}\.$/);

  // Esc in the From picker is the picker's own; on the page it goes back.
  const from = page.locator(".dm-from-select");
  await expect(from).toBeVisible();
  await from.click();
  await expect(page.getByRole("dialog", { name: "Start the route at" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Start the route at" })).toHaveCount(0);
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.locator(".dm-heading").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".day-map-page")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toBeVisible();

  // And back in by the key, out by the link.
  await openDayMapByKey(page);
  await back.click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
});

// Codex review of #409: NOW marks where the fill ends — early in the day too,
// not held at a fifth of the way along — and stays inside the bar.
test("the NOW label sits where the day's fill ends, even near the start", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T07:30:00"));
  await page.getByTestId("demo-btn").click();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  const geo = await page.evaluate(() => {
    const bar = document.querySelector(".dm-daybar-track").getBoundingClientRect();
    const fill = document.querySelector(".dm-daybar-done").getBoundingClientRect();
    const now = document.querySelector(".dm-daybar-now").getBoundingClientRect();
    const frac = fill.width / bar.width;
    return { frac, fillEnd: fill.right, anchor: now.left + frac * now.width, nowLeft: now.left, nowRight: now.right, barLeft: bar.left, barRight: bar.right };
  });
  expect(geo.frac).toBeGreaterThan(0);
  expect(geo.frac).toBeLessThan(0.15);
  // The point of the label that marks now is over the fill's end.
  expect(Math.abs(geo.anchor - geo.fillEnd)).toBeLessThan(2);
  expect(geo.nowLeft).toBeGreaterThanOrEqual(geo.barLeft - 1);
  expect(geo.nowRight).toBeLessThanOrEqual(geo.barRight + 1);
  await expect(page.locator(".dm-daybar-labels span").first()).toHaveClass(/is-covered/);
});

// Codex review of #409: the header is back on a laptop, so the Loci wordmark
// is another way out of the Day map (it goes through goToday, which now saves
// pending edits first, as Back and the tabs do).
test("laptop: the Loci wordmark leaves the Day map for Today", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  await page.getByRole("banner").getByRole("button", { name: "Loci" }).click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toBeVisible();
});

// 56a–c: what was done today sits folded above the route, oldest first. The
// demo has no session ledger, so a task ticked done is its row ("marked
// done", no duration), and the line leaves the done part out.
test("a task marked done shows in the folded Done so far today, and the line says where the day stands", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  await expect(page.locator(".dm-fact")).toHaveText(/^On track: done by \d{2}:\d{2}\.$/);
  // The one thing, at NOW, until its stop ends.
  await expect(page.locator(".dm-stop.is-now .dm-one-thing")).toHaveText(/^NOW · UNTIL \d{2}:\d{2}$/);

  const first = page.locator(".dm-stop .dm-main").first();
  const title = (await page.locator(".dm-stop .dm-title").first().innerText()).trim();
  await first.click();
  await page.getByTestId("task-detail").getByRole("button", { name: `Mark done: ${title}` }).click();

  const fold = page.getByRole("region", { name: "Done so far today" });
  const toggle = fold.getByRole("button", { name: /^Done so far today · 1/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(fold.locator(".dm-done-row")).toHaveCount(1);
  await expect(fold.locator(".dm-done-row")).toContainText(title);
  await expect(fold.locator(".dm-done-row")).toContainText("MARKED DONE");
});

// 56a–b, 57b answer 6, Q33.1: Change picks up to three; Confirm makes them
// the minimum day, one line in the right column, MIN on the Day map's rows
// and on Today's list.
test("the minimum day: Change picks, Confirm makes it one line with MIN on the rows", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  // Today's two list rows (the one thing is on the wall, not in the list).
  const picked = (await page.getByTestId("today-tasks-list").locator("[data-testid='task-row'] .task-title-text").allInnerTexts()).map(t => t.trim());
  expect(picked.length).toBe(2);
  await openDayMapByKey(page);
  const min = page.getByRole("region", { name: "Minimum day" });
  // The demo day has no must-dos or goal tasks: nothing is suggested, and
  // the heading gives no count (loopcheck #495).
  await expect(min.getByRole("heading")).toHaveText("At least these 3");
  await expect(min).toContainText("No must-dos or goal tasks today. Pick up to three.");

  await min.getByRole("button", { name: "Change" }).click();
  await expect(min.getByRole("checkbox")).toHaveCount(3);
  for (const title of picked) await min.getByRole("checkbox", { name: title }).check();
  await min.getByRole("button", { name: "Confirm" }).click();
  // Listed in today's order on the route.
  const onRoute = (await page.locator(".dm-stop .dm-title").allInnerTexts()).map(t => t.replace(/\s*MIN$/, "").trim());
  picked.sort((a, b) => onRoute.findIndex(t => t.startsWith(a)) - onRoute.findIndex(t => t.startsWith(b)));

  await expect(min.locator(".dm-min-line")).toContainText(`Minimum day · ${picked[0]}, ${picked[1]}`);
  await expect(page.locator(".dm-stop .task-tag.is-min:not(.is-suggested)")).toHaveCount(2);
  await expect(page.locator(".dm-stop .task-tag.is-min.is-suggested")).toHaveCount(0);

  await page.getByRole("button", { name: "Back to Today" }).click();
  // At 1280 the list starts hidden (54c): show it.
  await page.getByRole("button", { name: /^Show list/ }).click();
  const list = page.getByTestId("today-tasks-list");
  for (const title of picked) {
    await expect(list.locator("[data-testid='task-row']", { hasText: title }).getByLabel("Minimum day")).toBeVisible();
  }
});

// Codex review of #428: with every task done, the page's empty state still
// shows "Done so far today", where the day's sessions matter most.
test("with every task done, Done so far today stays on the page", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  for (let i = 0; i < 3; i += 1) {
    const title = (await page.locator(".dm-stop .dm-title").first().innerText()).split("\n")[0].trim();
    await page.locator(".dm-stop .dm-main").first().click();
    await page.getByTestId("task-detail").getByRole("button", { name: `Mark done: ${title}` }).click();
    await expect(page.getByTestId("task-detail")).toHaveCount(0);
  }
  await expect(page.locator(".dm-empty")).toBeVisible();
  await expect(page.getByRole("region", { name: "Done so far today" }).getByRole("button", { name: /^Done so far today · 3/ })).toBeVisible();
});

// Try-out 19: From is a small panel in place of the browser's long list —
// Now, the next quarter-hours, or a typed time. With the day running to
// 02:00, a time typed before now is after midnight; past the day's end it
// is refused, and says why.
test("From: tap Now or a quarter-hour, or type a time; after midnight works, past the day's end doesn't", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".wall-title")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("m");
  const from = page.locator(".dm-from-select");
  await expect(from).toHaveText(/^10:00 \(now\)/);
  await expect(page.locator("select")).toHaveCount(0);
  await from.click();
  const panel = page.getByRole("dialog", { name: "Start the route at" });
  await expect(panel.getByRole("button", { name: /^Now · 10:00$/ })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "10:30", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(from).toHaveText(/^10:30/);
  await expect(page.locator(".dm-stop .dm-time").first()).toHaveText("10:30");

  await from.click();
  const typed = panel.getByLabel("Route start, typed");
  await typed.fill("1:30");
  await typed.press("Enter");
  await expect(from).toHaveText(/^01:30/);

  await from.click();
  await typed.fill("06:00");
  await typed.press("Enter");
  await expect(panel.getByRole("alert")).toHaveText("Pick a time from now until 02:00");
  await panel.getByRole("button", { name: /^Now/ }).click();
  await expect(from).toHaveText(/^10:00 \(now\)/);
});

// Codex review of #499: with the start at Now, the minute moving on doesn't
// wipe a time being typed.
test("From: a half-typed time survives the clock moving on", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".wall-title")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("m");
  await page.locator(".dm-from-select").click();
  const typed = page.getByRole("dialog", { name: "Start the route at" }).getByLabel("Route start, typed");
  await typed.fill("11:");
  await page.clock.runFor(61_000);
  await expect(typed).toHaveValue("11:");
  await typed.pressSequentially("15");
  await typed.press("Enter");
  await expect(page.locator(".dm-from-select")).toHaveText(/^11:15/);
});

// Review of #511, 2.4: the window resizing (the on-screen keyboard, a rotated
// phone) while a time is typed in From used to throw and leave the panel as
// it was; it must neither throw nor close the panel under the person's hands.
test("From: the window resizing while a time is typed keeps the panel open", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".wall-title")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("m");
  await page.locator(".dm-from-select").click();
  const panel = page.getByRole("dialog", { name: "Start the route at" });
  const typed = panel.getByLabel("Route start, typed");
  await typed.focus();
  await typed.fill("11:");
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.waitForTimeout(200);
  await expect(panel).toBeVisible();
  await expect(typed).toHaveValue("11:");
  expect(errors).toEqual([]);
});

// Review of #511, 2.1: the footer's total is the done tasks plus the open
// ones, as Today's footer counts it.
test("the footer counts done today out of done plus open", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  const text = await page.locator(".dm-foot-done").innerText();
  const [, done, total] = text.match(/^(\d+) OF (\d+) DONE TODAY$/);
  const open = await page.locator(".dm-stop[data-task-uuid]").count();
  expect(Number(total)).toBe(Number(done) + open);
});

// Try-out issue 8: on the 24″ (app zoom ×1.07) a stop dragged one row up and
// let go over the middle of that row stayed put; down went one row too far.
// The empty drag overlay is the dragged box, and it sat zoomed, a row low.
test("24″: a stop dragged onto the middle of the row above or below moves one place (issue 8)", async ({ page }) => {
  await enterDemo(page, { width: 1903, height: 940 });
  await openDayMapByKey(page);
  const titles = () => page.locator(".dm-stop[data-task-uuid] .dm-title").evaluateAll(els => els.map(e => e.innerText.split("\n")[0]));
  const stops = page.locator(".dm-stop[data-task-uuid]:not(.is-now)");
  await expect(stops).toHaveCount(2);
  const drag = async (from, to) => {
    const src = stops.nth(from), tgt = stops.nth(to);
    await src.scrollIntoViewIfNeeded();
    await tgt.scrollIntoViewIfNeeded();
    const s = await src.boundingBox(), t = await tgt.boundingBox();
    const x = s.x + s.width / 2;
    await page.mouse.move(x, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, s.y + s.height / 2 + (to < from ? -10 : 10), { steps: 3 });
    await page.mouse.move(x, t.y + t.height / 2, { steps: 12 });
    await page.mouse.up();
  };
  const moved = (await stops.nth(1).locator(".dm-title").innerText()).split("\n")[0];
  const before = await titles();
  const at = before.indexOf(moved);
  await drag(1, 0);
  await expect.poll(async () => (await titles()).indexOf(moved)).toBe(at - 1);
  await drag(0, 1);
  await expect.poll(async () => (await titles()).indexOf(moved)).toBe(at);
});

// 12 Oct try-out: a held stop is a card under the pointer and the route holds
// still; a line marks where it lands (above the stop it goes before).
test("holding a stop shows a card and a drop line; the other stops stay put", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  const stops = page.locator(".dm-stop[data-task-uuid]:not(.is-now)");
  await expect(stops).toHaveCount(2);
  const s = await stops.nth(1).boundingBox(), t = await stops.nth(0).boundingBox();
  const x = s.x + s.width / 2;
  await page.mouse.move(x, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, s.y + s.height / 2 - 10, { steps: 3 });
  await page.mouse.move(x, t.y + t.height / 2, { steps: 10 });
  await expect(page.locator(".dm-drag-card")).toBeVisible();
  await expect(stops.nth(0)).toHaveClass(/is-drop-before/);
  // The stop it would go before has not moved.
  expect((await stops.nth(0).boundingBox()).y).toBeCloseTo(t.y, 0);
  await page.mouse.up();
  await expect(page.locator(".dm-drag-card")).toHaveCount(0);
  await expect(page.locator(".is-drop-before, .is-drop-after")).toHaveCount(0);
});
