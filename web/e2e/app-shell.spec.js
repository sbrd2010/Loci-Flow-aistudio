import { test, expect } from "@playwright/test";

// The shell (turns 37, 41): four tabs with icon and label, at the bottom below
// 1024px and in the header from 1024px; Settings is the header's gear, never a
// tab. Exactly one "Main navigation" is visible at any width.

async function enterDemo(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

const mainNav = (page) => page.getByRole("navigation", { name: "Main navigation" });
const gear = (page) => page.getByRole("banner").getByRole("button", { name: "Settings" });

for (const [label, width, height, place] of [
  ["phone", 412, 892, ".tab-bar"],
  ["tablet", 900, 1200, ".tab-bar"],
  ["laptop", 1280, 800, ".shell-tabs"],
]) {
  test(`${label}: four tabs in ${place}, Settings on the gear`, async ({ page }) => {
    await enterDemo(page, width, height);

    await expect(mainNav(page)).toHaveCount(1);
    await expect(page.locator(place)).toBeVisible();
    await expect(mainNav(page).getByRole("button")).toHaveText(["Today", "Plan", "Mind Box", "Coach"]);
    await expect(mainNav(page).getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");

    // Every tab and the gear is a 44px target, except the laptop header's,
    // which the design draws at 40px for a pointer (Addendum AC).
    const floor = label === "laptop" ? 40 : 44;
    for (const target of [...await mainNav(page).getByRole("button").all(), gear(page)]) {
      const box = await target.boundingBox();
      expect(box.height, await target.textContent()).toBeGreaterThanOrEqual(floor);
    }

    await gear(page).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(mainNav(page).locator("[aria-current]")).toHaveCount(0);
    if (label === "laptop") {
      await expect(gear(page)).toHaveAttribute("aria-current", "page");
    } else {
      // No Settings tab below 1024px, so the gear steps aside and a tab is
      // the way back.
      await expect(gear(page)).toBeHidden();
    }

    await mainNav(page).getByRole("button", { name: "Plan" }).click();
    await expect(mainNav(page).getByRole("button", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    await expect(gear(page)).toBeVisible();
  });
}
