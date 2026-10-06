import { test, expect } from "@playwright/test";
import { loadRealDay } from "./helpers/realDay";

// PART7 / 74c: with two 20-word messages and two 55-word replies, all four sit
// inside the chat window without scrolling, at the laptop, wide and phone sizes.
async function openCoach(page, w, h) {
  await loadRealDay(page, { coach: true });
  await page.setViewportSize({ width: w, height: h });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".today-wall")).toBeVisible({ timeout: 15000 });
  if (w >= 1024) await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();
  else await page.locator(".tab-bar").getByRole("button", { name: /Coach/ }).click();
  // The demo banner is not part of the real app's chrome.
  await page.evaluate(() => { document.querySelector('[data-testid="demo-banner"]')?.remove(); window.dispatchEvent(new Event("resize")); });
  await expect(page.locator(".coach-msg")).toHaveCount(4);
}

for (const [w, h] of [[1280, 720], [1903, 940], [412, 760]]) {
  test(`2 + 2 messages fit the chat window at ${w}×${h}`, async ({ page }) => {
    await openCoach(page, w, h);
    await expect.poll(() => page.evaluate(() => {
      const win = document.querySelector(".coach-chat-col .chat-window");
      const r = win.getBoundingClientRect();
      const msgs = [...win.querySelectorAll(".coach-msg")].map(m => m.getBoundingClientRect());
      return win.scrollHeight <= win.clientHeight + 1
        && msgs.every(m => m.top >= r.top - 1 && m.bottom <= r.bottom + 1);
    })).toBe(true);
    // The page itself never scrolls either.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  });
}

test("a reply over 4 lines is cut, with Show all in its name row", async ({ page }) => {
  await openCoach(page, 412, 760);
  const reply = page.locator(".coach-msg.is-coach").last();
  const showAll = reply.getByRole("button", { name: "Show all" });
  await expect(showAll).toBeVisible();
  await expect(reply.locator(".coach-reply")).toHaveClass(/is-clamped/);
  const cut = await reply.locator(".coach-reply").evaluate(el => el.clientHeight);
  await showAll.click();
  await expect(reply.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  expect(await reply.locator(".coach-reply").evaluate(el => el.clientHeight)).toBeGreaterThan(cut);
  await reply.getByRole("button", { name: "Show less" }).click();
  await expect(reply.locator(".coach-reply")).toHaveClass(/is-clamped/);
});

// Loopcheck #495: the cut is exactly four of the text's lines at every size
// (the clamp's height in the text's line height),
// and Show all brings the reply's head into view rather than leaving the chat
// pinned to its bottom.
for (const [w, h] of [[1903, 940], [1280, 720], [412, 760]]) {
  test(`a cut reply shows exactly four lines at ${w}×${h}`, async ({ page }) => {
    await openCoach(page, w, h);
    const lines = await page.locator(".coach-msg.is-coach").last().locator(".coach-reply.is-clamped").evaluate(el => {
      const lh = parseFloat(getComputedStyle(el.querySelector(".coach-md")).lineHeight);
      return parseFloat(getComputedStyle(el).maxHeight) / lh;
    });
    expect(lines).toBeGreaterThan(3.95);
    expect(lines).toBeLessThan(4.05);
  });
}

test("Show all on an earlier reply keeps its head in view", async ({ page }) => {
  await openCoach(page, 412, 760);
  const first = page.locator(".coach-msg.is-coach").first();
  await first.getByRole("button", { name: "Show all" }).click();
  const less = first.getByRole("button", { name: "Show less" });
  await expect(less).toBeInViewport();
  await page.waitForTimeout(300);
  await expect(less).toBeInViewport();
});

// 73a: the best-weekday chart is gone; its finding is the first sentence of
// the brief's Patterns, and the brief comes before the numbers.
test("Review: the brief comes first, and Patterns opens with the best weekday", async ({ page }) => {
  await openCoach(page, 1280, 720);
  await page.getByRole("tab", { name: "Review" }).click();
  const brief = page.getByRole("region", { name: "Coach's brief" });
  const yesterday = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleString("en-GB", { weekday: "long" }); });
  await expect(brief.locator(".br-group").filter({ hasText: "Patterns" }).locator(".br-line"))
    .toHaveText(`${yesterday} is your best weekday over the last 30 days. Health has had nothing done in 30 days.`);
  await expect(brief.getByText("Do next")).toBeVisible();
  const order = await page.evaluate(() => {
    const b = document.querySelector('[aria-label="Coach\'s brief"]');
    const f = document.querySelector('[aria-label="The facts"]');
    return b.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
});

// Rohan's call on 73a: Review scrolls, but the brief, down to the Do next
// buttons, is on the first screen, with the lead sentence present.
for (const [w, h] of [[1280, 720], [1903, 940], [412, 760]]) {
  test(`the brief fits the first screen of Review at ${w}×${h}`, async ({ page }) => {
    await openCoach(page, w, h);
    await page.getByRole("tab", { name: "Review" }).click();
    const brief = page.getByRole("region", { name: "Coach's brief" });
    await expect(brief.locator(".br-lead")).toContainText("You focused for 2h16m in these 7 days.");
    const fold = await page.evaluate(() => {
      const bar = document.querySelector(".tab-bar");
      const top = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().top : window.innerHeight;
      return Math.min(top, window.innerHeight);
    });
    const actions = await brief.locator(".br-next-actions").boundingBox();
    expect(actions.y + actions.height).toBeLessThanOrEqual(fold);
  });
}
