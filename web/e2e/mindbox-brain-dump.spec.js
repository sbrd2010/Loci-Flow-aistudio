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
  await expect(input).toHaveText("");

  // Thoughts live in Mind Box, newest first (demo seeds 4).
  const rows = page.getByTestId("thought-row");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText(thought);
  await expect(page.getByText("LATEST · 3 OF 5")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Plan has no Inbox any more.
  await openTab(page, "Plan");
  await expect(page.getByRole("heading", { name: /^Inbox/ })).toHaveCount(0);
  await openTab(page, "Mind Box");
  await expect(rows.first()).toContainText(thought);

  // A tap tints the row and shows its actions underneath (78e-6).
  await rows.first().click();
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
  await row.click();
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

// 78 §3–4: Brain dump is the card on the left; the rail holds Rescue
// (folded), Morning ritual and Anchors (open). They take turns, and the
// page never scrolls; "Not sure" enters Rescue at the breathing.
test("Mind Box: Brain dump card, Rescue and Anchors take turns, Not sure opens Rescue", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openTab(page, "Mind Box");
  await expect(page.getByRole("heading", { name: "Brain dump" })).toBeVisible();
  const rescueHead = page.getByRole("button", { name: /Can.t get started/ });
  const anchorsHead = page.getByRole("button", { name: /^Anchors/ });
  // Rescue is open on every visit; Anchors is folded to a preview.
  await expect(rescueHead).toHaveAttribute("aria-expanded", "true");
  await expect(anchorsHead).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".mbx-anchor-peek")).toBeVisible();
  const card = await page.locator(".mbx-dump").boundingBox();
  const rail = await page.locator(".mbx-rail").boundingBox();
  expect(rail.x).toBeGreaterThan(card.x + card.width);
  // The page doesn't scroll; the card ends inside the window.
  expect(card.y + card.height).toBeLessThanOrEqual(800);
  expect(await page.evaluate(() => document.querySelector(".screen-content").scrollHeight <= document.querySelector(".screen-content").clientHeight + 1)).toBe(true);

  // Opening Anchors folds Rescue, and back.
  await anchorsHead.click();
  await expect(anchorsHead).toHaveAttribute("aria-expanded", "true");
  await expect(rescueHead).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".mbx-anchor").first()).toBeVisible();
  await rescueHead.click();
  await expect(rescueHead).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Not sure. Just help me settle →" }).click();
  await expect(page.getByRole("dialog", { name: "Rescue" }).getByRole("button", { name: "Start breathing" })).toBeVisible();
});

// 78 §6: keys on a thought — ↓ moves, Delete lets it go (focus stays in the
// list), Ctrl+Z brings it back, Enter makes it a task; T focuses the editor.
test("Mind Box: thoughts by keyboard, Ctrl+Z undoes Let go, T focuses the editor", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openTab(page, "Mind Box");
  const rows = page.getByTestId("thought-row");
  const n = await rows.count();
  const second = (await rows.nth(1).locator(".thought-text").innerText()).trim();
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(rows).toHaveCount(n - 1);
  await expect(page.locator(".undo-toast")).toContainText(`Let go of “${second.slice(0, 40)}`);
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(rows).toHaveCount(n);
  await expect(rows.nth(1)).toContainText(second);

  await rows.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rows).toHaveCount(n);

  await page.locator(".mbx-title").click();
  await page.keyboard.press("t");
  await expect(page.locator(".mbx-field").getByRole("textbox", { name: "Thought" })).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// 78 §7: a phone shows the 3 newest and "All N thoughts →", a page of its own.
test("phone: 3 thoughts, then All N thoughts opens the full list", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Mind Box");
  const rows = page.getByTestId("thought-row");
  await expect(page.getByText(/^LATEST · 3 OF \d+/)).toBeVisible();
  const total = await rows.count();
  await expect(rows.filter({ visible: true })).toHaveCount(3);
  await page.getByRole("button", { name: `All ${total} thoughts →` }).click();
  await expect(page.getByRole("heading", { name: `All ${total} thoughts` })).toBeVisible();
  await expect(page.getByTestId("thought-row").filter({ visible: true })).toHaveCount(total);
  await page.getByRole("button", { name: "‹ Mind Box" }).click();
  await expect(page.getByRole("heading", { name: "Brain dump" })).toBeVisible();
});
