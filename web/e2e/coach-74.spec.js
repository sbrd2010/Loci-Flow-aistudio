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
