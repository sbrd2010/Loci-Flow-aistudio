import { test, expect } from "@playwright/test";
import { loadRealDay } from "./helpers/realDay";
import { sidewaysScrollers } from "./helpers/overflow";

// Today, final (75a–c; PART5, PART8; README Turn 76), on a real day's list:
// from 1280px the page never scrolls, only Up next's rows do, the footer is
// always in view, and everything grows with the window by the smaller of
// width ÷ 1422 and height ÷ 800.

async function openToday(page, viewport, { listOpen = true, dark = false } = {}) {
  await loadRealDay(page);
  await page.addInitScript(([open, d]) => {
    try {
      localStorage.setItem("loci_today_peek_open", open ? "1" : "0");
      if (d) localStorage.setItem("loci_theme", "dark");
    } catch { /* private mode */ }
  }, [listOpen, dark]);
  await page.clock.setFixedTime(new Date("2026-10-05T15:15:00"));
  await page.setViewportSize(viewport);
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".today-wall")).toBeVisible({ timeout: 10_000 });
}

// Try-out D1: a tenth smaller than Turn 76, on every page.
const scaleOf = (w, h) => Math.min(28.5 / 16, Math.max(1, Math.min(w / 1422, h / 800) / 1.1));
const S = scaleOf(1903, 940);

for (const [width, height] of [[1903, 940], [1280, 720], [1600, 900], [2560, 1305]]) {
  test(`${width}×${height}: the page never scrolls, the footer is in view, ×${scaleOf(width, height).toFixed(3)}`, async ({ page }) => {
    await openToday(page, { width, height });
    const m = await page.evaluate(() => ({
      scroll: document.scrollingElement.scrollHeight,
      inner: innerHeight,
      footBottom: document.querySelector(".today-foot").getBoundingClientRect().bottom,
      zoom: document.documentElement.currentCSSZoom,
    }));
    expect(m.scroll).toBeLessThanOrEqual(m.inner);
    expect(m.footBottom).toBeLessThanOrEqual(m.inner + 0.5);
    expect(m.zoom).toBeCloseTo(scaleOf(width, height), 3);
    // Start focus is sized to its words: narrower than 22rem at this scale.
    const start = await page.locator(".wall-start").boundingBox();
    expect(start.width).toBeLessThan(22 * 16 * m.zoom);
  });
}

test("1903×940: the task is centred in the visible height of its column (PART5)", async ({ page }) => {
  await openToday(page, { width: 1903, height: 940 });
  const [col, title, goal] = await Promise.all([
    page.locator(".today-layout-main").boundingBox(),
    page.locator(".wall-hero").boundingBox(),
    page.locator(".wall-goal").boundingBox(),
  ]);
  // The space under the goal card, less the hero's 64px (scaled) of air below.
  const top = goal.y + goal.height;
  const centre = (top + col.y + col.height - 64 * S) / 2;
  expect(Math.abs((title.y + title.height / 2) - centre)).toBeLessThan(col.height * 0.1);
});

test("1903×940: only Up next's rows scroll; its head and the footer stay", async ({ page }) => {
  await openToday(page, { width: 1903, height: 940 });
  const rows = page.getByTestId("today-tasks-list");
  const head = page.locator(".today-list-head");
  const before = await head.boundingBox();
  const scrollable = await rows.evaluate(el => el.scrollHeight > el.clientHeight);
  expect(scrollable).toBe(true);
  await rows.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => rows.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await head.boundingBox()).toEqual(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".today-foot-done")).toBeInViewport();
});

test("rows: an overdue reminder is a gold dot, and no horizon-review tag (Turn 76)", async ({ page }) => {
  await openToday(page, { width: 1280, height: 720 });
  const list = page.getByTestId("today-tasks-list");
  const iris = list.locator("[data-testid='task-row']", { hasText: "Iris: Visa extension" });
  await expect(iris.getByRole("img", { name: "Reminder overdue" })).toBeVisible();
  await expect(iris).not.toContainText("Reminder ·");
  const cv = list.locator("[data-testid='task-row']", { hasText: "Prepare CV- Avery denison" });
  await expect(cv).toBeVisible();
  await expect(cv).not.toContainText("FROM WEEK");
  await expect(list.locator("[data-testid='task-row']", { hasText: "Dad: write letter" })).toContainText("FROM YESTERDAY");
});

test("the task side: the mantra, NOW · UNTIL, and the goal on up to two lines", async ({ page }) => {
  await openToday(page, { width: 1280, height: 720 });
  await expect(page.locator(".wall-mantra")).toHaveText("ONE task at a time.");
  await expect(page.locator(".wall-kicker-wide")).toHaveText(/^NOW · UNTIL \d\d:\d\d$/);
  const name = page.locator(".wall-goal-line-name");
  await expect(name).toHaveText("05 Oct: 3 Jobs apply. Need interview in 2 weeks");
  expect(await name.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
});

test("Dark, list hidden: still no page scroll, footer in view", async ({ page }) => {
  await openToday(page, { width: 1903, height: 940 }, { listOpen: false, dark: true });
  await expect(page.locator("section.today-list")).toBeHidden();
  const m = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: innerHeight }));
  expect(m.scroll).toBeLessThanOrEqual(m.inner);
  await expect(page.locator(".today-foot-done")).toBeInViewport();
});

// 75c: the phone.
test("412×760: the goal is fully visible on two lines, its count on its own line; the Next strip says how long", async ({ page }) => {
  await openToday(page, { width: 412, height: 760 }, { listOpen: false });
  const name = page.locator(".wall-goal-line-name");
  await expect(name).toBeVisible();
  expect(await name.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  const [n, f] = await Promise.all([name.boundingBox(), page.locator(".wall-goal-line-figures").boundingBox()]);
  expect(f.y).toBeGreaterThanOrEqual(n.y + n.height - 1);
  await expect(page.locator(".wall-mantra")).toBeVisible();
  await expect(page.locator(".wall-kicker-wide")).toBeVisible();
  await expect(page.locator(".wall-kicker-phone")).toBeHidden();
  await expect(page.locator(".wall-first-step")).toHaveCSS("border-top-style", "none");
  await expect(page.locator(".wall-peek-next-dur")).toHaveText("1H");
});

// Try-out D1: every page scales by the same rule, so the header and the
// page keep their size between tabs.
test("1903×940: Plan scales as Today does; the header keeps its size", async ({ page }) => {
  await openToday(page, { width: 1903, height: 940 });
  const todayHeader = await page.getByRole("banner").boundingBox();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.locator(".screen-content-plan")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.currentCSSZoom)).toBeCloseTo(S, 3);
  const planHeader = await page.getByRole("banner").boundingBox();
  expect(Math.abs(planHeader.height - todayHeader.height)).toBeLessThan(1);
  expect(planHeader.height).toBeCloseTo(64 * S, 0);
});

// The focus page scales too (try-out 33), and Today is the same size after Leave.
test("1903×940: the Focus page scales as Today does, and Today again after Leave", async ({ page }) => {
  await openToday(page, { width: 1903, height: 940 });
  const zoom = () => page.evaluate(() => document.documentElement.currentCSSZoom);
  expect(await zoom()).toBeCloseTo(S, 3);
  await page.locator(".today-wall .wall-primary").click();
  await expect(page.locator(".focus-mode-overlay")).toBeVisible();
  await expect.poll(zoom).toBeCloseTo(S, 3);
  await page.keyboard.press("Escape");
  await expect(page.locator(".focus-mode-overlay")).toHaveCount(0);
  await expect.poll(zoom).toBeCloseTo(S, 3);
});

// Codex review of #494: the screens before the app (here, sign-in) aren't
// scaled, on a window large enough for Today to be.
test("1903×940: the sign-in screen isn't scaled; Today is once the app opens", async ({ page }) => {
  await page.setViewportSize({ width: 1903, height: 940 });
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  expect(await page.evaluate(() => document.documentElement.currentCSSZoom)).toBe(1);
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".today-wall")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.currentCSSZoom)).toBeCloseTo(S, 3);
});

// Try-out 21/28: nothing on Today scrolls sideways — the list, its Day map
// view (whose now row bleeds past the rows) and the task panel — and the
// Day map's FROM YESTERDAY stays a small mono tag.
for (const viewport of [{ width: 1280, height: 720 }, { width: 1903, height: 940 }]) {
  test(`${viewport.width}×${viewport.height}: nothing on Today scrolls sideways`, async ({ page }) => {
    await openToday(page, viewport);
    expect(await sidewaysScrollers(page)).toEqual([]);
    await page.locator(".today-view-opt", { hasText: "Day map" }).click();
    await expect(page.locator(".today-daymap .tdm-stop").first()).toBeVisible();
    expect(await sidewaysScrollers(page)).toEqual([]);
    const tag = page.locator(".today-daymap .from-yesterday").first();
    await expect(tag).toBeVisible();
    const font = await tag.evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), family: getComputedStyle(el).fontFamily }));
    expect(font.size).toBeLessThanOrEqual(12);
    expect(font.family).toMatch(/Mono/);
    await page.locator(".today-view-opt", { hasText: "List" }).click();
    await page.locator(".today-list .task-title-text").first().click();
    await expect(page.getByTestId("task-detail")).toBeVisible();
    expect(await sidewaysScrollers(page)).toEqual([]);
  });
}
