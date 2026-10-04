import { test, expect } from "@playwright/test";

// Mind Box / Brain Dump reliability smoke tests run in demo mode so they do not mutate Firebase data.
// They protect the "capture it, don't lose it, don't resurrect it" flow before v0.1 reaches testers.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openTab(page, name) {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .mbx, .mbx-grid, .mbx-field, .mindbox-subview-header"
    ).forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

test("mobile reliability: a thought added in Mind Box is listed there, survives navigation, and Let go has Undo (Q56.2)", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Mind Box");
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });

  const thought = "Call the pharmacy after lunch";
  const input = page.locator(".mbx-field").getByRole("textbox", { name: "Thought" });
  await input.fill(thought);
  await input.press("Enter");
  await expect(input).toHaveValue("");

  // Thoughts live in Mind Box, newest first (demo seeds 4).
  const rows = page.getByTestId("thought-row");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText(thought);
  await expect(page.getByText(/^5 thoughts/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Plan has no Inbox any more.
  await openTab(page, "Plan");
  await expect(page.getByRole("heading", { name: /^Inbox/ })).toHaveCount(0);
  await openTab(page, "Mind Box");
  await expect(rows.first()).toContainText(thought);

  // With a mouse the actions show on hover (64a); on touch they're always there.
  await rows.first().hover();
  await rows.first().getByRole("button", { name: "Let go" }).click();
  await expect(rows).toHaveCount(4);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows.first()).toContainText(thought);
});

test("mobile reliability: Make it a task opens Add prefilled, and the thought leaves once it's a task", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Mind Box");
  const row = page.getByTestId("thought-row").first();
  const text = (await row.locator(".thought-text").innerText()).trim();
  await row.hover();
  await row.getByRole("button", { name: "Make it a task" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radiogroup", { name: "Add a" })).toHaveCount(0);
  await expect(dialog.getByTestId("add-task-title")).toHaveValue(text);
  await dialog.getByRole("button", { name: /^Add to/ }).click();
  await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("thought-row").filter({ hasText: text })).toHaveCount(0);
});

test("Mind Box has no Progress, streak or Key Deadline Mirror (Q57)", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Mind Box");
  await expect(page.getByRole("heading", { name: "Morning ritual" })).toBeVisible();
  await expect(page.getByText("Progress", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/streak/i)).toHaveCount(0);
  await expect(page.getByTestId("deadline-progress-mirror")).toHaveCount(0);
  await expect(page.getByText(/\bXP\b/)).toHaveCount(0);
});

// Q55.1a (65a–f): Rescue first, Empty your head, then Morning ritual and
// Anchors read in place; "Not sure" enters Rescue at the breathing.
test("Mind Box: the three levels, and Not sure opens Rescue at the breathing", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openTab(page, "Mind Box");
  await expect(page.getByRole("heading", { name: "Head not ready to work?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Empty your head" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Anchors" })).toBeVisible();
  await expect(page.locator(".mbx-anchor").first()).toBeVisible();
  // Laptop: two columns, the quiet one on the right.
  const rescueBox = await page.locator(".mbx-rescue").boundingBox();
  const quietBox = await page.locator(".mbx-quiet").boundingBox();
  expect(quietBox.x).toBeGreaterThan(rescueBox.x + rescueBox.width);
  await page.getByRole("button", { name: "Not sure. Just help me settle →" }).click();
  await expect(page.getByRole("dialog", { name: "Rescue" }).getByText("ROUND 1 OF 4")).toBeVisible();
});
