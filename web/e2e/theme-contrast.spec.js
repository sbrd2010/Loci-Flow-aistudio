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

// The painted backdrop. Walking up for the first NON-TRANSPARENT colour is not
// enough: the unscheduled strip stacks a 7% white chip on a 4% white strip over
// the ground, and stopping at the first rgba reports a colour nothing renders.
// That is exactly how a 3.91:1 tag was measured at 4.89 and called fine. So the
// translucent layers are composited down to the first opaque one, source-over.
const PAINTED_BG = `(el) => {
  const parse = (s) => {
    // [0-9.] not [\\d.]: this function's source is a template literal, where a
    // backslash is consumed as an escape and \\d would collapse to a literal d.
    const m = String(s).match(/[0-9.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
  };
  const layers = [];
  let n = el, base = { r: 255, g: 255, b: 255, a: 1 };
  while (n) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0) {
      if (c.a >= 1) { base = c; break; }
      layers.push(c);
    }
    n = n.parentElement;
  }
  // Composite outermost-inwards over the opaque base.
  let out = base;
  for (let i = layers.length - 1; i >= 0; i--) {
    const t = layers[i];
    out = {
      r: t.r * t.a + out.r * (1 - t.a),
      g: t.g * t.a + out.g * (1 - t.a),
      b: t.b * t.a + out.b * (1 - t.a),
      a: 1,
    };
  }
  return { fg: getComputedStyle(el).color, bg: \`rgb(\${Math.round(out.r)}, \${Math.round(out.g)}, \${Math.round(out.b)})\` };
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

    await page.locator(".day-map-nav-btn").click();

    // The unscheduled strip FIRST, before auto-fill empties it. Its chip sits
    // on a lighter composited backdrop than a route card, so one foreground is
    // not automatically legible on both — asserting only the card, or only
    // that the two share a colour, is what let a 3.91:1 tag through.
    const stripTags = await page.locator(".day-map-chip-row .day-map-priority")
      .evaluateAll((els, fn) => els.map(eval(fn)), PAINTED_BG);
    expect(stripTags.length, "the strip should have tags before auto-fill").toBeGreaterThan(0);
    for (const t of stripTags) {
      expect(contrast(t.fg, t.bg), `unscheduled strip tag on ${theme}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }

    // Then every priority tag on a route card — all four, because a P4-only
    // override is exactly what survived the last collapse into one rule.
    await page.getByRole("button", { name: /auto-fill/i }).click();
    await expect(page.locator(".dm-card .day-map-priority").first()).toBeVisible();
    const tags = await page.locator(".dm-card .day-map-priority")
      .evaluateAll((els, fn) => els.map(eval(fn)), PAINTED_BG);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) {
      expect(contrast(t.fg, t.bg), `route card tag on ${theme}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
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
