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

test("priority tags are mono wherever Day Map draws them", async ({ page }) => {
  await enterDemo(page);
  await page.locator(".day-map-nav-btn").click();
  await expect(page.locator(".day-map-page")).toBeVisible();

  // Day Map draws a priority tag in two places: in the unscheduled strip, and
  // on a route card. An earlier pass styled only the card — the selector was
  // scoped to .dm-card — so the strip kept painting red, amber, teal and blue
  // on the one screen whose point is that those four colours are gone. Both
  // sites are asserted, because fixing the site you are looking at and missing
  // its twin is how every colour in this PR survived its own deletion.
  const mono = async (locator, where) => {
    const style = await locator.first().evaluate((el) => {
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, color: c.color };
    });
    expect(style.bg, `${where} tag should have no fill`).toBe("rgba(0, 0, 0, 0)");
    return style.color;
  };

  const stripColor = await mono(page.locator(".day-map-chip-row .day-map-priority"), "unscheduled strip");

  await page.getByRole("button", { name: /auto-fill/i }).click();
  await expect(page.locator(".dm-card .day-map-priority").first()).toBeVisible();
  const cardColor = await mono(page.locator(".dm-card .day-map-priority"), "route card");

  // One declaration site means one colour; two means they can drift apart.
  expect(cardColor).toBe(stripColor);
});

test("the 44px hit overlays do not scroll or steal clicks", async ({ page }) => {
  await enterDemo(page);
  await page.locator(".bottom-nav").getByRole("button", { name: "Roadmap" }).click();

  // An absolutely positioned child still counts toward a scroll container's
  // scrollable overflow. .horizon-pills is overflow-x: auto, which makes the
  // y axis compute to auto as well, so a 44px overlay in a 24px row gave the
  // kickers 8px of vertical scroll — the row could be dragged up and down on
  // touch. The row is sized to fit the overlay instead of clipping it.
  await page.getByRole("button", { name: "HORIZONS" }).click();
  await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible();
  const row = await page.locator(".horizon-pills").evaluate((el) => ({
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    scrollW: el.scrollWidth, clientW: el.clientWidth,
  }));
  expect(row.scrollH, "the kicker row must not scroll vertically").toBeLessThanOrEqual(row.clientH);
  // ...while still scrolling sideways, which is what the container is for.
  expect(row.scrollW).toBeGreaterThan(row.clientW);

  // left/right: 0 would only make the target taller. Horizon labels are
  // user-facing and variable, and a short one ("Work") measured 28.8px across,
  // so the overlay carries a min-width too. Both axes are asserted, and so is
  // the absence of overlap: a widened overlay grows sideways into the gap, and
  // one that reached its neighbour would hand taps to the wrong column.
  const targets = await page.locator(".horizon-pill").evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const after = getComputedStyle(el, "::after");
    const width = Math.max(r.width, parseFloat(after.minWidth) || 0);
    const centre = r.x + r.width / 2;
    return { label: el.textContent.trim(), width, left: centre - width / 2, right: centre + width / 2 };
  }));
  for (const t of targets) {
    expect(t.width, `"${t.label}" target width`).toBeGreaterThanOrEqual(44);
  }
  for (let i = 1; i < targets.length; i++) {
    expect(targets[i].left, `"${targets[i].label}" must not overlap "${targets[i - 1].label}"`)
      .toBeGreaterThanOrEqual(targets[i - 1].right);
  }

  // The overlays sit above their own buttons, so a neighbour must still get
  // its own clicks: the point is a bigger target, not a bigger button.
  await page.locator(".bottom-nav").getByRole("button", { name: "Roadmap" }).click();
  await page.getByRole("button", { name: "New front" }).click();
  await expect(page.locator(".plan-new-form")).toBeVisible();
});
