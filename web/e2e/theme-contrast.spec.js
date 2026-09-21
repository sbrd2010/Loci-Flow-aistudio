import { test, expect } from "@playwright/test";

// The rethemed surfaces, checked against every selectable theme.
//
// This exists because four separate contrast defects reached review on one PR,
// and each was invisible from the stylesheet alone:
//
//   - Paper defines --text-quiet at the root as dark ink for a light page.
//     Day Map is dark under EVERY theme, so var(--text-quiet, var(--text-muted))
//     never reached its fallback — the variable IS defined, just wrong for that
//     canvas — and the priority tags rendered at 2.49:1.
//   - The thirteen legacy themes define no --text-quiet at all, and their
//     --text-muted is a deliberately faint tier: the 10px kickers measured
//     2.58:1 on Teal and 2.64:1 on Coral.
//   - A P4 override survived on the route card after the other three were
//     collapsed into a shared rule, so exactly one priority kept the old chip.
//
// A per-theme assertion is the only thing that catches these: they are all
// correct CSS producing an unreadable result under one theme out of thirteen.

const THEMES = ["glassy", "coral", "teal", "polymer", "editorial", "midnight-neon",
                "solar-ember", "arctic-frost", "regal-amethyst", "evening", "paper"];
const MIN_CONTRAST = 4.5;
const MIN_TOUCH_PX = 44;

const luminance = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const rgb = (s) => { const m = String(s).match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
const contrast = (fg, bg) => {
  const a = luminance(rgb(fg)), b = luminance(rgb(bg));
  return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
};

// The painted backdrop, not the element's own transparent background.
const PAINTED_BG = `(el) => {
  let bg = "rgba(0, 0, 0, 0)", n = el;
  while (n && bg === "rgba(0, 0, 0, 0)") { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
  return { fg: getComputedStyle(el).color, bg };
}`;

async function enterDemo(page, theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("loci_theme", t);
      localStorage.setItem("loci_today_peek_open", "1");
    } catch { /* private mode */ }
  }, theme);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

// The hit area may be a pseudo-element, so the box alone understates it.
const hitHeight = (locator) => locator.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const after = getComputedStyle(el, "::after");
  return Math.max(box.height, parseFloat(after.height) || 0);
});

for (const theme of THEMES) {
  test(`${theme}: rethemed text stays legible and tappable`, async ({ page }) => {
    await enterDemo(page, theme);

    // Every priority tag on a route card — all four, because a P4-only
    // override is exactly what survived the last collapse into one rule.
    await page.locator(".day-map-nav-btn").click();
    await page.getByRole("button", { name: /auto-fill/i }).click();
    await expect(page.locator(".dm-card .day-map-priority").first()).toBeVisible();
    const tags = await page.locator(".dm-card .day-map-priority")
      .evaluateAll((els, fn) => els.map(eval(fn)), PAINTED_BG);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) {
      expect(contrast(t.fg, t.bg), `priority tag on ${theme}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    await page.locator(".day-map-back").click();

    // Plan's view switcher.
    await page.locator(".bottom-nav").getByRole("button", { name: "Roadmap" }).click();
    await expect(page.getByRole("button", { name: "HORIZONS" })).toBeVisible();
    const planKicker = await page.locator("button.plan-view").first()
      .evaluate((el, fn) => eval(fn)(el), PAINTED_BG);
    expect(contrast(planKicker.fg, planKicker.bg), `plan kicker on ${theme}`)
      .toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(await hitHeight(page.getByRole("button", { name: "DAY MAP" })),
      `plan kicker hit area on ${theme}`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);

    // The horizon switcher.
    await page.getByRole("button", { name: "HORIZONS" }).click();
    await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible();
    const horizonKicker = await page.locator(".horizon-pill").first()
      .evaluate((el, fn) => eval(fn)(el), PAINTED_BG);
    expect(contrast(horizonKicker.fg, horizonKicker.bg), `horizon kicker on ${theme}`)
      .toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(await hitHeight(page.locator(".horizon-pill").first()),
      `horizon kicker hit area on ${theme}`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  });
}
