import { test, expect } from "@playwright/test";

// Screen 1 — the wall and the desk.
//
// Deliberately does NOT seed loci_today_peek_open, unlike every other spec:
// this one is about the default, and the default is the wall. If it ever seeds
// the peek open, it stops testing the thing it exists for.

async function enterDemo(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

test("mobile reliability: Today opens on the wall, with the list put away", async ({ page }) => {
  await enterDemo(page);

  // The commitment is the dominant element and IS the start control.
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".wall-title.is-wall")).toBeVisible();
  await expect(page.getByText("tap anywhere to begin")).toBeVisible();

  // No second filled primary competing with it.
  await expect(page.locator(".wall-primary")).toHaveCount(0);

  // The list is genuinely gone, not merely scrolled past. This asserts the
  // computed style because the section carries an INLINE display, and a class
  // rule cannot override one — an earlier attempt toggled a class, looked
  // correct, and hid nothing.
  const display = await page.locator(".tasks-section").evaluate(el => getComputedStyle(el).display);
  expect(display).toBe("none");
});

test("mobile reliability: the peek opens the desk and closes back to the wall", async ({ page }) => {
  await enterDemo(page);

  await page.locator(".wall-peek").click();

  // The hero stops being a button; an explicit primary appears instead.
  await expect(page.locator(".wall-hero")).toHaveCount(0);
  await expect(page.locator(".wall-title.is-desk")).toBeVisible();
  await expect(page.locator(".wall-primary")).toBeVisible();
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.locator(".wall-peek-label")).toContainText(/AFTER THAT/);

  // Two-way: the toggle is a button in both states, so you can always get back.
  await page.locator(".wall-peek").click();
  await expect(page.locator(".wall-hero")).toBeVisible();
  const display = await page.locator(".tasks-section").evaluate(el => getComputedStyle(el).display);
  expect(display).toBe("none");
});

test("mobile reliability: the peek state survives a reload", async ({ page }) => {
  await enterDemo(page);
  await page.locator(".wall-peek").click();
  await expect(page.locator(".wall-title.is-desk")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  // peekOpen is persisted to localStorage, per the handoff.
  await expect(page.locator(".wall-title.is-desk")).toBeVisible({ timeout: 10_000 });
});

test("mobile reliability: tapping the wall starts a focus session on the commitment", async ({ page }) => {
  await enterDemo(page);

  const title = (await page.locator(".wall-title.is-wall").innerText()).trim();
  await page.locator(".wall-hero").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay.getByRole("heading", { name: title })).toBeVisible();
});

test("mobile reliability: a deadline a year out is not painted as time pressure", async ({ page }) => {
  await enterDemo(page);

  // Clay is the one alert colour and the design reserves it for real pressure.
  // The demo's deadline is ~365 days away, so the figure shows but stays quiet.
  const days = page.locator(".wall-head-days");
  await expect(days).toBeVisible();
  await expect(days).not.toHaveClass(/is-pressing/);
});

// ── Fixes for the Codex review on PR #380 ─────────────────────────────────
// Each of these asserts a control does what its label says. All three were
// controls that rendered correctly and did the wrong thing (or nothing) —
// the same class of defect as the peek that hid nothing.

async function enterDemoWithPeek(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await enterDemo(page);
}

test("mobile reliability: Low Energy's smaller start actually starts five minutes", async ({ page }) => {
  await enterDemoWithPeek(page);

  await page.locator("button.stuck-btn", { hasText: "Low Energy" }).click();

  const smaller = page.locator(".wall-action", { hasText: "Start small — 5 minutes" });
  await expect(smaller).toBeVisible({ timeout: 8_000 });
  await smaller.click();

  // A focus session, at five minutes — not the task editor, and not the
  // task's own 25-minute estimate.
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  // The five-minute session presents as one (528db2f) — and the figure is 5:00,
  // not the task's own 25:00.
  await expect(overlay.getByText("FIVE MINUTES", { exact: false })).toBeVisible();
  await expect(overlay.getByText(/\b5:00\b/)).toBeVisible();
});

test("mobile reliability: the scattered door on the desk reaches screen 14", async ({ page }) => {
  await enterDemoWithPeek(page);

  const door = page.locator(".wall-scattered-link");
  await expect(door).toBeVisible({ timeout: 8_000 });
  await door.click();

  await expect(page.locator(".scattered")).toBeVisible({ timeout: 8_000 });
});

// A fix to a fix: the handler was corrected, but startFocusAndLog's
// existing-session branch returned before applying the length — so with a
// session already open the button still promised five minutes and resumed
// twenty-five.
test("mobile reliability: five minutes is honoured even with a session already open", async ({ page }) => {
  await enterDemoWithPeek(page);

  // Start the ordinary session, then back out of the overlay leaving it running.
  await page.locator(".wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay.getByText(/\b25:00\b/)).toBeVisible();
  await overlay.locator(".focus-mode-exit-btn").click();
  await expect(overlay).toHaveCount(0);

  await page.locator("button.stuck-btn", { hasText: "Low Energy" }).click();
  await page.locator(".wall-action", { hasText: "Start small — 5 minutes" }).click();

  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(overlay.getByText(/\b5:00\b/)).toBeVisible();
  await expect(overlay.getByText(/\b25:00\b/)).toHaveCount(0);
});

// ── J2a / Addendum K1: the empty wall ─────────────────────────────────────
// The field creates a task, because the thing you commit to may not exist in
// the app yet — without that, first launch has no exit.

// Reaching the empty wall means having no commitment AND none finished today
// — completing one gives the done state (J2b), which stands for the rest of
// the day. So this unpins instead, from the pinned row's own menu.
async function emptyTheWall(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await enterDemo(page);
  const pinned = page.locator(".pinned-focus-section .task-row").first();
  await expect(pinned).toBeVisible({ timeout: 10_000 });
  await pinned.locator(".task-row-top").click();
  await page.getByText("Unpin from Focus").click();
  await expect(page.locator(".wall-commit-field")).toBeVisible({ timeout: 8_000 });
}

test("mobile reliability: typing on the empty wall creates and commits a task", async ({ page }) => {
  await emptyTheWall(page);

  const commit = page.locator(".wall-commit-btn");
  // Screen 10's button survives (K1), disabled until there is text.
  await expect(commit).toBeDisabled();

  await page.locator(".wall-commit-field").fill("Write the membrane paper intro");
  await expect(commit).toBeEnabled();
  await commit.click();

  // It becomes the commitment: the wall stops asking and the task IS the hero.
  await expect(page.locator(".wall-commit-field")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toContainText("Write the membrane paper intro");

  // The task is created with the canonical "Personal" category and NO
  // estimate, so no duration is rendered for it as if the user had chosen one.
  await expect(page.locator(".wall-title")).not.toContainText("25m");
  // K1: no front, so the kicker carries only the fixed words — no front name.
  await expect(page.locator(".wall-kicker")).toHaveText("YOU COMMITTED TO");
  // And no subtask: concreteStep is OMITTED rather than set empty, so
  // normalizePayload does not substitute its "Do first tiny step" default.
  await expect(page.locator(".wall-support")).toHaveCount(0);
});

test("mobile reliability: Enter commits, without touching the button", async ({ page }) => {
  await emptyTheWall(page);

  await page.locator(".wall-commit-field").fill("Reply to the supervisor");
  await page.locator(".wall-commit-field").press("Enter");

  await expect(page.locator(".wall-title")).toContainText("Reply to the supervisor");
});

test("mobile reliability: the pick rows narrow as you type, and tapping one commits it", async ({ page }) => {
  await emptyTheWall(page);

  // Unfiltered, the rows show today's open items.
  const rows = page.locator(".wall-pick-row");
  await expect(rows.first()).toBeVisible({ timeout: 8_000 });
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);

  const firstTitle = (await rows.first().locator(".wall-pick-title").innerText()).trim();

  // Typing part of an existing title narrows to it, so the near-duplicate is
  // visible before a second copy is created.
  await page.locator(".wall-commit-field").fill(firstTitle.slice(0, 12));
  await expect(rows.first()).toContainText(firstTitle.slice(0, 12));

  await rows.first().click();

  // The existing task is committed — not a new one created from the typed text.
  await expect(page.locator(".wall-title")).toContainText(firstTitle);
  await expect(page.locator(".wall-commit-field")).toHaveCount(0);
});

// ── J2b / Addendum K2, K3: the commitment, finished ───────────────────────

test("mobile reliability: finishing the commitment gives the done state, not the empty wall", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  const title = (await page.locator(".wall-title.is-wall").innerText()).trim();

  await page.locator(".wall-action", { hasText: "Mark done" }).click();

  // The closing line is the hero; the finished title is struck above it.
  await expect(page.locator(".wall-done-line")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".wall-done-was")).toContainText(title);
  // K2: no session was run, so zero minutes — the line is a bare "Done.",
  // never "0m logged".
  await expect(page.locator(".wall-done-line")).toHaveText("Done.");
  // And NOT the empty wall's field, which would be asking the question again.
  await expect(page.locator(".wall-commit-field")).toHaveCount(0);
});

test("mobile reliability: the proposal never auto-commits, and Not now holds", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  await page.locator(".wall-action", { hasText: "Mark done" }).click();

  const proposal = page.locator(".wall-proposal");
  await expect(proposal).toBeVisible({ timeout: 8_000 });
  await expect(proposal.locator(".wall-proposal-kicker")).toHaveText("NEXT, IF YOU WANT");

  // Nothing is committed until the user says so: the done line still stands.
  await expect(page.locator(".wall-done-line")).toBeVisible();

  await proposal.locator(".wall-proposal-not-now").click();

  // K3: "Not now" leaves the done state standing, and does not propose
  // something else in its place.
  await expect(page.locator(".wall-proposal")).toHaveCount(0);
  await expect(page.locator(".wall-done-line")).toBeVisible();
});

test("mobile reliability: Commit to this makes the proposal the new commitment", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  await page.locator(".wall-action", { hasText: "Mark done" }).click();

  const proposal = page.locator(".wall-proposal");
  await expect(proposal).toBeVisible({ timeout: 8_000 });
  const next = (await proposal.locator(".wall-proposal-title").innerText()).trim();

  await proposal.locator(".wall-proposal-commit").click();

  await expect(page.locator(".wall-title.is-wall")).toContainText(next, { timeout: 8_000 });
});

// ── J4: Momentum ─────────────────────────────────────────────────────────
// Demo mode has no uid, so the ledger is unreadable and there is no history.
// That is exactly the case the design is strictest about: nothing renders. An
// empty frame is a scoreboard of what you haven't done.

test("mobile reliability: Momentum does not render an empty frame", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });

  await expect(page.locator(".momentum")).toHaveCount(0);
  await expect(page.locator(".momentum-bar")).toHaveCount(0);
});

// The wall asks the question itself, so the legacy first-run panel must not
// render beneath it — two competing creation flows on first launch is the
// screen this redesign exists to remove.
test("mobile reliability: the empty wall does not compete with the old onboarding panel", async ({ page }) => {
  await emptyTheWall(page);

  await expect(page.locator(".wall-commit-field")).toBeVisible();
  await expect(page.getByText("tap + to add your first task", { exact: false })).toHaveCount(0);
});

// TodayWall stays mounted, so a query left in the field reappears if the
// chosen task is ever unpinned — and an accidental submit then creates
// exactly the duplicate the pick rows exist to prevent.
test("mobile reliability: picking an existing task clears the typed query", async ({ page }) => {
  await emptyTheWall(page);

  const rows = page.locator(".wall-pick-row");
  await expect(rows.first()).toBeVisible({ timeout: 8_000 });
  const firstTitle = (await rows.first().locator(".wall-pick-title").innerText()).trim();

  await page.locator(".wall-commit-field").fill(firstTitle.slice(0, 10));
  await rows.first().click();
  await expect(page.locator(".wall-title")).toContainText(firstTitle, { timeout: 8_000 });

  // Unpin it and the field comes back — empty, not holding the old query.
  const pinned = page.locator(".pinned-focus-section .task-row").first();
  await expect(pinned).toBeVisible({ timeout: 8_000 });
  await pinned.locator(".task-row-top").click();
  await page.getByText("Unpin from Focus").click();

  await expect(page.locator(".wall-commit-field")).toHaveValue("", { timeout: 8_000 });
});
