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

// Codex review of #474: More is modal. Today's keys wait, Tab stays in it,
// and a horizon hidden in Settings isn't offered.
test("More: Today's keys don't reach the wall behind it, and Tab stays inside", async ({ page }) => {
  await enterDemo(page);
  const title = (await page.locator(".wall-title").innerText()).trim();
  await openMore(page);
  await page.keyboard.press("d");
  await expect(more(page)).toBeVisible();
  await expect(page.locator(".wall-title")).toHaveText(title);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await more(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
});

test("More: Move to leaves out a horizon hidden in Settings", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Plan", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit horizons" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit horizons" });
  await dialog.getByRole("button", { name: "Hide This week" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Today", exact: true }).first().click();
  await openMore(page);
  await more(page).getByRole("button", { name: /^Move to…/ }).click();
  await expect(more(page).locator(".more-move")).toHaveText(["Tomorrow", "This month"]);
});
