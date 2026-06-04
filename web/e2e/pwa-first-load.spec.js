import { test, expect } from "@playwright/test";

// PWA first-load smoke tests run signed out so they do not mutate Firebase data.
// They protect the app shell: no blank first load, privacy access, and service worker availability.

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(".signin-overlay, .signin-card, .privacy-modal, .privacy-content").forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

test("mobile reliability: signed-out first load shows app shell and privacy policy", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Loci Focus" })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 8_000 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("What we store")).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Loci Focus" })).toBeVisible({ timeout: 5_000 });
  expect(pageErrors).toEqual([]);
});

test("mobile reliability: refresh and service worker file do not break first load", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Loci Focus" })).toBeVisible({ timeout: 25_000 });

  const swResponse = await page.request.get("/sw.js");
  expect(swResponse.ok()).toBe(true);
  await expect(swResponse).toHaveHeader("content-type", /javascript|text\/plain|application\/octet-stream/i);
  expect(await swResponse.text()).toContain("notificationclick");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Loci Focus" })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible({ timeout: 8_000 });
  await expectNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});
