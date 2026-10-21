import { test, expect } from "@playwright/test";
import { loadRealDay } from "./helpers/realDay";

// Plan 76 (PART12, turn 77): a readable runway and horizon cards, on 76a's
// six horizons (Career, This week, This month, Work, This quarter, 6 months).

async function openPlan(page, [w, h], { at = "2026-10-05T15:15:00", extra = null } = {}) {
  await loadRealDay(page, { plan: true });
  await page.addInitScript((more) => {
    try { localStorage.setItem("loci_plan_rung", "career"); } catch { /* private mode */ }
    if (more) {
      const make = window.__LOCI_DEMO_FIXTURE__;
      window.__LOCI_DEMO_FIXTURE__ = () => { const p = make(); p.config.horizons[more.id] = more; return p; };
    }
  }, extra);
  await page.clock.setFixedTime(new Date(at));
  await page.setViewportSize({ width: w, height: h });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".today-wall")).toBeVisible({ timeout: 15_000 });
  if (w >= 1024) await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  else await page.locator(".tab-bar").getByRole("button", { name: /Plan/ }).click();
  await page.evaluate(() => document.querySelector('[data-testid="demo-banner"]')?.remove());
  await expect(page.locator(".plan-rung")).toHaveCount(extra ? 7 : 6);
  await page.evaluate(() => document.fonts.ready);
}

// Every label's two lines, as drawn: none within 12px of another (76).
const labelOverlaps = (page) => page.evaluate(() => {
  const boxes = [...document.querySelectorAll(".plan-runway-label")].map(l => {
    const rs = [...l.querySelectorAll(".plan-runway-name > *, .plan-runway-name, .plan-runway-date")].map(e => {
      const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect();
    });
    return { text: l.innerText.replace(/\s+/g, " "), left: Math.min(...rs.map(r => r.left)), right: Math.max(...rs.map(r => r.right)) };
  });
  const bad = [];
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i]; const b = boxes[j];
    if (a.left < b.right + 11 && b.left < a.right + 11) bad.push(`${a.text} ⟷ ${b.text}`);
  }
  return bad;
});

for (const size of [[1903, 940], [1280, 720], [900, 1200], [412, 760]]) {
  test(`runway labels never collide at ${size[0]}×${size[1]}`, async ({ page }) => {
    await openPlan(page, size);
    const runway = page.getByRole("group", { name: "Runway" });
    await expect(runway.locator(".plan-runway-label.is-today")).toContainText("TodayMON 5 OCT");
    await expect(runway.locator(".plan-runway-label").last()).toContainText("6 months30 APR 2027");
    expect(await labelOverlaps(page)).toEqual([]);
    // A tick whose label was dropped tells its name on hover or focus.
    for (const tick of await runway.locator(".plan-runway-tick[data-tip]").all()) {
      await expect(tick).toHaveAttribute("tabindex", "0");
      await expect(tick).toHaveAttribute("data-tip", /^.+ · \d+(–\d+)? [A-Z]{3}/);
    }
  });
}

test("laptop and 24″: all six cards on screen, the page doesn't scroll", async ({ page }) => {
  for (const size of [[1280, 720], [1903, 940]]) {
    await openPlan(page, size);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    const last = await page.locator(".plan-rung").last().boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(size[1]);
    // The open card: 2px green edge; the others none of it, and no chevron row.
    await expect(page.locator(".plan-rung.is-open")).toHaveAttribute("data-horizon", "career");
    await expect(page.locator(".plan-rung-chevron").first()).toBeHidden();
  }
});

// Seven cards still fit at 1280×720; on a shorter window the cards that
// don't fit scroll in their own column, and the page stays put.
test("cards that don't fit scroll in their own column; the page doesn't", async ({ page }) => {
  await openPlan(page, [1280, 600], { extra: { id: "thesis", name: "Thesis", kind: "custom", startDate: "2026-09-01", lengthDays: 120 } });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  const ladder = page.locator(".plan-ladder");
  expect(await ladder.evaluate(el => el.scrollHeight > el.clientHeight + 1)).toBe(true);
  await page.locator(".plan-rung").last().scrollIntoViewIfNeeded();
  await expect(page.locator(".plan-rung").last()).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("the runway: √ scale, the open stretch, and a name opens its horizon", async ({ page }) => {
  await openPlan(page, [1280, 720]);
  const runway = page.getByRole("group", { name: "Runway" });
  // 31 Dec is 87 of 207 days out: √ puts it at 65% (linear would be 42%).
  const quarter = await runway.getByRole("button", { name: /^Open This quarter/ }).evaluate(el => parseFloat(el.style.left));
  expect(quarter).toBeCloseTo(Math.sqrt(87 / 207) * 100, 1);
  // The open horizon's stretch runs from today to its tick, in green.
  const stretch = await runway.locator(".plan-runway-stretch").evaluate(el => parseFloat(el.style.width));
  expect(stretch).toBeCloseTo(Math.sqrt(5 / 207) * 100, 1);
  await runway.getByRole("button", { name: "This quarter", exact: true }).click();
  await expect(page.locator(".plan-rung[aria-current='true']")).toHaveAttribute("data-horizon", "quarter");
  await expect(page.locator(".plan-open").getByRole("heading", { name: "This quarter" })).toBeVisible();
  await expect(runway.locator(".plan-runway-label.is-open")).toContainText("This quarter");
});

test("at ≤3 days left the end, the days left and the bar turn red", async ({ page }) => {
  await openPlan(page, [1280, 720], { at: "2026-10-08T15:15:00", extra: { id: "sprint", name: "Sprint", kind: "custom", startDate: "2026-10-01", lengthDays: 10 } });
  const career = page.locator(".plan-rung[data-horizon='sprint']");
  await expect(career).toHaveClass(/is-red/);
  await expect(career.locator(".plan-rung-left")).toHaveText("2 DAYS LEFT");
  const red = await career.locator(".plan-rung-left").evaluate(el => getComputedStyle(el).color);
  expect(red).toBe("rgb(154, 59, 38)");
  // 6 months slides: no end, no bar.
  const half = page.locator(".plan-rung[data-horizon='halfyear']");
  await expect(half.locator(".plan-rung-left")).toHaveText("SLIDES MONTHLY");
  await expect(half.locator(".plan-rung-bar")).toHaveCount(0);
});

test("phone: Today and the furthest end only; no card open; chevrons", async ({ page }) => {
  await openPlan(page, [412, 760]);
  await expect(page.locator(".plan-runway-label")).toHaveCount(2);
  await expect(page.locator(".plan-runway-stretch")).toHaveCount(0);
  await expect(page.locator(".plan-rung.is-open")).toHaveCount(0);
  await expect(page.locator(".plan-rung-chevron").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
