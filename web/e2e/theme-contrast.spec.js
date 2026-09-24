import { test, expect } from "@playwright/test";
import { paintedBackdrop, contrastRatio, parseRgb } from "./helpers/pixels.js";
import { THEME_CHOICES } from "../src/utils/theme.js";

// The rethemed surfaces, checked against every theme a user can actually pick.
//
// This exists because several contrast defects reached review on one PR, and
// none was visible from the stylesheet alone:
//
//   - Paper defines --text-quiet at the root as dark ink for a light page.
//     Day Map is dark under EVERY theme, so var(--text-quiet, var(--text-muted))
//     never reached its fallback — the variable IS defined, just wrong for that
//     canvas — and the priority tags rendered at 2.49:1.
//   - The legacy themes define no --text-quiet at all, and their --text-muted
//     is a deliberately faint tier: the 10px kickers measured 2.58:1 on Teal.
//   - The unscheduled strip stacks translucent layers, so the same foreground
//     that cleared 4.5:1 on a route card sat at 3.91:1 there.
//   - A P4 override survived on the route card after the other three were
//     collapsed, so exactly one priority kept the old chip.
//
// Every one is correct CSS producing an unreadable result under some theme, so
// a per-theme assertion is the only thing that catches them — and it has to
// measure PAINTED PIXELS. Two earlier versions of this file derived the
// backdrop from CSS and were wrong both times: first by stopping at the nearest
// non-transparent layer, then by ignoring background-image, which the glassy
// theme uses for the radial gradients behind these very kickers.

// The themes come from utils/theme.js, so a theme added there is covered here
// without anyone remembering to update a list. An earlier hardcoded array
// silently omitted four. Auto is not a palette of its own — it resolves to
// Light or Dark — so it gets the behaviour test at the bottom instead.
const THEMES = THEME_CHOICES.filter((t) => t !== "auto");

const MIN_CONTRAST = 4.5;
const MIN_TOUCH_PX = 44;

test("the theme list is read from utils/theme.js, not guessed", () => {
  expect(THEMES).toEqual(["light", "dark"]);
});

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

// The text colour is read from the element; only the backdrop needs sampling.
async function assertLegible(locator, what, theme) {
  const fg = parseRgb(await locator.evaluate((el) => getComputedStyle(el).color));
  const bg = await paintedBackdrop(locator);
  const ratio = contrastRatio(fg, bg);
  expect(ratio, `${what} on ${theme} — rgb(${fg}) on painted rgb(${bg}), ${ratio.toFixed(2)}:1`)
    .toBeGreaterThanOrEqual(MIN_CONTRAST);
}

// A hit area can be declared 44px and still be clipped: an overlay centred on a
// button in a scroll container overflows the scrollport, and a container cannot
// scroll above zero, so that part never receives a tap. Measure what is INSIDE.
const visibleHitHeight = (locator) => locator.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const declared = Math.max(box.height, parseFloat(getComputedStyle(el, "::after").height) || 0);
  const scroller = el.closest(".horizon-pills, .plan-views") || el.parentElement;
  const cs = getComputedStyle(scroller);
  if (cs.overflowX === "visible" && cs.overflowY === "visible") return declared;
  const sr = scroller.getBoundingClientRect();
  const portTop = sr.top + parseFloat(cs.borderTopWidth);
  const portBottom = sr.bottom - parseFloat(cs.borderBottomWidth);
  const centre = box.top + box.height / 2;
  return Math.min(centre + declared / 2, portBottom) - Math.max(centre - declared / 2, portTop);
});

for (const theme of THEMES) {
  test(`${theme}: rethemed text stays legible and tappable`, async ({ page }) => {
    await enterDemo(page, theme);

    // The list opens as a sheet over the wall on a phone; the wall is measured
    // with it put away, and the list once it is open again and settled.
    await page.locator(".today-list-hide").click();

    // Today's wall: the smallest text on it, on its own grounds — the gold
    // kicker on the gold band is the tightest pair (4.82:1 by calculation).
    for (const [sel, what] of [
      [".wall-goal-kicker", "goal kicker"],
      [".wall-goal-name", "goal name"],
      [".wall-anchor-count", "anchor count"],
      [".wall-kicker", "TODAY, ONE THING"],
      [".wall-first-step-label", "first step label"],
      [".wall-primary-figure", "timer on Start focus"],
      [".wall-peek-label", "peek label"],
    ]) {
      await assertLegible(page.locator(sel).first(), what, theme);
    }

    await page.locator(".wall-peek").click();
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));

    // The list (41a/37b): its quietest text, on the list's own ground.
    for (const [loc, what] of [
      [page.locator(".today-list-count"), "list count"],
      [page.locator(".today-seg-opt[aria-pressed='false']"), "unselected segment"],
      [page.locator(".today-energy-caption"), "Low energy caption"],
      [page.locator(".task-row-priority"), "row priority tag"],
      [page.locator(".task-tag.is-now"), "NOW tag"],
      [page.locator(".today-list-link"), "Day map link"],
    ]) {
      await assertLegible(loc.first(), what, theme);
    }

    // The Undo toast inverts in both themes (39): its line and its action.
    await page.getByTestId("today-tasks-list").getByTestId("task-checkbox").first().click();
    const toast = page.locator(".undo-toast").filter({ hasText: "Marked done" });
    await expect(toast).toBeVisible();
    await toast.hover();
    await assertLegible(toast.locator(".undo-toast-text"), "toast line", theme);
    await assertLegible(toast.locator(".undo-toast-btn"), "toast Undo", theme);
    await toast.locator(".undo-toast-btn").click();
    await expect(toast).toHaveCount(0);

    await page.getByRole("button", { name: "Day map →" }).click();

    // The unscheduled strip FIRST, before auto-fill empties it. Its chip sits
    // on a lighter composited backdrop than a route card, so one foreground is
    // not automatically legible on both.
    const stripTags = page.locator(".dm-unscheduled .dm-p");
    const stripCount = await stripTags.count();
    expect(stripCount, "the strip should have tags before auto-fill").toBeGreaterThan(0);
    for (let i = 0; i < stripCount; i++) {
      await assertLegible(stripTags.nth(i), "unscheduled strip tag", theme);
    }

    // Then every priority tag on a route card — all four, because a P4-only
    // override is exactly what survived the last collapse into one rule.
    await page.getByRole("button", { name: /auto-fill/i }).click();
    await expect(page.locator(".dm-stop .dm-p:visible").first()).toBeVisible();
    const cardTags = page.locator(".dm-stop .dm-p:visible");
    const cardCount = await cardTags.count();
    expect(cardCount).toBeGreaterThan(0);
    for (let i = 0; i < cardCount; i++) {
      await assertLegible(cardTags.nth(i), "route card tag", theme);
    }
    await page.locator(".dm-back").click();

    // Plan's view switcher.
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByRole("button", { name: "HORIZONS" })).toBeVisible();
    await assertLegible(page.locator("button.plan-view").first(), "plan kicker", theme);
    expect(await visibleHitHeight(page.getByRole("button", { name: "DAY MAP" })),
      `plan kicker hit area on ${theme}`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);

    // The horizon switcher.
    await page.getByRole("button", { name: "HORIZONS" }).click();
    await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible();
    await assertLegible(page.locator(".horizon-pill").first(), "horizon kicker", theme);
    expect(await visibleHitHeight(page.locator(".horizon-pill").first()),
      `horizon kicker hit area on ${theme}`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  });
}

// Auto follows the device, live: flipping the OS setting while the app is open
// repaints it without a reload.
test("auto follows the device's dark-mode setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await enterDemo(page, "auto");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "light");
});
