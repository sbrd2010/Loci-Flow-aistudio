import { test, expect } from "@playwright/test";

// The route engine's breaks (turn 57b answer 2): the gap between two focus
// windows is a break on the route, and a task that runs into it stops for it
// and continues after (no buffer before a break, none after it). Demo mode,
// so nothing reaches Firebase.

async function openDayMapWithLunch(page, viewport = { width: 412, height: 892 }, dayEnd = "17:30") {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  // Settings › Focus windows: 08:00–13:35 and 14:15–17:30, so 13:35–14:15 is a break.
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /^Focus windows/ }).click();
  await page.getByRole("button", { name: "Remove focus window 1" }).click();
  await page.getByRole("button", { name: "Add a window" }).click();
  await page.getByLabel("Focus window 1 start time").fill("08:00");
  await page.getByLabel("Focus window 1 end time").fill("13:35");
  await page.getByRole("button", { name: "Add a window" }).click();
  await page.getByLabel("Focus window 2 start time").fill("14:15");
  await page.getByLabel("Focus window 2 end time").fill(dayEnd);
  await expect(page.locator(".set-facts")).toContainText(dayEnd);
  // The gap is a break; this one is named.
  await page.getByRole("textbox", { name: "Break name" }).fill("Lunch");
  await page.getByRole("textbox", { name: "Break name" }).blur();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Day map →" }).click();
}

test("a task that runs into the break stops for it and continues after; the next stop follows it", async ({ page }) => {
  await openDayMapWithLunch(page);

  // The first stop, 3h from 11:35: 2h before the break, 1h after it.
  const first = page.locator(".dm-stop .dm-main").first();
  const title = (await first.locator(".dm-title").innerText()).trim();
  await first.click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: /^Estimate/ }).click();
  await sheet.getByRole("radio", { name: "3h" }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();

  const route = page.getByRole("list", { name: "Today's route" });
  await expect(route.locator(".dm-break")).toHaveAttribute("aria-label", "13:35 to 14:15, Lunch");
  await expect(route.locator(".dm-break .dm-dur")).toHaveText("40m");
  await expect(route.locator(".dm-stop").first().locator(".dm-dur")).toHaveText("2h");
  const rest = route.locator(".dm-stop.is-continued");
  await expect(rest).toHaveCount(1);
  await expect(rest.locator(".dm-time")).toHaveText("14:15");
  await expect(rest.locator(".dm-title")).toHaveText(`${title} · continued`);
  await expect(rest.locator(".dm-dur")).toHaveText("1h");
  // 15:15 plus the 5-minute buffer, on a 5-minute mark (Q35).
  await expect(rest.locator("xpath=following-sibling::li[1]").locator(".dm-time")).toHaveText("15:20");

  // The continued row opens the same task.
  await rest.locator(".dm-main").click();
  await expect(sheet).toHaveAttribute("aria-label", `Task: ${title}`);
});

// Codex review of #425: a split stop that ends past the day end goes under
// the DAY ENDS line whole, and the rows stay in time order — its first part,
// the break, then the rest.
test("a split stop that ends past the day end is under the line, in time order", async ({ page }) => {
  await openDayMapWithLunch(page, { width: 412, height: 892 }, "15:00");
  const first = page.locator(".dm-stop .dm-main").first();
  await first.click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: /^Estimate/ }).click();
  await sheet.getByRole("radio", { name: "3h" }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();

  // 11:35–13:35, Lunch, then 14:15–15:15: past 15:00.
  const order = await page.getByRole("list", { name: "Today's route" }).evaluate(ol =>
    [...ol.children].map(li => li.className.split(" ")[0] + (li.classList.contains("is-continued") ? ":continued" : "")));
  const line = order.indexOf("dm-dayend");
  expect(order.indexOf("dm-stop")).toBeGreaterThan(line);
  expect(order.indexOf("dm-break")).toBeGreaterThan(order.indexOf("dm-stop"));
  expect(order.indexOf("dm-stop:continued")).toBeGreaterThan(order.indexOf("dm-break"));
});
