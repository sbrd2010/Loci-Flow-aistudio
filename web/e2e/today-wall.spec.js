import { test, expect } from "@playwright/test";

// Today's wall (turns 37, 40, 41, 49): the goal band, one anchor line, and
// the one thing with one filled "Start focus".
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

  // The commitment is the dominant element, with exactly one filled action.
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".wall-title")).toBeVisible();
  await expect(page.locator(".wall-primary")).toHaveCount(1);
  await expect(page.locator(".wall-primary")).toContainText("Start focus");

  // The list is genuinely gone, not merely scrolled past. This asserts the
  // computed style because the section carries an INLINE display, and a class
  // rule cannot override one — an earlier attempt toggled a class, looked
  // correct, and hid nothing.
  const display = await page.locator(".tasks-section").evaluate(el => getComputedStyle(el).display);
  expect(display).toBe("none");
});

test("mobile reliability: the peek opens the desk and closes back to the wall", async ({ page }) => {
  await enterDemo(page);

  await expect(page.locator(".wall-peek-label")).toContainText(/After that · \d+/);
  await page.locator(".wall-peek").click();

  // The list opens below; the one thing stays as it was.
  await expect(page.locator(".wall-primary")).toBeVisible();
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.locator(".wall-peek-label")).toHaveText("Hide list");

  // Two-way: the toggle is a button in both states, so you can always get back.
  await page.locator(".wall-peek").click();
  await expect(page.locator(".wall-hero")).toBeVisible();
  const display = await page.locator(".tasks-section").evaluate(el => getComputedStyle(el).display);
  expect(display).toBe("none");
});

test("mobile reliability: the peek state survives a reload", async ({ page }) => {
  await enterDemo(page);
  await page.locator(".wall-peek").click();
  await expect(page.locator(".tasks-section")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  // peekOpen is persisted to localStorage, per the handoff.
  await expect(page.locator(".tasks-section")).toBeVisible({ timeout: 10_000 });
});

test("mobile reliability: Start focus starts a focus session on the commitment", async ({ page }) => {
  await enterDemo(page);

  const title = (await page.locator(".wall-title").innerText()).trim();
  await page.locator(".wall-primary").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay.getByRole("heading", { name: title })).toBeVisible();
});

test("mobile reliability: the goal band names the goal and its days, in gold", async ({ page }) => {
  await enterDemo(page);

  // Addendum M: the demo has a Key Deadline and no front, so the band names
  // the deadline, with its days and no count (nothing countable).
  const band = page.locator(".wall-goal");
  await expect(band).toBeVisible();
  await expect(band.locator(".wall-goal-name")).toHaveText("Project launch");
  await expect(band.locator(".wall-goal-figures").first()).toHaveText(/^\d+ days$/);
  // Gold is the goal and nothing else: the band is the gold band token.
  const bg = await band.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(241, 223, 178)");
});

// 40a: one anchor, the day's own, and a tap shows the next.
test("mobile reliability: the anchor line shows one anchor and a tap moves to the next", async ({ page }) => {
  await enterDemo(page);

  const line = page.locator(".wall-anchor");
  await expect(line).toBeVisible();
  const first = (await line.locator(".wall-anchor-text").innerText()).trim();
  await expect(line.locator(".wall-anchor-count")).toHaveText(/^\d+ \/ 5 ›$/);

  await line.click();
  await expect(line.locator(".wall-anchor-text")).not.toHaveText(first);
  // No pop-up over the list, ever (40a).
  await expect(page.locator(".focus-now-backdrop")).toHaveCount(0);
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

  await page.getByRole("switch", { name: "Low energy" }).click();

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

  const door = page.locator(".wall-link", { hasText: "Feeling scattered?" });
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

  await page.getByRole("switch", { name: "Low energy" }).click();
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
// the day. So this unpins instead, from the NOW row that heads the open list.
async function unpinFromList(page) {
  const now = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { has: page.locator(".task-tag.is-now") });
  await expect(now).toHaveCount(1, { timeout: 10_000 });
  await now.locator(".task-row-top").click();
  await page.getByText("Unpin from Focus").click();
}

async function emptyTheWall(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await enterDemo(page);
  await expect(page.locator(".wall-title")).toBeVisible({ timeout: 10_000 });
  await unpinFromList(page);
  await expect(page.locator(".wall-commit-field")).toBeVisible({ timeout: 8_000 });
}

test("mobile reliability: typing on the empty wall creates and commits a task", async ({ page }) => {
  await emptyTheWall(page);

  // 37f: the field is the whole form; Enter commits.
  await expect(page.locator(".wall-empty-title")).toHaveText("Nothing committed yet.");
  await page.locator(".wall-commit-field").fill("Write the membrane paper intro");
  await page.locator(".wall-commit-field").press("Enter");

  // It becomes the commitment: the wall stops asking and the task IS the hero.
  await expect(page.locator(".wall-commit-field")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toContainText("Write the membrane paper intro");

  // The task is created with the canonical "Personal" category and NO
  // estimate, so no duration is rendered for it as if the user had chosen one.
  await expect(page.locator(".wall-title")).not.toContainText("25m");
  // L1: no front, but the demo has a Key Deadline set — so the goal band names
  // THAT, rather than suppressing a countdown the user already has.
  await expect(page.locator(".wall-goal-name")).toHaveText("Project launch");
  await expect(page.locator(".wall-goal-figures").first()).toBeVisible();
  // And no first step: concreteStep is OMITTED rather than set empty, so
  // normalizePayload does not substitute its "Do first tiny step" default.
  await expect(page.locator(".wall-first-step")).toHaveCount(0);
});

test("mobile reliability: Enter commits, without touching the button", async ({ page }) => {
  await emptyTheWall(page);

  await page.locator(".wall-commit-field").fill("Reply to the supervisor");
  await page.locator(".wall-commit-field").press("Enter");

  await expect(page.locator(".wall-title")).toContainText("Reply to the supervisor");
});

// 37f: what already exists is one tap away — Mind Box, with its count.
test("mobile reliability: the empty wall offers Mind Box with its count", async ({ page }) => {
  await emptyTheWall(page);

  const link = page.locator(".wall-link", { hasText: /^pick from Mind Box \(\d+\)$/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });
});

// ── J2b / Addendum K2, K3: the commitment, finished ───────────────────────

test("mobile reliability: finishing the commitment gives the done state, not the empty wall", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  const title = (await page.locator(".wall-title").innerText()).trim();

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

  await expect(page.locator(".wall-title")).toContainText(next, { timeout: 8_000 });
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

// TodayWall stays mounted, so a draft left in the field would reappear if the
// committed task is ever unpinned — and an accidental Enter then creates a
// duplicate of it.
test("mobile reliability: committing clears the typed draft", async ({ page }) => {
  await emptyTheWall(page);

  await page.locator(".wall-commit-field").fill("Call the landlord");
  await page.locator(".wall-commit-field").press("Enter");
  await expect(page.locator(".wall-title")).toContainText("Call the landlord", { timeout: 8_000 });

  // Unpin it and the field comes back — empty, not holding the old query.
  await unpinFromList(page);

  await expect(page.locator(".wall-commit-field")).toHaveValue("", { timeout: 8_000 });
});

// A task committed from the wall has no estimate and no subtask by design
// (K1). Editing it must not quietly materialise the form's defaults: renaming
// it should not give it a 25-minute estimate and a "Do first tiny step" it
// never had.
test("mobile reliability: editing a wall task keeps its no-estimate, no-subtask state", async ({ page }) => {
  await emptyTheWall(page);

  await page.locator(".wall-commit-field").fill("Draft the membrane abstract");
  await page.locator(".wall-commit-field").press("Enter");
  await expect(page.locator(".wall-title")).toContainText("Draft the membrane abstract", { timeout: 8_000 });
  // No first step to begin with.
  await expect(page.locator(".wall-first-step")).toHaveCount(0);

  // Open the editor from the wall and change ONLY the title.
  await page.locator(".wall-action", { hasText: "Split it" }).click();
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("e.g. Write cover letter draft").fill("Draft the abstract properly");
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".wall-title")).toContainText("Draft the abstract properly", { timeout: 8_000 });
  // Still no invented subtask, and still no duration presented as chosen.
  await expect(page.locator(".wall-first-step")).toHaveCount(0);
  await expect(page.getByText("Do first tiny step")).toHaveCount(0);
});

// A regression guard for the header not lurching when the commitment is
// finished. Narrow on purpose: the demo has no fronts, so this exercises the
// legacy-deadline path only — the front case, where the countdown could jump
// to an unrelated deadline, is pinned down by frontForCommitment's unit tests.
test("mobile reliability: the done state keeps the finished task's own countdown", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  const figures = page.locator(".wall-goal-figures").first();
  const before = await figures.innerText();

  await page.locator(".wall-action", { hasText: "Mark done" }).click();
  await expect(page.locator(".wall-done-line")).toBeVisible({ timeout: 8_000 });

  await expect(figures).toHaveText(before);
});

// The selector shows 25 for a task that has none, so choosing 25 has to be
// distinguishable from never touching it — otherwise the estimate cannot be
// set on a wall-created task at all.
test("mobile reliability: an estimate can still be chosen for a wall task", async ({ page }) => {
  await emptyTheWall(page);

  await page.locator(".wall-commit-field").fill("Size this one properly");
  await page.locator(".wall-commit-field").press("Enter");
  await expect(page.locator(".wall-title")).toContainText("Size this one properly", { timeout: 8_000 });

  await page.locator(".wall-action", { hasText: "Split it" }).click();
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible({ timeout: 5_000 });
  await page.locator(".selector-btn", { hasText: "45m" }).first().click();
  await page.getByTestId("add-task-submit").click();

  // It sticks: the wall's start control now offers the length the user chose,
  // not the 25 it falls back to when there is no estimate.
  await expect(page.locator(".wall-primary")).toContainText("45:00", { timeout: 8_000 });
});

// 37l / 41a: laptop keys on the wall — Space starts focus, D marks done, S
// splits — and none of them fire while typing.
async function enterLaptop(page) {
  await enterDemo(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".wall-primary .wall-key")).toBeVisible();
}

test("laptop: Space starts focus on the commitment", async ({ page }) => {
  await enterLaptop(page);
  const title = (await page.locator(".wall-title").innerText()).trim();
  await page.keyboard.press(" ");
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(overlay.getByRole("heading", { name: title })).toBeVisible();
});

test("laptop: D marks the commitment done", async ({ page }) => {
  await enterLaptop(page);
  await page.keyboard.press("d");
  await expect(page.locator(".wall-done-line")).toBeVisible({ timeout: 8_000 });
});

test("laptop: S opens the commitment to split it", async ({ page }) => {
  await enterLaptop(page);
  await page.keyboard.press("s");
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible({ timeout: 5_000 });
});

test("laptop: the wall's keys stay quiet while typing", async ({ page }) => {
  await enterLaptop(page);
  // Any text field on the page — the guard is on the element, not the screen.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "typing-probe";
    document.body.appendChild(input);
  });
  await page.locator("#typing-probe").focus();
  await page.keyboard.type("d s ");
  await expect(page.locator("#typing-probe")).toHaveValue("d s ");
  await expect(page.locator(".wall-done-line")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Edit Task" })).toHaveCount(0);
  await expect(page.locator(".focus-mode-overlay")).toHaveCount(0);
});

test("laptop: N opens Add task for Today, L shows and hides the list", async ({ page }) => {
  await enterLaptop(page);
  const list = page.locator(".tasks-section");
  await expect(list).toBeHidden();

  await page.keyboard.press("l");
  await expect(list).toBeVisible();
  // The open list carries its own "Hide list" from 840px; it and L agree.
  await page.locator(".today-list-hide").click();
  await expect(list).toBeHidden();
  await page.keyboard.press("l");
  await expect(list).toBeVisible();
  // A tap leaves focus on the control it pressed; the letter keys still work
  // (only Space would also press it).
  const all = page.getByRole("button", { name: /^All · \d+$/ });
  await all.click();
  await expect(all).toBeFocused();
  await page.keyboard.press("l");
  await expect(list).toBeHidden();
  await page.keyboard.press("l");
  await expect(list).toBeVisible();

  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: "Add Task" })).toBeVisible({ timeout: 5_000 });
});

// 49a: on a phone, "+" sits at the right of the closed peek and opens Add task
// with Horizon = Today.
test("mobile reliability: the peek's + adds a task to Today", async ({ page }) => {
  await enterDemo(page);
  const add = page.getByRole("button", { name: "Add a task to Today" });
  await expect(add).toBeVisible({ timeout: 10_000 });
  const box = await add.boundingBox();
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);

  await add.click();
  await expect(page.getByRole("heading", { name: "Add Task" })).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill("Peek plus seed task");
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });

  await page.locator(".wall-peek").click();
  await expect(page.getByTestId("today-tasks-list").getByText("Peek plus seed task")).toBeVisible({ timeout: 5_000 });
});

// A row in Drag anywhere mode is a focusable <div>, and its Space starts a
// keyboard reorder. The wall must not also start a session from it.
test("laptop: the wall's keys stay quiet on any focused control", async ({ page }) => {
  await enterLaptop(page);
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.id = "row-probe";
    row.tabIndex = 0;
    document.body.appendChild(row);
  });
  await page.locator("#row-probe").focus();
  await page.keyboard.press(" ");
  await page.keyboard.press("d");
  await expect(page.locator(".focus-mode-overlay")).toHaveCount(0);
  await expect(page.locator(".wall-done-line")).toHaveCount(0);
});

// The wall has no unpin of its own: the one thing heads the open list, marked
// NOW, and its row menu lets go of it — with Undo, like every other action.
test("mobile reliability: the one thing can be unpinned from the list, and Undo pins it back", async ({ page }) => {
  await enterDemoWithPeek(page);
  const title = (await page.locator(".wall-title").innerText()).trim();

  const now = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']").first();
  await expect(now.locator(".task-tag.is-now")).toHaveText("NOW");
  await expect(now.locator(".task-title-text")).toHaveText(title);
  // Not counted in "After that": the figure is the rest of the day.
  const count = await page.locator(".today-list-count").innerText();
  const rows = await page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").count();
  expect(Number(count.split(" ")[0])).toBe(rows - 1);

  await now.locator(".task-row-top").click();
  await page.getByText("Unpin from Focus").click();
  await expect(page.locator(".wall-commit-field")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("status").filter({ hasText: `Unpinned: ${title}` })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".wall-title")).toHaveText(title, { timeout: 8_000 });
});

// A + is on screen at every width: on a laptop with the list hidden, too.
test("laptop: the peek's + is there with the list hidden", async ({ page }) => {
  await enterLaptop(page);
  await expect(page.locator(".tasks-section")).toBeHidden();
  const add = page.getByRole("button", { name: "Add a task to Today" });
  await expect(add).toBeVisible();
  await add.click();
  await expect(page.getByRole("heading", { name: "Add Task" })).toBeVisible({ timeout: 5_000 });
});
