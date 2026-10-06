import { test, expect } from "@playwright/test";
import { loadRealDay } from "./helpers/realDay";
import { openDayMapPage } from "./helpers/today";

// The Day map page (75f; README Turn 76 c–d) on a real day's list: the day
// ends at 02:00 and more is planned than fits.

async function openDayMap(page, viewport = { width: 1280, height: 720 }) {
  await loadRealDay(page);
  await page.addInitScript(() => { try { localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ } });
  await page.clock.setFixedTime(new Date("2026-10-05T15:15:00"));
  await page.setViewportSize(viewport);
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".today-wall")).toBeVisible({ timeout: 10_000 });
  await openDayMapPage(page);
}

// Turn 76 (d): "If today goes wrong" suggests only what fits before the day
// ends, judged on the minimum day itself: the optional tasks are what you'd
// drop. Dr. Keller sits behind GreenLoop (3h, optional) and past 02:00 on
// the route, but the two must-dos together fit in the time left, so both are
// suggested (Rohan's call on loopcheck #495).
test("If today goes wrong suggests the must-dos that fit once optional tasks are dropped", async ({ page }) => {
  await openDayMap(page);
  const min = page.getByRole("region", { name: "Minimum day" });
  await expect(min.locator(".dm-min-name")).toHaveText(["Internet contract: Renew it", "Dr. Keller: Reply to her URGENT!!"]);
  await expect(min.locator(".dm-min-title")).toHaveText("If today goes wrong, do these 2");
});

// Turn 76 (c): one cut for both pages — the same won't-fit count and total
// on the Day map as on Today, free time before the day end, no "over by".
test("the Day map and Today give the same won't-fit count and total; no 'over by'", async ({ page }) => {
  await openDayMap(page);
  const page75 = page.locator(".day-map-page");
  await expect(page75).not.toContainText("Over by");
  await expect(page75).not.toContainText("past your day end");
  const alert = (await page.locator(".dm-fact .dm-fact-alert").innerText()).trim();
  const m = /^(\d+) tasks? won’t fit · (\S+)\.$/.exec(alert);
  expect(m, alert).not.toBeNull();
  await page.locator(".dm-back").click();
  await expect(page.locator(".today-wontfit-line")).toContainText(`${m[1]} won’t fit · ${m[2]}`);
});
