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

test("mobile reliability: the peek opens the list as a sheet, and it closes back to the wall", async ({ page }) => {
  await enterDemo(page);

  await expect(page.locator(".wall-peek-label")).toContainText(/After that · \d+/);
  await page.locator(".wall-peek").click();

  // 37b: the list rises as a sheet at half height, and the one thing stays
  // readable above it — Start focus is still the thing under its own centre.
  const sheet = page.locator(".tasks-section");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS("position", "fixed");
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));
  const startOnTop = await page.locator(".wall-primary").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(startOnTop).toBe(true);

  // Two-way: the sheet's own Hide list puts it away again.
  await page.locator(".today-list-hide").click();
  await expect(page.locator(".wall-hero")).toBeVisible();
  const display = await sheet.evaluate(el => getComputedStyle(el).display);
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
  await page.locator(".today-list-hide").click();

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
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("5:00");
});

test("mobile reliability: the scattered door on the desk reaches screen 14", async ({ page }) => {
  await enterDemoWithPeek(page);

  await page.locator(".today-list-hide").click();
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
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("25:00");
  await overlay.locator(".focus-mode-exit-btn").click();
  await expect(overlay).toHaveCount(0);

  await page.getByRole("switch", { name: "Low energy" }).click();
  await page.locator(".today-list-hide").click();
  await page.locator(".wall-action", { hasText: "Start small — 5 minutes" }).click();

  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("5:00");
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

// The task editor, for the wall's one thing: its NOW row's menu → Edit. (The
// wall's "Split it" opens Split a task now, 45d.)
async function editWallTask(page) {
  const now = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { has: page.locator(".task-tag.is-now") });
  await now.locator(".task-row-top").click();
  await now.getByTestId("task-menu-edit").click();
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

  // Open the editor for the wall's task and change ONLY the title.
  await editWallTask(page);
  await expect(page.getByRole("heading", { name: "Edit task" })).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill("Draft the abstract properly");
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

  await editWallTask(page);
  await expect(page.getByRole("heading", { name: "Edit task" })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await page.getByLabel("Minutes").selectOption("45");
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
  await expect(page.getByRole("dialog", { name: "Split a task" })).toBeVisible({ timeout: 5_000 });
  // On a laptop it is a 520px dialog.
  expect(Math.round((await page.locator(".split-card").boundingBox()).width)).toBe(520);
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
  await expect(page.getByRole("heading", { name: "Edit task" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Split a task" })).toHaveCount(0);
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
  await expect(page.getByRole("heading", { name: "New task" })).toBeVisible({ timeout: 5_000 });
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
  await expect(page.getByRole("heading", { name: "New task" })).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill("Peek plus seed task");
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });

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
  await expect(page.getByRole("heading", { name: "New task" })).toBeVisible({ timeout: 5_000 });
});

// ── 2b-2a: the phone sheet (37b half, 37c full, 38g–h tablet) ─────────────

async function openSheet(page) {
  await page.locator(".wall-peek").click();
  await expect(page.locator(".tasks-section")).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));
}

test("mobile reliability: the sheet's grabber toggles half and full; full shows the NOW card", async ({ page }) => {
  await enterDemo(page);
  // Tall enough that half height clears Start focus by itself.
  await page.setViewportSize({ width: 430, height: 1000 });
  const title = (await page.locator(".wall-title").innerText()).trim();
  await openSheet(page);

  const sheet = page.locator(".tasks-section");
  await expect(sheet).toHaveAttribute("aria-label", /^Today's list, \d+ tasks?$/);
  const grabber = page.getByRole("button", { name: "Expand the list" });
  await expect(page.locator(".today-sheet-now")).toBeHidden();
  const halfHeight = (await sheet.boundingBox()).height;

  await grabber.click();
  await expect(page.getByRole("button", { name: "Collapse the list" })).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(300);
  expect((await sheet.boundingBox()).height).toBeGreaterThan(halfHeight + 100);
  const now = page.locator(".today-sheet-now");
  await expect(now).toBeVisible();
  await expect(now.locator(".today-sheet-now-title")).toHaveText(title);

  // Start on the NOW card starts the one thing.
  await now.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".focus-mode-overlay").getByRole("heading", { name: title })).toBeVisible({ timeout: 8_000 });
});

test("mobile reliability: dragging the grabber goes up to full and down to closed", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  const g = await page.locator(".today-sheet-grabber").boundingBox();
  const x = g.x + g.width / 2, y = g.y + g.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 6 });
  await page.mouse.move(x, y - 160, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".today-sheet-now")).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));

  const g2 = await page.locator(".today-sheet-grabber").boundingBox();
  const y2 = g2.y + g2.height / 2;
  await page.mouse.move(x, y2);
  await page.mouse.down();
  await page.mouse.move(x, y2 + 150, { steps: 6 });
  await page.mouse.move(x, y2 + 320, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".tasks-section")).toBeHidden();
  await expect(page.locator(".wall-peek-label")).toContainText(/After that · \d+/);
});

test("mobile reliability: Escape puts the sheet away", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  await page.locator(".today-sheet-grabber").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tasks-section")).toBeHidden();
  await expect(page.locator(".wall-peek")).toBeFocused();
});

test("tablet under 840: the sheet is 640px wide and centred", async ({ page }) => {
  await enterDemo(page);
  await page.setViewportSize({ width: 800, height: 1100 });
  await openSheet(page);
  const box = await page.locator(".tasks-section").boundingBox();
  expect(Math.round(box.width)).toBe(640);
  expect(Math.abs(box.x - (800 - box.width) / 2)).toBeLessThanOrEqual(1);
});

test("tablet from 840: the list is inline, not a sheet", async ({ page }) => {
  await enterDemo(page);
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.locator(".wall-peek").click();
  const sheet = page.locator(".tasks-section");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS("position", "static");
  await expect(page.locator(".today-sheet-grabber")).toBeHidden();
});

test("mobile reliability: with Reduce Motion the sheet fades instead of sliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterDemo(page);
  await page.locator(".wall-peek").click();
  await expect(page.locator(".tasks-section")).toHaveCSS("animation-name", "today-sheet-fade");
});

// ── 2b-2b: swipe (37c) — touch only; every action also in the row menu ────

async function swipe(page, row, dx, dy = 0) {
  const box = await row.boundingBox();
  const x = box.x + box.width / 2, y = box.y + Math.min(24, box.height / 2);
  const opts = (cx, cy) => ({ pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, clientX: cx, clientY: cy });
  await row.dispatchEvent("pointerdown", opts(x, y));
  for (let i = 1; i <= 6; i++) await row.dispatchEvent("pointermove", opts(x + (dx * i) / 6, y + (dy * i) / 6));
  await row.dispatchEvent("pointerup", opts(x + dx, y + dy));
}

function listRow(page, text) {
  return page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { hasText: text }).first();
}

test("mobile reliability: swipe right marks a row done, with Undo", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-list-hide").click();
  await page.locator(".wall-peek").click();
  await page.locator(".today-sheet-grabber").click(); // full height: room to work
  const row = listRow(page, "10-minute walk");
  await swipe(page, row, 140);
  await expect(page.getByRole("status").filter({ hasText: "Marked done: 10-minute walk" })).toBeVisible();
  await expect(listRow(page, "10-minute walk")).toHaveClass(/completed/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(listRow(page, "10-minute walk")).not.toHaveClass(/completed/);
});

test("mobile reliability: swipe left opens This week and Front; This week moves it, with Undo", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  await swipe(page, row, -200);
  const week = page.getByRole("button", { name: "This week" });
  await expect(week).toBeVisible();
  await expect(page.getByRole("button", { name: "Front", exact: true })).toBeVisible();
  await week.click();
  await expect(page.getByRole("status").filter({ hasText: "Moved to This week: 10-minute walk" })).toBeVisible();
  await expect(listRow(page, "10-minute walk")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(listRow(page, "10-minute walk")).toBeVisible();
});

test("mobile reliability: Front puts a row on a front, with Undo; the menu offers it too", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  await expect(row.locator(".task-tag.is-goal")).toHaveCount(0);

  await swipe(page, row, -200);
  await page.getByRole("button", { name: "Front", exact: true }).click();
  const picker = page.getByRole("dialog", { name: /on a front/ });
  await expect(picker).toBeVisible();
  // The demo's goal (its Key Deadline) is a front; a task on it is GOAL.
  await picker.getByRole("button", { name: "Project launch" }).click();
  await expect(picker).toHaveCount(0);
  await expect(listRow(page, "10-minute walk").locator(".task-tag.is-goal")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Put on Project launch: 10-minute walk" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(listRow(page, "10-minute walk").locator(".task-tag.is-goal")).toHaveCount(0);

  // Parity: the same action from the row menu, for screen readers and mice.
  await listRow(page, "10-minute walk").locator(".task-row-top").click();
  await page.getByTestId("task-menu-front").click();
  await expect(page.getByRole("dialog", { name: /on a front/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /on a front/ })).toHaveCount(0);
});

test("mobile reliability: a vertical drag on a row is a scroll, not a swipe", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  const box = await row.boundingBox();
  const x = box.x + box.width / 2, y = box.y + 20;
  const at = (cx, cy) => ({ pointerType: "touch", pointerId: 9, isPrimary: true, bubbles: true, clientX: cx, clientY: cy });
  // Diagonal but mostly vertical: it crosses 10px sideways before it is
  // clearly a scroll, so the direction test is what decides. Checked while
  // the finger is still down — a slid row would snap back on release.
  await row.dispatchEvent("pointerdown", at(x, y));
  for (let i = 1; i <= 6; i++) await row.dispatchEvent("pointermove", at(x + (40 * i) / 6, y + (50 * i) / 6));
  await expect(row).not.toHaveAttribute("style", /translateX/);
  await row.dispatchEvent("pointerup", at(x + 40, y + 50));
  await expect(page.getByRole("button", { name: "This week" })).toBeHidden();
  await expect(page.locator(".undo-toast")).toHaveCount(0);
});

test("mobile reliability: an interrupted swipe (pointercancel) commits nothing", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  const box = await row.boundingBox();
  const x = box.x + box.width / 2, y = box.y + 20;
  const at = (cx) => ({ pointerType: "touch", pointerId: 11, isPrimary: true, bubbles: true, clientX: cx, clientY: y });
  await row.dispatchEvent("pointerdown", at(x));
  for (let i = 1; i <= 6; i++) await row.dispatchEvent("pointermove", at(x + (150 * i) / 6));
  await row.dispatchEvent("pointercancel", at(x + 150));
  await expect(row).not.toHaveClass(/completed/);
  await expect(page.locator(".undo-toast")).toHaveCount(0);
  await expect(row).not.toHaveAttribute("style", /translateX/);
});

async function slide(page, row, { rest = 0, dx = 150, id = 12, primary = true } = {}) {
  const box = await row.boundingBox();
  const x = box.x + box.width / 2, y = box.y + 20;
  const at = (cx) => ({ pointerType: "touch", pointerId: id, isPrimary: primary, bubbles: true, clientX: cx, clientY: y });
  await row.dispatchEvent("pointerdown", at(x));
  if (rest) await page.waitForTimeout(rest);
  for (let i = 1; i <= 6; i++) await row.dispatchEvent("pointermove", at(x + (dx * i) / 6));
  await row.dispatchEvent("pointerup", at(x + dx));
}

async function turnOnDragAnywhere(page) {
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Drag anywhere" }).click();
  await expect(page.getByRole("switch", { name: "Drag anywhere" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
}

test("mobile reliability: in Drag anywhere, a long-press then a slide is a reorder, not a swipe", async ({ page }) => {
  await enterDemoWithPeek(page);
  await turnOnDragAnywhere(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  await slide(page, row, { rest: 260 });
  await expect(row).not.toHaveClass(/completed/);
  await expect(page.locator(".undo-toast")).toHaveCount(0);
});

test("mobile reliability: in the default mode a hesitant swipe is still a swipe", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  await slide(page, row, { rest: 260 });
  await expect(listRow(page, "10-minute walk")).toHaveClass(/completed/);
});

test("mobile reliability: a quick flick whose only move crosses the line still counts", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  const box = await row.boundingBox();
  const x = box.x + box.width / 2, y = box.y + 20;
  const at = (cx) => ({ pointerType: "touch", pointerId: 14, isPrimary: true, bubbles: true, clientX: cx, clientY: y });
  await row.dispatchEvent("pointerdown", at(x));
  await row.dispatchEvent("pointermove", at(x + 150));
  await row.dispatchEvent("pointerup", at(x + 150));
  await expect(listRow(page, "10-minute walk")).toHaveClass(/completed/);
});

test("mobile reliability: a second finger does not swipe", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  await slide(page, row, { id: 21, primary: false });
  await expect(row).not.toHaveClass(/completed/);
  await expect(page.locator(".undo-toast")).toHaveCount(0);
});

test("the front picker keeps focus inside, and gives it back when it closes", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  const title = (await row.locator(".task-title-text").innerText()).trim();
  const options = page.getByRole("button", { name: `Options: ${title}` });
  await options.focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("task-menu-front").focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: /on a front/ });
  await expect(picker).toBeVisible();
  const count = await picker.locator("button").count();
  for (let i = 0; i < count + 2; i++) {
    await page.keyboard.press("Tab");
    await expect(picker.locator(":focus")).toHaveCount(1);
  }
  await page.keyboard.press("Shift+Tab");
  await expect(picker.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(options).toBeFocused();
});


test("mobile reliability: a slide that starts on the open row menu is not a swipe", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  await row.locator(".task-row-top").click();
  const item = page.getByTestId("task-menu-front");
  await expect(item).toBeVisible();
  await slide(page, item);
  await expect(listRow(page, "10-minute walk")).not.toHaveClass(/completed/);
  await expect(page.getByRole("status").filter({ hasText: "Marked done" })).toHaveCount(0);
});

test("the front picker opened from the swipe gives focus to Options, not the hidden Front", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  const title = (await row.locator(".task-title-text").innerText()).trim();
  await swipe(page, row, -200);
  const front = page.getByRole("button", { name: "Front", exact: true });
  await front.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: /on a front/ });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Options: ${title}` })).toBeFocused();
});

test("mobile reliability: a gesture on the drag grip is never a swipe", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  const grip = row.locator(".task-row-grip");
  const box = await grip.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const at = (cx) => ({ pointerType: "touch", pointerId: 13, isPrimary: true, bubbles: true, clientX: cx, clientY: y });
  await grip.dispatchEvent("pointerdown", at(x));
  for (let i = 1; i <= 6; i++) await grip.dispatchEvent("pointermove", at(x + (150 * i) / 6));
  await grip.dispatchEvent("pointerup", at(x + 150));
  await expect(row).not.toHaveClass(/completed/);
  await expect(page.locator(".undo-toast")).toHaveCount(0);
});

test("mobile reliability: the sheet's name counts the open rows it holds, NOW row included", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  const rows = await page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").count();
  await expect(page.locator(".tasks-section")).toHaveAttribute("aria-label", `Today's list, ${rows} ${rows === 1 ? "task" : "tasks"}`);
});

test("mobile reliability: Escape puts the sheet away even with focus left behind it", async ({ page }) => {
  await enterDemo(page);
  await page.locator(".wall-peek").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.locator(".wall-peek")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tasks-section")).toBeHidden();
});

test("mobile reliability: pinning a longer task with the sheet open re-measures it", async ({ page }) => {
  await enterDemo(page);
  // A tall phone, so the half height is set by Start focus, not its floor.
  await page.setViewportSize({ width: 430, height: 1000 });
  await openSheet(page);
  const sheet = page.locator(".tasks-section");
  const halfBefore = parseInt(await sheet.evaluate(el => el.style.getPropertyValue("--sheet-half")), 10);
  const long = "A very long task title that wraps over many lines on a phone, so the wall grows and Start focus moves down";
  await page.locator(".today-list-add").click();
  await page.getByTestId("add-task-title").fill(long);
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { hasText: "A very long task title" });
  await row.locator(".task-row-top").click();
  await page.getByText("Pin to Focus", { exact: true }).click();
  await expect(page.locator(".wall-title")).toHaveText(long);
  await expect(sheet).toBeVisible();
  // The wall grew, so the sheet's half height shrinks to keep Start in view.
  await expect.poll(async () => parseInt(await sheet.evaluate(el => el.style.getPropertyValue("--sheet-half")), 10))
    .toBeLessThan(halfBefore);
});


test("mobile reliability: on a short phone the half sheet shows the NOW card, so Start is never hidden", async ({ page }) => {
  // Opened with the list already open (the saved state), at the top of the
  // page: Start focus sits below the fold, under where the sheet must reach.
  await page.addInitScript(() => localStorage.setItem("loci_today_peek_open", "1"));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand the list" })).toBeVisible(); // still half
  const now = page.locator(".today-sheet-now");
  await expect(now).toBeVisible();
  await expect(now.getByRole("button", { name: "Start" })).toBeVisible();
});


test("mobile reliability: with a session left running, the sheet says Resume and makes room for the timer", async ({ page }) => {
  await enterDemo(page);
  // Start, then leave the overlay with the session still open.
  await page.locator(".wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await overlay.locator(".focus-mode-exit-btn").click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(".floating-focus-timer")).toBeVisible();

  // The floating timer pill sits over the peek (as before this change), so
  // open the list from the keyboard.
  await page.locator(".wall-peek").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));
  await page.getByRole("button", { name: "Expand the list" }).click();
  await expect(page.locator(".today-sheet-now").getByRole("button", { name: "Resume" })).toBeVisible();

  // Scrolled to its end, the last row clears the floating timer.
  const sheet = page.locator(".tasks-section");
  await expect(sheet).toHaveClass(/has-floating-timer/);
  await sheet.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const lastRow = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']").last();
  const rowBox = await lastRow.boundingBox();
  const timerBox = await page.locator(".floating-focus-timer").boundingBox();
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(timerBox.y + 1);
});

// The sheet's Escape stands down while the front picker sits over it: one
// Escape closes the picker, not both.
test("mobile reliability: Escape in the front picker closes the picker, not the sheet", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  await listRow(page, "10-minute walk").locator(".task-row-top").click();
  await page.getByTestId("task-menu-front").click();
  const picker = page.getByRole("dialog", { name: /on a front/ });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".tasks-section")).toBeVisible();
});

test("mobile reliability: Must-do filter updates the sheet's announced row count", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  await page.getByRole("button", { name: /^Must-do · \d+$/ }).click();
  const rows = await page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").count();
  await expect(page.locator(".tasks-section")).toHaveAttribute("aria-label", `Today's list, ${rows} ${rows === 1 ? "task" : "tasks"}`);
});

test("mobile reliability: Escape closes a row menu before the sheet", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").first();
  const options = row.getByRole("button", { name: /^Options:/ });
  await options.focus();
  await page.keyboard.press("Enter");
  const menu = row.getByTestId("task-options-menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(options).toBeFocused();
  await expect(page.locator(".tasks-section")).toBeVisible();
});

test("mobile reliability: the full sheet removes covered wall controls from keyboard focus", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  const grabber = page.getByRole("button", { name: "Expand the list" });
  await grabber.focus();
  await page.keyboard.press("Enter");
  const wall = page.locator(".today-layout-main");
  await expect(wall).toHaveAttribute("inert", "");
  await expect(wall).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Shift+Tab");
  expect(await wall.evaluate(el => el.contains(document.activeElement))).toBe(false);

  // At laptop width the list is inline, so the wall becomes interactive again.
  await page.setViewportSize({ width: 900, height: 1100 });
  await expect(wall).not.toHaveAttribute("inert", "");
  await expect(wall).not.toHaveAttribute("aria-hidden", "true");
});

test("mobile reliability: canceling a sheet drag does not change its height", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  const grabber = page.locator(".today-sheet-grabber");
  await grabber.evaluate(el => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const event = (type, clientY) => new PointerEvent(type, {
      bubbles: true, pointerId: 42, pointerType: "touch", isPrimary: true, clientX: x, clientY,
    });
    el.dispatchEvent(event("pointerdown", y));
    window.dispatchEvent(event("pointermove", y - 140));
    window.dispatchEvent(event("pointercancel", y - 140));
  });
  await expect(grabber).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".tasks-section")).toBeVisible();
  expect(await page.locator(".tasks-section").evaluate(el => el.style.transform)).toBe("");
});

// Split a task (45d): the wall's "Split it" opens it for the one thing.
test("Split it: steps from the task's own sub-steps; Split replaces it, the pin moves to step 1, Undo brings it back", async ({ page }) => {
  await enterDemoWithPeek(page);
  const original = (await page.locator(".wall-title").innerText()).trim();
  await page.locator(".today-list-hide").click();
  await page.locator(".wall-action", { hasText: "Split it" }).click();

  const dialog = page.getByRole("dialog", { name: "Split a task" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".split-kicker")).toHaveText(/^SPLITTING · \d+M · P\d$/);
  // The demo task has two open sub-steps: Loci starts from those.
  await expect(dialog.locator(".split-lede")).toContainText("Loci suggests two steps of 45 minutes or less");
  await expect(dialog.locator(".split-step")).toHaveCount(2);

  await dialog.getByRole("button", { name: "Add a step" }).click();
  await dialog.getByLabel("Step 3", { exact: true }).fill("Send it before lunch");
  await dialog.getByLabel("Step 3 length").selectOption("10");
  // The lede counts what Loci suggested, not the rows after an edit.
  await expect(dialog.locator(".split-lede")).toContainText("Loci suggests two steps");
  await expect(dialog.locator(".split-total-figure")).toContainText(/ of /);
  await dialog.getByRole("button", { name: "Split into 3 tasks" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: `Split into 3 tasks: ${original}` })).toBeVisible();
  // The first step is now the one thing; the original is gone.
  await expect(page.locator(".wall-title")).not.toHaveText(original);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".wall-title")).toHaveText(original);
});

test("Split it with no sub-steps and no AI key: write the steps; two are needed; Escape closes", async ({ page }) => {
  await emptyTheWall(page);
  await page.locator(".wall-commit-field").fill("Prepare the Brightlab slides");
  await page.locator(".wall-commit-field").press("Enter");
  await expect(page.locator(".wall-title")).toContainText("Prepare the Brightlab slides", { timeout: 8_000 });
  await page.locator(".today-list-hide").click();
  await page.locator(".wall-action", { hasText: "Split it" }).click();

  const dialog = page.getByRole("dialog", { name: "Split a task" });
  await expect(dialog.locator(".split-lede")).toHaveText("Break it into steps of 45 minutes or less. Reorder or remove any.");
  const go = dialog.locator(".add-submit");
  await expect(go).toBeDisabled();
  await expect(go).toHaveText("Write at least two steps");
  await dialog.getByLabel("Step 1", { exact: true }).fill("Collect the latest figures");
  await dialog.getByLabel("Step 2", { exact: true }).fill("Draft slides 1–8");
  await expect(go).toBeEnabled();
  await expect(go).toHaveText("Split into 2 tasks");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Nothing changed.
  await expect(page.locator(".wall-title")).toContainText("Prepare the Brightlab slides");
});

// Codex review of #399. The sheet takes focus when it opens, so Escape and
// Tab work at once, and gives it back when it closes.
test("Split a task takes focus on open and gives it back on close", async ({ page }) => {
  await emptyTheWall(page);
  await page.locator(".wall-commit-field").fill("Prepare the Brightlab slides");
  await page.locator(".wall-commit-field").press("Enter");
  await expect(page.locator(".wall-title")).toContainText("Prepare the Brightlab slides", { timeout: 8_000 });
  await page.locator(".today-list-hide").click();
  const opener = page.locator(".wall-action", { hasText: "Split it" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Split a task" });
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

// The AI is asked for two to four steps. Anything else falls back to writing
// them by hand; and while it works the rows are locked, so its answer never
// overwrites what was typed.
test("Split a task: rows are locked while the AI works, and an answer outside two to four is not used", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key"); } catch { /* private mode */ }
  });
  let release;
  const held = new Promise(r => { release = r; });
  await page.route("https://api.groq.com/**", async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(
        ["One", "Two", "Three", "Four", "Five"].map(text => ({ text: `${text} part`, minutes: 15 }))
      ) } }] }),
    });
  });
  await emptyTheWall(page);
  await page.locator(".wall-commit-field").fill("Prepare the Brightlab slides");
  await page.locator(".wall-commit-field").press("Enter");
  await expect(page.locator(".wall-title")).toContainText("Prepare the Brightlab slides", { timeout: 8_000 });
  await page.locator(".today-list-hide").click();
  await page.locator(".wall-action", { hasText: "Split it" }).click();

  const dialog = page.getByRole("dialog", { name: "Split a task" });
  await expect(dialog.locator(".split-lede")).toHaveText("Finding steps of 45 minutes or less…");
  await expect(dialog.getByLabel("Step 1", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Add a step" })).toBeDisabled();
  release();

  await expect(dialog.locator(".split-lede")).toHaveText("Break it into steps of 45 minutes or less. Reorder or remove any.");
  await expect(dialog.locator(".split-step")).toHaveCount(2);
  await expect(dialog.getByLabel("Step 1", { exact: true })).toBeEnabled();
  await expect(dialog.getByLabel("Step 1", { exact: true })).toHaveValue("");
});

// Laptop, 1024px and up (Addendum X3; 35e/36c): edge to edge, content capped
// at 1200px and centred; with the list hidden, the one task sits centred and
// the foot carries the links, "Show today's list" and Low energy.
test("laptop: no phone-card frame; content capped at 1200px, centred", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await page.getByTestId("demo-btn").click();
  const frame = await page.locator(".app-container").boundingBox();
  expect(Math.round(frame.width)).toBe(1920);
  const band = await page.locator(".wall-goal").boundingBox();
  expect(Math.round(band.width)).toBe(1200);
  expect(Math.round(band.x)).toBe(360);
});

test("laptop: with the list hidden, the task is centred and the foot shows today's list and Low energy", async ({ page }) => {
  await enterLaptop(page);
  const hero = await page.locator(".wall-title").boundingBox();
  const vw = page.viewportSize().width;
  expect(Math.abs(hero.x + hero.width / 2 - vw / 2)).toBeLessThan(4);
  // Start focus, Mark done and Split it in one row.
  const [start, done, split] = await Promise.all([
    page.locator(".wall-primary").boundingBox(),
    page.getByRole("button", { name: /^Mark done/ }).boundingBox(),
    page.getByRole("button", { name: /^Split it/ }).boundingBox(),
  ]);
  expect(Math.round(done.y)).toBe(Math.round(start.y));
  expect(Math.round(split.y)).toBe(Math.round(start.y));

  const show = page.getByRole("button", { name: /Show today's list/ });
  await expect(show).toBeVisible();
  await expect(show).toContainText(/\d+ · \d+ done/);
  // Low energy here and in the list are one setting.
  const energy = page.locator(".wall-foot").getByRole("switch", { name: "Low energy" });
  await expect(energy).toHaveAttribute("aria-checked", "false");
  await energy.click();
  await expect(energy).toHaveAttribute("aria-checked", "true");
  await show.click();
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.locator(".today-energy").getByRole("switch", { name: "Low energy" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".wall-foot").getByRole("switch", { name: "Low energy" })).toBeHidden();
});
