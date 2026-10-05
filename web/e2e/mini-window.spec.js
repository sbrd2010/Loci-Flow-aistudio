import { test, expect } from "@playwright/test";

// The mini window (59b) follows its size while the timer runs, as the
// pre-59b pop-up did (#314): the ring and its digits scale with the window;
// too small for a ring, the time is one line with Pause and Done; smaller
// still, the time alone. Demo mode; a real Document Picture-in-Picture window.

async function openMiniWindow(page, context, beforeOpen) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  test.skip(!(await page.evaluate(() => "documentPictureInPicture" in window)), "no Document Picture-in-Picture");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await page.locator(".today-wall .wall-primary").click();
  await expect(page.locator(".focus-mode-overlay")).toBeVisible({ timeout: 10_000 });
  if (beforeOpen) await beforeOpen();
  const opened = context.waitForEvent("page");
  await page.keyboard.press("p");
  const pip = await opened;
  await expect(pip.locator("#pt")).toBeVisible();
  return pip;
}

const measure = (pip) => pip.evaluate(() => {
  const shown = (sel) => [...document.querySelectorAll(sel)].filter(e => getComputedStyle(e).display !== "none" && e.getClientRects().length > 0).length;
  return {
    ring: Math.round(document.getElementById("ring").getBoundingClientRect().width),
    svg: shown("#ring svg"),
    digits: parseFloat(getComputedStyle(document.getElementById("pt")).fontSize),
    title: shown("#pl"),
    buttons: shown("#pip-btns button"),
    fits: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth,
  };
});

test("the mini window's ring and time follow its size, down to the time alone", async ({ page, context }) => {
  const pip = await openMiniWindow(page, context);

  await pip.setViewportSize({ width: 360, height: 320 });
  const normal = await measure(pip);
  // The design's size at the default window: a 132 ring, the title, four buttons.
  expect(normal).toMatchObject({ ring: 132, svg: 1, title: 1, buttons: 4, fits: true });

  await pip.setViewportSize({ width: 480, height: 460 });
  const large = await measure(pip);
  expect(large.ring).toBeGreaterThan(normal.ring + 100);
  // The digits grow with the ring.
  expect(large.digits / normal.digits).toBeCloseTo(large.ring / normal.ring, 1);

  await pip.setViewportSize({ width: 300, height: 220 });
  expect(await measure(pip)).toMatchObject({ svg: 0, title: 0, buttons: 2, fits: true });
  await expect(pip.locator("#pip-play")).toBeVisible();
  await expect(pip.locator("#pip-done")).toBeVisible();

  await pip.setViewportSize({ width: 140, height: 60 });
  expect(await measure(pip)).toMatchObject({ svg: 0, title: 0, buttons: 0, fits: true });
  await expect(pip.locator("#pt")).toHaveText(/^\d+:\d{2}$/);

  // And back: the ring returns.
  await pip.setViewportSize({ width: 360, height: 320 });
  expect(await measure(pip)).toMatchObject({ ring: 132, svg: 1, buttons: 4 });
});

// Shuffle is back (Rohan, 5 Oct): shown only while a sound with variations
// plays, and it plays another variation of it, as the focus page's "Another".
test("the mini window's Shuffle shows with Rain, plays another rain, and hides with the sound off", async ({ page, context }) => {
  const overlay = page.locator(".focus-mode-overlay");
  const soundRow = overlay.getByRole("group", { name: "Sound" });
  const rainTracks = [];
  page.on("request", (r) => { if (/rain/i.test(r.url()) && /\.mp3/.test(r.url())) rainTracks.push(r.url()); });
  const pip = await openMiniWindow(page, context, async () => {
    await soundRow.getByRole("button", { name: /Rain/ }).click();
    await expect(soundRow.getByRole("button", { name: /Rain/ })).toHaveAttribute("aria-pressed", "true");
  });

  await pip.setViewportSize({ width: 360, height: 320 });
  const shuffle = pip.locator("#pip-shuffle");
  await expect(shuffle).toBeVisible();
  // Five buttons on one row, nothing cut off.
  expect(await measure(pip)).toMatchObject({ ring: 132, buttons: 5, fits: true });
  const clipped = await pip.evaluate(() => [...document.querySelectorAll("#pip-btns button")]
    .filter(b => b.offsetParent && b.scrollWidth > b.clientWidth).map(b => b.id));
  expect(clipped).toEqual([]);

  await expect.poll(() => rainTracks.length).toBeGreaterThan(0);
  const before = rainTracks.at(-1);
  await shuffle.click();
  await expect.poll(() => rainTracks.at(-1)).not.toBe(before);
  // Still Rain: Shuffle stays within the sound that's on.
  await expect(soundRow.getByRole("button", { name: /Rain/ })).toHaveAttribute("aria-pressed", "true");

  // Sound off: nothing to shuffle, so the button goes (on the next tick).
  await soundRow.getByRole("button", { name: "Off" }).click();
  await expect(shuffle).toBeHidden({ timeout: 3_000 });
  expect(await measure(pip)).toMatchObject({ buttons: 4 });
});
