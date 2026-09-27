import { test, expect } from "@playwright/test";

// Plan (45h–j): Horizons | Fronts, the horizons as sections — one column on
// a phone, two on a tablet, four on a laptop — and the Day map reached from
// Today only (turn 50: "Plan is Horizons | Fronts, and that is final").

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

test("Plan opens on Horizons, switches to Fronts, and has no Day map door", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
  const horizons = page.getByRole("tab", { name: "Horizons" });
  const fronts = page.getByRole("tab", { name: "Fronts" });
  await expect(horizons).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /^This week/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /day map/i })).toHaveCount(0);

  await fronts.click();
  await expect(fronts).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "New front" })).toBeVisible();
  // Arrow keys move between the two, as in any tab list.
  await fronts.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(horizons).toHaveAttribute("aria-selected", "true");
  await expect(horizons).toBeFocused();

  // Today is the one door into the Day map, and Back returns there.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Day map →" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.locator(".dm-back").click();
  await expect(page.getByRole("button", { name: "Day map →" })).toBeVisible();
});

test("Horizons: one column on a phone, two on a tablet, four on a laptop (45h–j)", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const columns = async () => page.locator(".plan-horizon").evaluateAll(els =>
    new Set(els.slice(0, 4).map(el => Math.round(el.getBoundingClientRect().left))).size);
  await expect.poll(columns).toBe(1);
  await page.setViewportSize({ width: 900, height: 1200 });
  await expect.poll(columns).toBe(2);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(columns).toBe(4);
});

test("priority tags are mono wherever Day Map draws them", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Day map →" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();

  // Day Map draws a priority tag in two places: in the unscheduled strip, and
  // on a route card. An earlier pass styled only the card — the selector was
  // scoped to the route card — so the strip kept painting red, amber, teal and blue
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

  const stripColor = await mono(page.locator(".dm-unscheduled .dm-p"), "unscheduled strip");

  await page.getByRole("button", { name: /auto-fill/i }).click();
  await expect(page.locator(".dm-stop .dm-p:visible").first()).toBeVisible();
  const cardColor = await mono(page.locator(".dm-stop .dm-p:visible"), "route card");

  // One declaration site means one colour; two means they can drift apart.
  expect(cardColor).toBe(stripColor);
});

test("Horizons: each horizon's + and each row's circle are 44px targets", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  for (const name of ["This week", "This month", "This quarter", "6 months"]) {
    const box = await page.getByRole("button", { name: `Add a task to ${name}` }).boundingBox();
    expect(Math.round(box.width), name).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height), name).toBeGreaterThanOrEqual(44);
  }
  const circle = await page.locator(".plan-row-circle").first().boundingBox();
  expect(Math.round(circle.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(circle.height)).toBeGreaterThanOrEqual(44);

  // + opens Add task on that horizon (45a).
  await page.getByRole("button", { name: "Add a task to This quarter" }).click();
  await expect(page.getByTestId("add-task-submit")).toHaveText("Add to This quarter");
});

test("Horizons: the circle marks a task done; Work shows only when it holds tasks", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const week = page.locator(".plan-horizon", { has: page.getByRole("heading", { name: /^This week/ }) });
  const rows = week.locator(".plan-row");
  const before = await rows.count();
  const title = (await rows.first().locator(".plan-row-title").innerText()).trim();
  await rows.first().getByRole("button", { name: `Mark done: ${title}` }).click();
  await expect(rows).toHaveCount(before - 1);
  await expect(week.getByRole("heading", { name: /^This week/ })).toContainText(String(before - 1));
  // The demo has no Work tasks, so there is no Work section to scroll past.
  await expect(page.getByRole("heading", { name: /^Work/ })).toHaveCount(0);
});

test("Mind Box's notes link lands on Plan's Inbox", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Mind Box", exact: true }).click();
  await page.getByTestId("brain-dump-inbox-btn").click();
  await expect(page.getByRole("tab", { name: "Horizons" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /^Inbox/ })).toBeInViewport();
});
