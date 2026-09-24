import { test, expect } from "@playwright/test";

// Mobile whole-app smoke tests run in demo mode so they never mutate Firebase data.
// They protect the small-screen navigation path before v0.1 is shared with 5-10 testers.

const MOBILE_VIEWPORTS = [
  { name: "iPhone 11 Pro", width: 375, height: 812 },
  { name: "Pixel 6a", width: 412, height: 915 },
  { name: "Tablet portrait", width: 768, height: 1024 },
];

async function enterDemo(page, viewport) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(".app-container, .screen-content, .card, .tab-bar").forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

// The four tabs are in the main navigation (the bottom bar on phones and
// tablets, the header on a laptop); Settings is the header's gear.
async function openTab(page, name) {
  if (name === "Settings") {
    await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
    return;
  }
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
}

for (const viewport of MOBILE_VIEWPORTS) {
  test(`mobile reliability: core tabs load without overflow on ${viewport.name}`, async ({ page }) => {
    await enterDemo(page, viewport);

    await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    // The Roadmap tab opens on Plan (the redesign's screen 4); the horizon
    // board is one tap behind it. Both need the overflow guard — Plan's header
    // puts a title and a "New front" button on one row, which is exactly the
    // kind of thing that overflows at 320px.
    await openTab(page, "Plan");
    await expect(page.locator(".plan-tab")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("ONE NEXT MOVE EACH")).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "HORIZONS" }).click();
    await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await openTab(page, "Mind Box");
    await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(".braindump-input").first()).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await openTab(page, "Coach");
    await expect(page.getByRole("heading", { name: /Chat with/i })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("heading", { name: "AI Focus Brief" })).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await openTab(page, "Settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /^AI provider/ }).first()).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);
  });
}

const PHONE_VIEWPORTS = MOBILE_VIEWPORTS.filter((v) => v.name !== "Tablet portrait");

for (const viewport of PHONE_VIEWPORTS) {
  test(`mobile reliability: Today's list header and toolbar fit without overlap on ${viewport.name}`, async ({ page }) => {
    await enterDemo(page, viewport);
    await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
    // The sheet slides in; measure once it has settled.
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));

    // Every control in the header and toolbar is on screen and none overlap.
    const controls = [
      page.getByRole("button", { name: "Day map →" }),
      page.locator(".today-list-add"),
      page.getByRole("button", { name: /^All · \d+$/ }),
      page.getByRole("button", { name: /^Must-do · \d+$/ }),
      page.getByRole("switch", { name: "Low energy" }),
    ];
    const boxes = [];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      boxes.push(box);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, `controls ${i} and ${j} overlap`).toBe(false);
      }
    }

    // The switch is the system size (51×31) inside the row.
    const switchBox = boxes[4];
    expect(Math.round(switchBox.width)).toBe(51);
    expect(Math.round(switchBox.height)).toBe(31);

    await expectNoHorizontalOverflow(page);
    await page.getByRole("switch", { name: "Low energy" }).click();
    await expectNoHorizontalOverflow(page);
  });
}

test("mobile reliability: Settings Privacy Policy opens and closes on iPhone-sized screen", async ({ page }) => {
  await enterDemo(page, { name: "iPhone 11 Pro", width: 375, height: 812 });

  await openTab(page, "Settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 8_000 });

  await page.getByRole("button", { name: "Privacy policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("What we store")).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 5_000 });
});
