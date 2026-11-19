import { test, expect } from "@playwright/test";

// The mini window (design 77 C2 "Ring", #508) follows its size while the
// timer runs, as the pre-59b pop-up did (#314): the ring is the window
// (diameter = window − 28) and its digits scale with it; under 180 px the time
// is one line with Pause and Done; smaller still, the time alone. Demo mode;
// a real Document Picture-in-Picture window.

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
    svg: shown("#ring > svg"),
    digits: parseFloat(getComputedStyle(document.getElementById("pt")).fontSize),
    title: shown("#pl"),
    buttons: shown("#pip-btns button"),
    fits: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth,
  };
});

test("the mini window's ring and time follow its size, down to the time alone", async ({ page, context }) => {
  const pip = await openMiniWindow(page, context);

  await pip.setViewportSize({ width: 320, height: 320 });
  const normal = await measure(pip);
  // 77-c2 at 320: a 292 ring, the title inside it, Pause · +5 · Done · ⋯.
  expect(normal).toMatchObject({ ring: 292, svg: 1, title: 1, buttons: 4, fits: true });

  await pip.setViewportSize({ width: 480, height: 460 });
  const large = await measure(pip);
  expect(large.ring).toBe(432);
  // The digits grow with the ring.
  expect(large.digits / normal.digits).toBeCloseTo(large.ring / normal.ring, 1);

  // 220: still a ring, no title; the row is Pause · Done · ⋯.
  await pip.setViewportSize({ width: 220, height: 220 });
  expect(await measure(pip)).toMatchObject({ ring: 192, svg: 1, title: 0, buttons: 3, fits: true });

  await pip.setViewportSize({ width: 300, height: 160 });
  expect(await measure(pip)).toMatchObject({ svg: 0, title: 0, buttons: 2, fits: true });
  await expect(pip.locator("#pip-play")).toBeVisible();
  await expect(pip.locator("#pip-done")).toBeVisible();

  await pip.setViewportSize({ width: 140, height: 60 });
  expect(await measure(pip)).toMatchObject({ svg: 0, title: 0, buttons: 0, fits: true });
  await expect(pip.locator("#pt")).toHaveText(/^\d+:\d{2}$/);

  // And back: the ring returns.
  await pip.setViewportSize({ width: 320, height: 320 });
  expect(await measure(pip)).toMatchObject({ ring: 292, svg: 1, buttons: 4 });
});

// Shuffle is back (Rohan, 5 Oct): shown only while a sound with variations
// plays, and it plays another variation of it, as the focus page's "Shuffle".
test("the mini window's Shuffle shows with Rain, plays another rain, and hides with the sound off", async ({ page, context }) => {
  const overlay = page.locator(".focus-mode-overlay");
  const soundRow = overlay.getByRole("group", { name: "Sound" });
  const rainTracks = [];
  page.on("request", (r) => { if (/rain/i.test(r.url()) && /\.mp3/.test(r.url())) rainTracks.push(r.url()); });
  const pip = await openMiniWindow(page, context, async () => {
    await soundRow.getByRole("button", { name: /Rain/ }).click();
    await expect(soundRow.getByRole("button", { name: /Rain/ })).toHaveAttribute("aria-pressed", "true");
  });

  // From 400 wide the row has Shuffle: Pause · +5 · Shuffle · Done · ⋯.
  await pip.setViewportSize({ width: 400, height: 400 });
  const shuffle = pip.locator("#pip-shuffle");
  await expect(shuffle).toBeVisible();
  expect(await measure(pip)).toMatchObject({ ring: 372, buttons: 5, fits: true });
  const clipped = await pip.evaluate(() => [...document.querySelectorAll("#pip-btns button")]
    .filter(b => b.offsetParent && b.scrollWidth > b.clientWidth).map(b => b.id));
  expect(clipped).toEqual([]);

  await expect.poll(() => rainTracks.length).toBeGreaterThan(0);
  const before = rainTracks.at(-1);
  await pip.locator("#ring").hover();
  await shuffle.click();
  await expect.poll(() => rainTracks.at(-1)).not.toBe(before);
  // Round icons, 40 px; "Shuffle sound", tooltip with its key; S shuffles
  // too; under 400 wide Shuffle moves to ⋯, the rest stay.
  await expect(shuffle).toHaveAttribute("aria-label", "Shuffle sound");
  await expect(shuffle).toHaveAttribute("title", "Another track · S");
  // While Rain plays, the running label names it.
  await expect(pip.locator("#pp")).toHaveText("Rain");
  expect(await pip.evaluate(() => [...document.querySelectorAll("#pip-btns button")].filter(b => b.offsetParent).every(b => Math.round(b.getBoundingClientRect().height) === 40))).toBe(true);
  const afterClick = rainTracks.at(-1);
  await pip.keyboard.press("s");
  await expect.poll(() => rainTracks.at(-1)).not.toBe(afterClick);
  await pip.setViewportSize({ width: 399, height: 399 });
  await expect(shuffle).toBeHidden();
  expect(await measure(pip)).toMatchObject({ buttons: 4, fits: true });
  await pip.locator("#pip-more").click();
  await expect(pip.locator("#pip-menu-shuffle")).toBeVisible();
  await pip.keyboard.press("Escape");
  await expect(pip.locator("#pip-menu")).toBeHidden();
  await pip.setViewportSize({ width: 400, height: 400 });
  await expect(shuffle).toBeVisible();
  // Still Rain: Shuffle stays within the sound that's on.
  await expect(soundRow.getByRole("button", { name: /Rain/ })).toHaveAttribute("aria-pressed", "true");

  // Sound off: nothing to shuffle, so the button goes (on the next tick).
  await soundRow.getByRole("button", { name: "Off" }).click();
  await expect(shuffle).toBeHidden({ timeout: 3_000 });
  expect(await measure(pip)).toMatchObject({ buttons: 4 });
});

// Try-out 35: the clock pauses and resumes at every size (the Pause button
// is gone in the smallest), and so does Space; a paused clock dims, says
// Paused and offers Resume (77-c4). Try-out 38: the title opens Loci's tab
// and the window stays.
test("the mini window's clock pauses and resumes at any size; its title leaves it open", async ({ page, context }) => {
  const pip = await openMiniWindow(page, context);
  const paused = () => pip.evaluate(() => document.body.classList.contains("is-paused"));

  await pip.setViewportSize({ width: 320, height: 320 });
  // No sound on: no running label.
  await expect(pip.locator("#pp")).toBeHidden();
  await pip.locator("#ring").click();
  await expect.poll(paused).toBe(true);
  await expect(pip.locator("#pp")).toHaveText("Paused");
  await expect(pip.locator("#pp")).toBeVisible();
  await expect(pip.locator("#pip-play")).toHaveAttribute("aria-label", "Resume");
  await expect(pip.locator("#ring")).toHaveAttribute("aria-label", "Resume the timer");
  // Paused: the ring steps up for Resume under it (− 92), and Resume resumes.
  expect(await measure(pip)).toMatchObject({ ring: 228, fits: true });
  await pip.locator("#pip-resume").click();
  await expect.poll(paused).toBe(false);

  // The time alone: no buttons, the clock still pauses, and says so.
  await pip.setViewportSize({ width: 140, height: 60 });
  await expect(pip.locator("#pip-play")).toBeHidden();
  await pip.locator("#pt").click();
  await expect.poll(paused).toBe(true);
  await expect(pip.locator("#pp")).toBeVisible();
  expect(await pip.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await pip.keyboard.press("Space");
  await expect.poll(paused).toBe(false);

  await pip.setViewportSize({ width: 320, height: 320 });
  await expect(pip.locator("#pl")).toHaveAttribute("title", /Open Loci/);
  await pip.locator("#pl").click();
  await page.waitForTimeout(300);
  expect(pip.isClosed()).toBe(false);
  await expect(pip.locator("#pt")).toBeVisible();
});

// #508 (77-c4, c5): dark by default whatever the app's theme, ⋯ switches it
// for this device; the last five minutes count down; block end closes the
// ring and offers Next block and Done task, and Next block starts one.
test("the mini window: dark by default with a theme switch, the last 5 minutes, and block end", async ({ page, context }) => {
  await page.clock.install({ time: new Date("2026-11-14T10:00:00") });
  const pip = await openMiniWindow(page, context);
  await pip.setViewportSize({ width: 320, height: 320 });
  const light = () => pip.evaluate(() => document.body.classList.contains("is-light"));
  expect(await light()).toBe(false);
  await pip.locator("#ring").hover();
  await pip.locator("#pip-more").click();
  await pip.locator("#pip-menu-theme").click();
  expect(await light()).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("loci_mini_theme"))).toBe("light");

  // The last five minutes: the label counts down in whole minutes.
  const total = await pip.evaluate(() => {
    const [m, s] = document.getElementById("pt").textContent.split(":").map(Number);
    return m * 60 + s;
  });
  await page.clock.runFor((total - 221) * 1000);
  await expect(pip.locator("#pp")).toHaveText("4 min left");
  expect(await pip.evaluate(() => document.body.classList.contains("is-late"))).toBe(true);

  // Block end: a full ring, "Block done", Next block and Done task.
  await page.clock.runFor(225 * 1000);
  await expect(pip.locator("#pp")).toHaveText("Block done");
  await expect(pip.locator("#pip-next")).toBeVisible();
  await expect(pip.locator("#pip-cta-done")).toBeVisible();
  await expect(pip.locator("#pip-resume")).toBeHidden();
  await pip.locator("#pip-next").click();
  await expect.poll(() => pip.evaluate(() => document.body.classList.contains("is-running"))).toBe(true);
  await expect(pip.locator("#pip-next")).toBeHidden();
});
