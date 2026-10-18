import { test, expect } from "@playwright/test";
import { openDayMapPage } from "./helpers/today";

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
  await openDayMapPage(page);
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

// Try-out issue 1: a window added later falls into the order of the day once
// its edit is done — not while it is typed in.
test("Settings › Focus windows: a window added at an earlier time moves above once its row is left", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "The day", exact: true }).click();
  await page.getByRole("button", { name: /^Focus windows/ }).click();
  await page.getByRole("button", { name: "Remove focus window 1" }).click();
  await page.getByRole("button", { name: "Add a window" }).click();
  await page.getByLabel("Focus window 1 start time").fill("11:30");
  await page.getByLabel("Focus window 1 end time").fill("12:30");
  await page.getByRole("button", { name: "Add a window" }).click();
  await page.getByLabel("Focus window 2 start time").fill("10:00");
  // Still typing in it: it stays where it is.
  await expect(page.getByLabel("Focus window 2 start time")).toHaveValue("10:00");
  await page.getByLabel("Focus window 2 end time").fill("11:00");
  await page.getByLabel("Focus window 2 end time").blur();
  await expect(page.getByLabel("Focus window 1 start time")).toHaveValue("10:00");
  await expect(page.getByLabel("Focus window 2 start time")).toHaveValue("11:30");
});

// Review of #511, 3.2: switching to another window blurs the field with
// nothing taking focus; that is not leaving the row, so the list stays put.
test("Settings › Focus windows: switching to another window does not re-order the rows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "The day", exact: true }).click();
  await page.getByRole("button", { name: /^Focus windows/ }).click();
  await page.getByRole("button", { name: "Remove focus window 1" }).click();
  await page.getByRole("button", { name: "Add a window" }).click();
  await page.getByLabel("Focus window 1 start time").fill("11:30");
  await page.getByLabel("Focus window 1 end time").fill("12:30");
  await page.getByRole("button", { name: "Add a window" }).click();
  await page.getByLabel("Focus window 2 start time").fill("10:00");
  await page.getByLabel("Focus window 2 end time").fill("11:00");
  await page.evaluate(() => { document.hasFocus = () => false; });
  await page.getByLabel("Focus window 2 end time").blur();
  await expect(page.getByLabel("Focus window 1 start time")).toHaveValue("11:30");
  await page.evaluate(() => { delete document.hasFocus; });
  await page.getByLabel("Focus window 2 end time").focus();
  await page.getByLabel("Focus window 2 end time").blur();
  await expect(page.getByLabel("Focus window 1 start time")).toHaveValue("10:00");
});

// Codex round 2 on the issue 1 sort: moving from one row straight into another
// (its time, or its Remove) must act on the window you chose. The list sorts
// only once you leave it.
test("Settings › Focus windows: going from an edited row into another row edits and removes the one you chose", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "The day", exact: true }).click();
  await page.getByRole("button", { name: /^Focus windows/ }).click();
  await page.getByRole("button", { name: "Remove focus window 1" }).click();
  for (const [n, s, e] of [[1, "11:30", "12:30"], [2, "13:00", "14:00"], [3, "15:00", "16:00"]]) {
    await page.getByRole("button", { name: "Add a window" }).click();
    await page.getByLabel(`Focus window ${n} start time`).fill(s);
    await page.getByLabel(`Focus window ${n} end time`).fill(e);
  }
  const starts = () => page.locator(".set-window input[aria-label$='start time']").evaluateAll(els => els.map(e => e.value));
  await page.locator(".set-facts").click();
  await expect.poll(starts).toEqual(["11:30", "13:00", "15:00"]);

  // Window 1 now belongs last; straight into window 2's start, then its Remove.
  await page.getByLabel("Focus window 1 start time").fill("15:30");
  await page.getByLabel("Focus window 1 end time").fill("16:30");
  await page.getByLabel("Focus window 2 start time").click();
  await expect.poll(starts).toEqual(["15:30", "13:00", "15:00"]);
  await page.getByLabel("Focus window 2 start time").fill("13:15");
  await expect.poll(starts).toEqual(["15:30", "13:15", "15:00"]);
  await page.getByRole("button", { name: "Remove focus window 2" }).click();
  await expect.poll(starts).toEqual(["15:30", "15:00"]);

  // Leaving the list puts it in the order of the day.
  await page.locator(".set-facts").click();
  await expect.poll(starts).toEqual(["15:00", "15:30"]);
});
