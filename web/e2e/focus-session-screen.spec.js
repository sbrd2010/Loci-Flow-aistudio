import { test, expect } from "@playwright/test";

// Screen 3, the Focus session: "one task, one number, two exits."
//
// Unlike the ledger work in #382/#383, this screen IS observable in a browser
// — demo mode can open a real session — so these assert the rebuilt layout
// rather than settling for unit tests. Each one fails if the element it names
// is removed.

async function openSession(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  // install(), not setFixedTime(): these specs need the countdown to actually
  // advance, and a fixed clock pins Date.now() so the interval never moves.
  // The timer is anchored to wall-clock time via a deadline, so both the
  // timers and the clock have to be under the test's control.
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  const pinnedSection = page.locator(".today-wall");
  await pinnedSection.scrollIntoViewIfNeeded();
  await pinnedSection.locator(".wall-primary").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  return overlay;
}

test("mobile reliability: the session screen shows one task and one number", async ({ page }) => {
  const overlay = await openSession(page);

  // The task, not a ring, is the thing you read first.
  await expect(overlay.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText(/^\d+:\d{2}$/);
});

test("mobile reliability: the task sits above the number, not below it", async ({ page }) => {
  const overlay = await openSession(page);
  const title = await overlay.getByRole("heading", { level: 1 }).boundingBox();
  const digits = await overlay.locator(".focus-mode-time-digits").boundingBox();
  // The handoff's order — kicker, task, subtask, then the figure. The screen
  // read the other way round before this rebuild.
  expect(title.y).toBeLessThan(digits.y);
});

// 59a–c: the clock is a ring (248 on a phone) with the digits inside, and it
// reports what is done.
test("mobile reliability: progress is a ring around the digits, and it reports what is done", async ({ page }) => {
  const overlay = await openSession(page);
  const ring = overlay.getByRole("progressbar", { name: "Session progress" });
  await expect(ring).toBeVisible();
  const box = await ring.boundingBox();
  expect(Math.round(box.width)).toBe(248);
  const digits = await overlay.locator(".focus-mode-time-digits").boundingBox();
  expect(digits.x).toBeGreaterThan(box.x);
  expect(digits.x + digits.width).toBeLessThan(box.x + box.width);

  // What is done grows with elapsed time.
  const before = Number(await ring.getAttribute("aria-valuenow"));
  await page.clock.runFor(120_000);
  await expect.poll(async () => Number(await ring.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
});

test("mobile reliability: the session names its length and when it ends (45b)", async ({ page }) => {
  const overlay = await openSession(page);
  // Q37.1: "OF 25:00", then when it ends under it (the phone leaves STARTED out).
  await expect(overlay.locator(".fm-figures-of")).toHaveText(/^OF \d+:\d{2}$/);
  await expect(overlay.locator(".fm-figures-times")).toContainText(/ENDS \d{2}:\d{2}$/);
});

test("the block can be paused, resumed and given five more minutes, and the keys work", async ({ page }) => {
  const overlay = await openSession(page);
  const digits = overlay.locator(".focus-mode-time-digits");
  await page.clock.runFor(2_000);
  await overlay.getByRole("button", { name: "Pause timer" }).click();
  await expect(overlay.getByRole("button", { name: "Resume timer" })).toBeVisible();
  // A paused block has no end time to claim.
  await expect(overlay.locator(".focus-mode-figures")).not.toContainText("ENDS");
  // +5 min is for a running block (59a); paused, it is not offered (59g).
  await expect(overlay.getByRole("button", { name: "Add 5 minutes" })).toHaveCount(0);
  await overlay.getByRole("button", { name: "Resume timer" }).click();
  const before = await digits.innerText();
  await overlay.getByRole("button", { name: "Add 5 minutes" }).click();
  const [bm, bs] = before.split(":").map(Number);
  await expect(digits).toHaveText(`${bm + 5}:${String(bs).padStart(2, "0")}`);
  // The block itself is five minutes longer (the demo wall starts 25:00).
  await expect(overlay.locator(".focus-mode-figures")).toContainText("OF 30:00");
  await overlay.getByRole("button", { name: "Pause timer" }).click();
  // Space resumes; Esc leaves.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Space");
  await expect(overlay.getByRole("button", { name: "Pause timer" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});

test("mobile reliability: no ordinal is claimed when the ledger cannot be read", async ({ page }) => {
  const overlay = await openSession(page);
  // Demo mode has no uid, so useFocusLedger reports "unavailable" — the same
  // state as a refused or still-loading read. Showing "SESSION 1" there would
  // assert an ordinal to someone who may have done four already. The honest
  // answer to "I don't know" is to say nothing.
  await expect(overlay.locator(".focus-mode-session-count")).toHaveCount(0);
});

// 59i: block end. At 0:00 the screen asks what next — the break first — and
// nothing covers it. (Run to just past 25:00: at 26:00 the 60-second wait
// has already paused it.)
const BLOCK_OUT = 25 * 60_000 + 5_000;

test("mobile reliability: reaching 00:00 shows block end, with its choices and no modal", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(BLOCK_OUT);

  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("0:00");
  const end = overlay.getByRole("group", { name: "Block done" });
  await expect(end.locator(".fm-block-end-kicker")).toHaveText("BLOCK 1 DONE · SESSION 0:25");
  await expect(end.getByRole("button")).toHaveText([/^5-minute break, then continue/, "Another 25m", "+5 min", "Mark done", "End session"]);
  // Leaving without an answer isn't one of them.
  await expect(overlay.getByRole("button", { name: "Leave focus" })).toHaveCount(0);
  // The global completion dialog must not cover it.
  await expect(page.locator(".confirm-dialog, .modal-backdrop")).toHaveCount(0);
});

// The specs below CLICK the buttons rather than asserting they exist:
// presence is not behaviour.
test("mobile reliability: Another 25m actually restarts the timer", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(BLOCK_OUT);
  await overlay.getByRole("button", { name: "Another 25m" }).click();
  await expect(overlay.locator(".focus-mode-time-digits")).not.toHaveText("0:00");
  await expect(overlay.getByLabel("Pause timer")).toBeVisible();
  await expect(overlay.getByRole("group", { name: "Block done" })).toHaveCount(0);
});

// Q38.1: the break counts down, then asks — "Break's over" — and the next
// block is the last one's length, 5 minutes up or down.
test("the 5-minute break counts down, then asks; Enter starts the next block", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(BLOCK_OUT);
  await overlay.getByRole("button", { name: /^5-minute break, then continue/ }).click();
  await expect(overlay.getByRole("button", { name: "Skip the break" })).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText(/^[45]:\d{2}$/);
  // The break is not part of the block (Codex review of #433).
  await expect(overlay.locator(".fm-figures-of")).toHaveText("BREAK");
  await page.clock.runFor(5 * 60_000 + 2_000);
  await expect(overlay.getByRole("heading", { name: "Break’s over" })).toBeVisible();
  await expect(page).toHaveTitle("Break's over");
  const start = overlay.getByRole("button", { name: /^Start block 2 · 25m/ });
  await expect(start).toBeVisible();
  await overlay.getByRole("button", { name: "5 minutes longer" }).click();
  await expect(overlay.getByRole("button", { name: /^Start block 2 · 30m/ })).toBeVisible();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Enter");
  await expect(overlay.getByLabel("Pause timer")).toBeVisible();
  await expect(overlay.locator(".fm-figures-of")).toHaveText("OF 30:00");
  await expect(overlay.getByRole("group", { name: "Block done" })).toHaveCount(0);
});

test("Break's over, with no answer in 60 seconds, pauses on the next block", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(BLOCK_OUT);
  await overlay.getByRole("button", { name: /^5-minute break, then continue/ }).click();
  await page.clock.runFor(5 * 60_000 + 2_000);
  await expect(overlay.getByRole("heading", { name: "Break’s over" })).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(overlay.getByRole("group", { name: "Block done" })).toHaveCount(0);
  await expect(overlay.getByLabel("Resume timer")).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("25:00");
});

// Q38.2 / Q40.3: well over the estimate, a fact and one Re-estimate.
test("well over the estimate: the fact, then Re-estimate above the time spent", async ({ page }) => {
  // The estimate is set before the session starts.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await page.locator(".wall-title").click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: /^Estimate/ }).click();
  await sheet.getByRole("radio", { name: "15m" }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".today-wall .wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await page.clock.runFor(BLOCK_OUT);
  // 25m on a 15m task: half as much again, but only 10m past — no note.
  await expect(overlay.locator(".fm-over-note")).toHaveCount(0);
  await overlay.getByRole("button", { name: "Another 25m" }).click();
  await page.clock.runFor(25 * 60_000 + 2_000);
  await expect(overlay.locator(".fm-over-note")).toContainText("50m on this today, 35m past the 15m estimate.");
  await overlay.getByRole("button", { name: "Re-estimate" }).click();
  const row = overlay.getByRole("group", { name: "Re-estimate" });
  await expect(row.getByRole("button")).toHaveText(["1h", "1h30m", "2h", "3h"]);
  await row.getByRole("button", { name: "1h", exact: true }).click();
  await expect(overlay.locator(".fm-over-note")).toHaveCount(0);
  await expect(overlay.locator(".fm-stage-kicker")).toContainText("1H TASK");
});

test("with no answer in 60 seconds, block end pauses on a fresh block", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(BLOCK_OUT);
  await page.clock.runFor(61_000);
  await expect(overlay.getByRole("group", { name: "Block done" })).toHaveCount(0);
  await expect(overlay.getByLabel("Resume timer")).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("25:00");
});

test("mobile reliability: End session at block end asks, then ends it without a modal", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(BLOCK_OUT);
  await overlay.getByRole("group", { name: "Block done" }).getByRole("button", { name: "End session" }).click();
  await page.getByRole("dialog", { name: "End this session?" }).getByRole("button", { name: /^End session/ }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(".confirm-dialog, .modal-backdrop")).toHaveCount(0);
  await expect(page.getByText(/Focus block complete/i)).toHaveCount(0);
});

// 59g: paused — Resume, Mark done, End session, and a fresh block of a new
// length (5m · 25m · 50m · Whole task), which starts at once.
test("paused, a fresh block of a new length restarts the timer", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(2_000);
  await expect(overlay.getByRole("group", { name: "Restart with a new length" })).toHaveCount(0);
  await overlay.getByRole("button", { name: "Pause timer" }).click();
  await expect(overlay.getByRole("button", { name: /^End session/ })).toBeVisible();
  const chips = overlay.getByRole("group", { name: "Restart with a new length" });
  await expect(chips.getByRole("button")).toHaveText(["5m", "25m", "50m", "Whole task"]);
  await chips.getByRole("button", { name: "50m" }).click();
  await expect(overlay.locator(".focus-mode-figures")).toContainText("OF 50:00");
  await expect(overlay.getByRole("button", { name: "Pause timer" })).toBeVisible();
});

// 59h: End session asks first. The minutes are saved, the task stays open,
// and "Where did you stop?" becomes its next step.
test("End session asks, and where you stopped becomes the next step", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(60_000);
  await overlay.getByRole("button", { name: "Pause timer" }).click();
  await overlay.getByRole("button", { name: /^End session/ }).click();
  const ask = page.getByRole("dialog", { name: "End this session?" });
  await expect(ask).toContainText("The task stays open.");
  await ask.getByRole("button", { name: "Keep going" }).click();
  await expect(ask).toHaveCount(0);
  await expect(overlay).toBeVisible();

  await overlay.getByRole("button", { name: /^End session/ }).click();
  await ask.getByRole("textbox", { name: /Where did you stop/ }).fill("Draft the second paragraph");
  await ask.getByRole("textbox", { name: /Where did you stop/ }).press("Enter");
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(".wall-first-step-text")).toContainText("Next step — Draft the second paragraph");
});

test("a held Space toggles the timer once, not on every repeat", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(2_000);
  await page.evaluate(() => document.activeElement?.blur());
  // One press and one auto-repeat: toggled twice, it would be running again.
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await expect(overlay.getByRole("button", { name: "Resume timer" })).toBeVisible();
});

test("Escape closes the sounds drawer even from its volume slider", async ({ page }) => {
  const overlay = await openSession(page);
  await overlay.getByRole("button", { name: "Open sounds menu" }).click();
  const drawer = page.locator(".focus-sounds-drawer");
  await expect(drawer).toHaveClass(/open/);
  await page.getByRole("slider", { name: "Adjust volume" }).focus();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toHaveClass(/open/);
  await expect(overlay).toBeVisible();
});

test("with I'm stuck open, D is not the session's and Esc goes back to the timer", async ({ page }) => {
  const overlay = await openSession(page);
  const title = await overlay.getByRole("heading", { level: 1 }).innerText();
  await overlay.getByRole("button", { name: "I'm stuck" }).click();
  const sheet = page.getByRole("dialog", { name: "Stuck?" });
  await expect(sheet).toBeVisible({ timeout: 5_000 });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("d");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // Still in the same session, running again, and the task is not done.
  await expect(overlay.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(overlay.getByLabel("Pause timer")).toBeVisible();
});

// 59c: the quick Sound row — Off · Rain · the last one used — and every
// sound still under "All sounds…".
test("the quick Sound row picks Rain and Off, and remembers the last sound used", async ({ page }) => {
  const overlay = await openSession(page);
  const row = overlay.getByRole("group", { name: "Sound" });
  await expect(row.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await overlay.getByRole("button", { name: "Open sounds menu" }).click();
  const drawer = page.locator(".focus-sounds-drawer");
  await expect(drawer.locator(".sound-tile")).toHaveCount(8);
  await drawer.getByRole("button", { name: /Jazz Lounge/ }).click();
  await drawer.getByRole("button", { name: "Close sounds menu" }).click();
  await expect(row.getByRole("button", { name: "Jazz Lounge" })).toHaveAttribute("aria-pressed", "true");
  await row.getByRole("button", { name: /Rain/ }).click();
  await expect(row.getByRole("button", { name: /Rain/ })).toHaveAttribute("aria-pressed", "true");
  // The last one used before Rain stays offered.
  await expect(row.getByRole("button", { name: "Jazz Lounge" })).toBeVisible();
  await row.getByRole("button", { name: "Off" }).click();
  await expect(row.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
});
