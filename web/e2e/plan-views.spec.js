import { test, expect } from "@playwright/test";

// Plan's three-view switcher (FRONTS / DAY MAP / HORIZONS) and the Horizons
// retheme it leads to.
//
// Both tests here exist because of a specific way this PR shipped broken:
//
//   - "Back" from Day Map was hard-wired to Today. That was correct while
//     Today was the only door into Day Map; adding a second door from Plan
//     made it wrong, and nothing caught it because no test ever pressed Back.
//   - The Horizons retheme was declared a second time inside a desktop media
//     query, so the original pills kept winning at every width. The build was
//     clean and 123 e2e passed: a stylesheet can be entirely dead without a
//     single test noticing, because tests read the DOM and not the pixels.
//
// So the first test presses the button, and the second asserts on computed
// style rather than on markup.

async function enterDemo(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

test("Back from Day Map returns to whichever view opened it", async ({ page }) => {
  await enterDemo(page);

  // Door 1: Plan. Back must return to Plan, not to Today.
  await page.locator(".bottom-nav").getByRole("button", { name: "Roadmap" }).click();
  await expect(page.getByRole("button", { name: "HORIZONS" })).toBeVisible();
  await page.getByRole("button", { name: "DAY MAP" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.locator(".day-map-back").click();
  await expect(page.getByRole("button", { name: "HORIZONS" })).toBeVisible();
  await expect(page.locator(".day-map-page")).toHaveCount(0);

  // Door 2: Today. Back must still return to Today.
  await page.locator(".bottom-nav").getByRole("button", { name: "Today" }).click();
  await page.locator(".day-map-nav-btn").click();
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.locator(".day-map-back").click();
  await expect(page.locator(".day-map-nav-btn")).toBeVisible();
});

test("Horizon kickers render as kickers, not as the legacy pills", async ({ page }) => {
  await enterDemo(page);
  await page.locator(".bottom-nav").getByRole("button", { name: "Roadmap" }).click();
  await page.getByRole("button", { name: "HORIZONS" }).click();
  await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible({ timeout: 8_000 });

  // The legacy pills were a 20px-radius filled capsule; the kicker has no fill
  // and no radius. Asserted on computed style, because the markup is identical
  // either way — that is exactly what made the dead stylesheet invisible.
  const pill = page.locator(".horizon-pill").first();
  const style = await pill.evaluate((el) => {
    const c = getComputedStyle(el);
    return { radius: c.borderRadius, bg: c.backgroundColor, family: c.fontFamily };
  });
  expect(style.radius).toBe("0px");
  expect(style.bg).toBe("rgba(0, 0, 0, 0)");
  expect(style.family.toLowerCase()).toMatch(/mono/);
});
