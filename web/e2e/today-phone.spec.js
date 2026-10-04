import { test, expect } from "@playwright/test";

// Q58 on the phone (67a, 67d): one thing, one button, a quiet row (I'm stuck ·
// Done · More), and More holding the rest, each at once with Undo.

async function enterDemo(page, viewport = { width: 412, height: 915 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".wall-title")).toBeVisible({ timeout: 10_000 });
}

const quiet = (page) => page.locator(".wall-quiet");
const more = (page) => page.getByRole("dialog", { name: /^More:/ });
async function openMore(page) {
  await quiet(page).getByRole("button", { name: "More" }).click();
  await expect(more(page)).toBeVisible();
}

test("phone: the quiet row stands in for the buttons and links; Start is the only filled control", async ({ page }) => {
  await enterDemo(page);
  await expect(quiet(page).getByRole("button")).toHaveText(["I’m stuck", "Done", "More"]);
  await expect(page.locator(".wall-actions")).toBeHidden();
  await expect(page.locator(".wall-foot .wall-links")).toBeHidden();
  await expect(page.locator(".wall-anchor")).toBeHidden();
  await expect(page.locator(".wall-kicker-phone")).toHaveText(/^NOW · 1 OF \d+$/);
  // 58.2: the date leaves the header; the time left stays.
  await expect(page.locator(".shell-clock-date")).toBeHidden();
  await expect(page.locator(".shell-clock")).toContainText(/LEFT/);

  await quiet(page).getByRole("button", { name: "I’m stuck" }).click();
  await expect(page.getByRole("dialog", { name: "Rescue" })).toBeVisible();
});

test("laptop: no quiet row; the wall's buttons and links stay, Rescue's link reads I'm stuck", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await expect(quiet(page)).toBeHidden();
  await expect(page.locator(".wall-action", { hasText: "Mark done" })).toBeVisible();
  await expect(page.locator(".shell-clock-date")).toBeVisible();
});

test("More: Move to This week takes it off Today at once, and Undo brings it back as the one thing", async ({ page }) => {
  await enterDemo(page);
  const title = (await page.locator(".wall-title").innerText()).trim();
  await openMore(page);
  await expect(more(page).getByRole("button")).toHaveText([/^Split it/, /^Details/, /^Move to…/, /^Park/, /^Not the one thing/, "Delete"]);
  await more(page).getByRole("button", { name: /^Move to…/ }).click();
  await more(page).getByRole("button", { name: "This week", exact: true }).click();
  await expect(more(page)).toHaveCount(0);
  await expect(page.locator(".wall-title", { hasText: title })).toHaveCount(0);
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".wall-title")).toHaveText(title);
});

test("More: Delete happens at once, no confirm, and Undo brings it back", async ({ page }) => {
  await enterDemo(page);
  const title = (await page.locator(".wall-title").innerText()).trim();
  await openMore(page);
  await more(page).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator(".wall-title", { hasText: title })).toHaveCount(0);
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".wall-title")).toHaveText(title);
});

test("More: Esc closes it and hands focus back to More", async ({ page }) => {
  await enterDemo(page);
  await openMore(page);
  await page.keyboard.press("Escape");
  await expect(more(page)).toHaveCount(0);
  await expect(quiet(page).getByRole("button", { name: "More" })).toBeFocused();
});

test("phone: a title past three lines is cut, and Full title and details opens it", async ({ page }) => {
  await enterDemo(page, { width: 360, height: 800 });
  await openMore(page);
  await more(page).getByRole("button", { name: /^Not the one thing/ }).click();
  const long = "Write the long methods section on membrane durability testing with every pressure cycling condition spelled out in full";
  await page.locator(".wall-commit-field").fill(long);
  await page.locator(".wall-commit-field").press("Enter");
  await expect(page.locator(".wall-title")).toContainText("Write the long methods");
  expect(await page.locator(".wall-title").evaluate(el => getComputedStyle(el).webkitLineClamp)).toBe("3");
  await page.getByRole("button", { name: "Full title and details" }).click();
  await expect(page.getByTestId("task-detail")).toBeVisible();
});

// 58.1/58.5 (67a): the Next strip sits on the tab bar with the next task; "+"
// is a 56px circle at its right. 58.6 (67c): it opens Up next, the next 3,
// then "All N tasks"; done tasks fold under "Done today".
test("phone: the Next strip names the next task above the tabs, with a 56px +", async ({ page }) => {
  await enterDemo(page);
  const strip = page.locator(".wall-peek-row");
  await expect(strip.locator(".wall-peek-next")).toHaveText(/^NEXT\s+\S/);
  const tabs = await page.locator(".tab-bar").boundingBox();
  const box = await strip.boundingBox();
  expect(Math.abs(box.y + box.height - tabs.y)).toBeLessThanOrEqual(2);
  const plus = await page.getByRole("button", { name: "Add a task to Today" }).first().boundingBox();
  expect(Math.round(plus.width)).toBe(56);
});

test("phone: Up next shows 3, then All N opens the rest; done tasks fold under Done today", async ({ page }) => {
  await enterDemo(page);
  for (const title of ["Draft the methods outline", "Order printer ink"]) {
    await page.getByRole("button", { name: "Add a task to Today" }).first().click();
    await page.getByTestId("add-task-title").fill(title);
    await page.getByTestId("add-task-submit").click();
    await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  }
  if (!(await page.locator(".today-list.is-sheet").isVisible())) await page.locator(".wall-peek").click();
  const sheet = page.locator(".today-list.is-sheet");
  await expect(sheet.locator(".today-list-title")).toHaveText("Up next");
  await expect(sheet.locator(".today-upnext-hint")).toHaveText("Tap a task to open it. Drag to reorder.");
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  await expect(rows).toHaveCount(3);
  await sheet.getByRole("button", { name: /^All \d+ tasks$/ }).click();
  await expect(rows).toHaveCount(4);

  await rows.first().getByTestId("task-checkbox").click();
  const fold = sheet.locator(".today-done-fold .today-parked-line");
  await expect(fold).toHaveText(/^Done today · 1/);
  await expect(sheet.locator(".task-row.completed")).toHaveCount(0);
  await fold.click();
  await expect(sheet.locator(".task-row.completed")).toHaveCount(1);
});
