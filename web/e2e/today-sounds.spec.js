import { test, expect } from "@playwright/test";

// 75e (try-out 43): Settings › Appearance › Sounds, off by default. On, the
// list's hide and show play two notes each and finishing a task three; off,
// nothing plays. The audio is counted, not heard: a stand-in AudioContext
// records each note started.
async function enterDemo(page) {
  await page.addInitScript(() => {
    window.__notes = [];
    class FakeCtx {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() {
        const osc = { type: "", frequency: { value: 0 }, connect() {}, stop() {}, start: () => window.__notes.push(osc.frequency.value) };
        return osc;
      }
    }
    window.AudioContext = FakeCtx;
    window.webkitAudioContext = FakeCtx;
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".today-wall")).toBeVisible({ timeout: 10_000 });
}
const notes = (page) => page.evaluate(() => window.__notes.length);
const nav = (page) => page.getByRole("navigation", { name: "Main navigation" });

test("Sounds is off by default: hiding the list and finishing a task stay silent", async ({ page }) => {
  await enterDemo(page);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("l");
  await page.waitForTimeout(700);
  await page.keyboard.press("l");
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /^Mark done/ }).first().click();
  await page.waitForTimeout(300);
  expect(await notes(page)).toBe(0);
});

test("with Sounds on, the list plays two notes each way and Mark done three", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Appearance" }).click();
  const sounds = page.getByRole("switch", { name: /^Sounds/ });
  await expect(sounds).toHaveAttribute("aria-checked", "false");
  await sounds.click();
  await expect(sounds).toHaveAttribute("aria-checked", "true");
  await nav(page).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".today-wall")).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("l");
  await expect.poll(() => notes(page)).toBe(2);
  await page.waitForTimeout(700);
  await page.keyboard.press("l");
  await expect.poll(() => notes(page)).toBe(4);
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /^Mark done/ }).first().click();
  await expect.poll(() => notes(page)).toBe(7);
});
