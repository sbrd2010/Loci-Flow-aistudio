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

  await expect(page.locator(".wall-peek-label")).toContainText(/^Up next · /);
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

// 53f: on a phone the goal is a thin line — the days join the gold kicker, a
// 2px rule runs under the name, and there is no card. Addendum M: the demo
// has a Key Deadline and no front, so it names the deadline, with its days
// and no count (nothing countable).
test("mobile reliability: the goal is a thin gold line on a phone, with its days", async ({ page }) => {
  await enterDemo(page);
  const band = page.locator(".wall-goal");
  await expect(band).toBeVisible();
  await expect(band.locator(".wall-goal-name")).toHaveText("Project launch");
  await expect(band.locator(".wall-goal-kicker")).toHaveText(/^YOUR GOAL · \d+ DAYS$/);
  await expect(band.locator(".wall-goal-count")).toHaveCount(0);
  await expect(band.locator(".wall-goal-figures")).toBeHidden();
  expect(await band.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  const rule = await band.locator(".wall-goal-track").boundingBox();
  expect(rule.height).toBe(2);
});

// Laptop and wider keep 51's look: the filled gold card, its figures on the
// right (57b).
test("laptop: the goal keeps its gold card and figures", async ({ page }) => {
  await enterDemo(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const band = page.locator(".wall-goal");
  await expect(band.locator(".wall-goal-figures")).toHaveText(/^\d+ days$/);
  expect(await band.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(241, 223, 178)");
  await expect(band.locator(".wall-goal-days")).toBeHidden();
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

// 53e: Start runs one block, and its chevron picks another length — 5
// minutes replaces Low energy. The pick shows on Start and is what starts.
test("mobile reliability: 5 minutes from the start chooser starts five minutes", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "How long" }).click();
  const menu = page.getByRole("menu", { name: "How long" });
  await expect(menu.getByRole("menuitemradio", { name: /^25 minutes/ })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: /^5 minutes/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".wall-primary-figure")).toHaveText("05:00");

  await page.locator(".wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(overlay.getByText("FIVE MINUTES", { exact: false })).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("5:00");
});

// No Low energy anywhere (53e): the chooser's 5 minutes replaced it.
test("mobile reliability: there is no Low energy switch on Today or in Settings", async ({ page }) => {
  await enterDemoWithPeek(page);
  await expect(page.getByRole("switch", { name: "Low energy" })).toHaveCount(0);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Low energy", { exact: true })).toHaveCount(0);
});

test("mobile reliability: the scattered door on the desk reaches screen 14", async ({ page }) => {
  await enterDemoWithPeek(page);

  await page.locator(".today-list-hide").click();
  const door = page.locator(".wall-link", { hasText: "Feeling scattered?" });
  await expect(door).toBeVisible({ timeout: 8_000 });
  await door.click();

  await expect(page.locator(".scattered")).toBeVisible({ timeout: 8_000 });
});

// A session already running on the task only resumes: Start names it and
// offers no length, and Resume carries on the same countdown — it does not
// start the remembered length over, which would abandon the open session.
test("mobile reliability: a running session resumes from the wall, with no chooser", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "How long" }).click();
  await page.getByRole("menu", { name: "How long" }).getByRole("menuitemradio", { name: /^5 minutes/ }).click();
  await page.locator(".wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  const digits = overlay.locator(".focus-mode-time-digits");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  // Five seconds pass, so starting over would show.
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:05"));
  await expect(digits).toHaveText("4:55");
  await overlay.locator(".focus-mode-exit-btn").click();
  await expect(overlay).toHaveCount(0);

  await expect(page.locator(".wall-primary")).toContainText("Resume focus");
  await expect(page.getByRole("button", { name: "How long" })).toHaveCount(0);
  // Every countdown the overlay renders from here on: a new session would
  // show 5:00, if only until the next tick.
  await page.evaluate(() => {
    window.__shown = [];
    new MutationObserver(() => {
      const d = document.querySelector(".focus-mode-time-digits");
      if (d) window.__shown.push(d.textContent);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.locator(".wall-primary").click();
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(digits).toHaveText("4:55");
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => [...new Set(window.__shown)])).toEqual(["4:55"]);
});

// 53e on a laptop: ↓ on Start opens the chooser, 1–4 pick, the pick is
// remembered, and a helper line says so when the task is longer than Start.
test("laptop: ↓ opens the start chooser, 1–4 pick, the choice is remembered, and the helper line explains it", async ({ page }) => {
  await enterDemo(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  // The one thing, estimated at 2h: longer than one block.
  await page.locator(".wall-title").click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: /^Estimate/ }).click();
  await sheet.getByRole("radio", { name: "2h" }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".wall-start-helper")).toHaveText("The task is 2h. Start runs one 25-minute block; the chevron changes it.");

  await page.locator(".wall-primary").focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "How long" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: /^The whole task · 2h/ })).toBeVisible();
  await page.keyboard.press("3");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".wall-primary-figure")).toHaveText("50:00");
  await expect(page.locator(".wall-start-helper")).toHaveText("The task is 2h. Start runs 50 minutes; the chevron changes it.");

  // Remembered: the chooser opens on the pick; the whole task leaves no helper.
  await page.getByRole("button", { name: "How long" }).click();
  await expect(menu.getByRole("menuitemradio", { name: /^50 minutes/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("4");
  await expect(page.locator(".wall-primary-figure")).toHaveText("2:00:00");
  await expect(page.locator(".wall-start-helper")).toHaveCount(0);
  // Esc closes without a pick.
  await page.getByRole("button", { name: "How long" }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".wall-primary-figure")).toHaveText("2:00:00");
});

// 53e: the next step carries its own circle; ticking it moves the line on.
test("mobile reliability: ticking the next step on the wall moves to the step after it", async ({ page }) => {
  await enterDemo(page);
  const check = page.locator(".wall-step-check");
  await expect(check).toHaveAttribute("aria-checked", "false");
  const name = await check.getAttribute("aria-label");
  const first = name.replace("Mark step done: ", "");
  await expect(page.locator(".wall-first-step-text")).toContainText(`Next step — ${first}`);
  await check.click();
  await expect(page.getByRole("checkbox", { name, exact: true })).toHaveCount(0);
  await expect(page.locator(".wall-first-step-text")).toContainText("Next step — ");
  await expect(page.locator(".wall-first-step-text")).not.toContainText(first);
});

// ── J2a / Addendum K1: the empty wall ─────────────────────────────────────
// The field creates a task, because the thing you commit to may not exist in
// the app yet — without that, first launch has no exit.

// Reaching the empty wall means having no commitment AND none finished today
// — completing one gives the done state (J2b), which stands for the rest of
// the day. So this unpins instead: the wall's title opens the one thing (50a),
// and its sheet lets it go.
async function unpinFromList(page) {
  await page.locator(".wall-title").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Not the one thing now/ }).click();
}

// The task sheet, for the wall's one thing: its title opens it (52: the sheet
// edits in place). (The wall's "Split it" opens Split a task now, 45d.)
async function editWallTask(page) {
  await page.locator(".wall-title").click();
  return page.getByTestId("task-detail");
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
  await expect(page.locator(".wall-goal-days")).toBeVisible();
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
  const detail = await editWallTask(page);
  await detail.locator(".detail-title").click();
  await detail.getByLabel("Title").fill("Draft the abstract properly");
  await detail.getByLabel("Title").press("Enter");
  await detail.getByRole("button", { name: "Close", exact: true }).click();

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

  const detail = await editWallTask(page);
  await detail.getByRole("button", { name: /^Estimate/ }).click();
  await detail.getByRole("radio", { name: "30m" }).click();
  await detail.getByRole("button", { name: "Close", exact: true }).click();

  // It sticks: the task's sheet shows the length the user chose. (The start
  // control runs one block, not the estimate — 53e.)
  await page.locator(".wall-title").click();
  await expect(page.getByTestId("task-detail").getByRole("button", { name: /^Estimate/ }).locator(".detail-value")).toHaveText("30m");
  await expect(page.locator(".wall-primary")).toContainText("25:00");
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

// The wall has no unpin of its own on screen: its title opens the one thing
// (50a) and the sheet lets go of it — with Undo, like every other action.
test("mobile reliability: the one thing can be let go from its sheet, and Undo pins it back", async ({ page }) => {
  await enterDemoWithPeek(page);
  const title = (await page.locator(".wall-title").innerText()).trim();

  // It has no row in the list: "After that" is the rest of the day.
  const list = page.getByTestId("today-tasks-list");
  await expect(list.locator("[data-testid='task-row']", { hasText: title })).toHaveCount(0);
  const count = await page.locator(".today-list-count").innerText();
  const rows = await list.locator("[data-testid='task-row']:not(.completed)").count();
  expect(Number(count.split(" ")[0])).toBe(rows);

  await page.locator(".wall-title").click();
  const detail = page.getByTestId("task-detail");
  await expect(detail.locator(".detail-kicker").first()).toHaveText("TODAY · THE ONE THING");
  await detail.getByRole("button", { name: /^Not the one thing now/ }).click();
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
  await expect(page.locator(".wall-peek-label")).toContainText(/^Up next · /);
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

// Turn 50: swipes stay "right = Done, left = Tomorrow / Front".
test("mobile reliability: swipe left opens Tomorrow and Front; Tomorrow moves it, with Undo", async ({ page }) => {
  await enterDemoWithPeek(page);
  await page.locator(".today-sheet-grabber").click();
  const row = listRow(page, "10-minute walk");
  await swipe(page, row, -200);
  const tomorrow = page.getByRole("button", { name: "Tomorrow", exact: true });
  await expect(tomorrow).toBeVisible();
  await expect(page.getByRole("button", { name: "Front", exact: true })).toBeVisible();
  await tomorrow.click();
  await expect(page.getByRole("status").filter({ hasText: "Moved to tomorrow: 10-minute walk" })).toBeVisible();
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

  // Parity: the same action from the task sheet (50a), for screen readers
  // and mice.
  await listRow(page, "10-minute walk").locator(".task-row-top").click();
  const detail = page.getByTestId("task-detail");
  await detail.getByRole("button", { name: /^Front/ }).click();
  await detail.getByRole("radio", { name: "Project launch" }).click();
  await expect(detail.locator(".task-tag.is-goal")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Put on Project launch: 10-minute walk" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Tomorrow", exact: true })).toBeHidden();
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
  await swipe(page, row, -200);
  const front = page.getByRole("button", { name: "Front", exact: true });
  await front.focus();
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
  // The swipe's Front is hidden once the row closes, so focus goes to the row.
  await expect(row).toBeFocused();
});


test("the front picker opened from the swipe gives focus to the row, not the hidden Front", async ({ page }) => {
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
  await expect(row).toBeFocused();
  expect(title.length).toBeGreaterThan(0);
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

test("mobile reliability: the sheet's name counts the open rows it holds", async ({ page }) => {
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
  await page.getByTestId("task-detail").getByRole("button", { name: /^Make this the one thing/ }).click();
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toHaveText(long);
  await expect(sheet).toBeVisible();
  // The wall changed height (a different title, at its own size under the
  // title scale, and no step line), so the sheet's half height is measured
  // again to keep Start in view.
  await expect.poll(async () => parseInt(await sheet.evaluate(el => el.style.getPropertyValue("--sheet-half")), 10))
    .not.toBe(halfBefore);
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
  await swipe(page, listRow(page, "10-minute walk"), -200);
  await page.getByRole("button", { name: "Front", exact: true }).click();
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

test("mobile reliability: Escape closes the open task before the sheet", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").first();
  await row.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByTestId("task-detail");
  await expect(detail).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(row).toBeFocused();
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
// at 1200px and centred; with the list hidden, the task has its own column
// with the Day map beside it (54c). From 1600px the cap is 1760px (54a, 54e,
// today-wide.spec.js).
test("laptop: no phone-card frame; content capped at 1200px, centred", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await page.getByTestId("demo-btn").click();
  const frame = await page.locator(".app-container").boundingBox();
  expect(Math.round(frame.width)).toBe(1440);
  // With the list shown the two columns span the 1200px cap, centred.
  await page.keyboard.press("l");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await page.waitForTimeout(500);
  const [band, list] = await Promise.all([page.locator(".wall-goal").boundingBox(), page.locator(".tasks-section").boundingBox()]);
  expect(Math.round(band.x)).toBe(120);
  expect(Math.round(list.x + list.width)).toBe(1320);
});

test("wide: from 1600px the cap is 1760px, centred (50k)", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await page.getByTestId("demo-btn").click();
  await page.keyboard.press("l");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));
  const [band, map] = await Promise.all([page.locator(".wall-goal").boundingBox(), page.locator(".today-daymap").boundingBox()]);
  // (1920 − 1760) / 2 = 80 each side.
  expect(Math.round(band.x)).toBe(80);
  expect(Math.round(map.x + map.width)).toBe(1840);
});

test("laptop: with the list hidden, the task and the Day map sit side by side on one left edge, with the bottom bar (54c)", async ({ page }) => {
  await enterLaptop(page);
  // The 51b bug: goal, kicker, title and buttons share one left edge.
  const [band, anchor, kicker, title, start, done, split, map] = await Promise.all([
    page.locator(".wall-goal").boundingBox(),
    page.locator(".wall-anchor").boundingBox(),
    page.locator(".wall-kicker").boundingBox(),
    page.locator(".wall-title").boundingBox(),
    page.locator(".wall-start").boundingBox(),
    page.getByRole("button", { name: /^Mark done/ }).boundingBox(),
    page.getByRole("button", { name: /^Split it/ }).boundingBox(),
    page.getByRole("complementary", { name: "Day map" }).boundingBox(),
  ]);
  for (const box of [kicker, title, start, done]) expect(Math.abs(box.x - band.x)).toBeLessThan(1);
  expect(Math.round(start.width)).toBe(Math.round(band.width));
  expect(Math.round(split.x + split.width)).toBe(Math.round(band.x + band.width));
  expect(Math.round(done.y)).toBe(Math.round(split.y));
  // The Day map column is beside the task, and the task block sits at most
  // 120px under the goal.
  expect(map.x).toBeGreaterThan(band.x + band.width);
  expect(kicker.y - (anchor.y + anchor.height)).toBeLessThanOrEqual(121);

  // The bottom bar: Show list and "+ Add a task" on the left, Rescue on the right.
  const foot = page.locator(".wall-foot");
  const show = page.getByRole("button", { name: /^Show list · \d+/ });
  const add = foot.getByRole("button", { name: "Add a task to Today" });
  await expect(show).toBeVisible();
  await expect(add).toHaveText(/Add a task/);
  const [showBox, addBox, rescue] = await Promise.all([show.boundingBox(), add.boundingBox(),
    foot.getByRole("button", { name: "Open Rescue" }).boundingBox()]);
  expect(Math.round(addBox.y + addBox.height / 2)).toBe(Math.round(showBox.y + showBox.height / 2));
  expect(addBox.x).toBeGreaterThan(showBox.x + showBox.width);
  expect(Math.abs(rescue.x + rescue.width - (band.x + band.width))).toBeLessThan(1);

  // L swaps the Day map column for the list (54c).
  await show.click();
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Day map" })).toHaveCount(0);
  // The toggle keeps focus: Show list → Hide list, and back.
  await expect(page.locator(".today-list-hide")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".wall-peek")).toBeFocused();
});

// 51a: no "+ Add" in the list header; the list ends with "Add a task · to
// Today · N", which opens Add task on Today. The Day map link sits under
// the task, and M opens it.
test("laptop: the list's last row adds to Today; the header has no + Add; M opens the Day map (51a)", async ({ page }) => {
  await enterLaptop(page);
  await page.keyboard.press("l");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.locator(".today-list-add")).toBeHidden();
  await expect(page.locator(".today-list-link")).toBeHidden();
  const addRow = page.getByRole("button", { name: "Add a task to Today" }).last();
  await expect(addRow).toBeVisible();
  const [row, card] = await Promise.all([addRow.boundingBox(), page.locator(".tasks-section").boundingBox()]);
  expect(row.y + row.height).toBeLessThanOrEqual(card.y + card.height);
  expect(Math.round(row.height)).toBe(52);
  await addRow.click();
  await expect(page.getByTestId("add-task-title")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-task-title")).toBeHidden();

  await expect(page.locator(".wall-daymap")).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await expect(page.getByRole("heading", { name: /Day map/i }).first()).toBeVisible();
});

// 51e–f: the show/hide is animated with transform and opacity only, and a
// second L mid-move reverses it and leaves nothing behind.
test("laptop: show/hide glides with transform and opacity, reverses mid-move and leaves no residue (51e–f)", async ({ page }) => {
  await enterLaptop(page);
  await page.keyboard.press("l");
  const props = await page.evaluate(() => document.getAnimations().flatMap(a =>
    a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(p => !["offset", "easing", "composite", "computedOffset"].includes(p)))));
  expect(props.length).toBeGreaterThan(0);
  expect(new Set(props)).toEqual(new Set(["transform", "opacity"]));
  const titleAnim = await page.evaluate(() => {
    const a = document.getAnimations().find(x => x.effect.target.classList.contains("wall-title"));
    return a && { d: a.effect.getTiming().duration, e: a.effect.getTiming().easing, from: a.effect.getKeyframes()[0].transform };
  });
  expect(titleAnim.d).toBe(280);
  expect(titleAnim.e).toBe("cubic-bezier(0.2, 0, 0, 1)");
  // Both laptop states take the stage scale, so the title glides without a
  // zoom (from 1600px, where hiding the list takes the wide sizes, it zooms).
  expect(titleAnim.from).toMatch(/^translate\(.+\) scale\(1\)$/);
  await page.waitForTimeout(120);
  await page.keyboard.press("l");
  await expect(page.locator(".tasks-section")).toBeHidden({ timeout: 2_000 });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => [...document.body.children].filter(c => c.style.position === "fixed" && c.getAttribute("aria-hidden") === "true").length)).toBe(0);
  await expect(page.getByRole("button", { name: /^Show list/ })).toBeVisible();
});

// Codex review of #405. What leaves fades out as a copy (the hidden-state
// controls on Show, 80ms): the copy must outlive the layout switch. And the
// list's own 120ms fade on Hide must not end the task's glide, which runs to
// 320ms. Both are read in the same task as the click, so timing can't flake.
test("laptop: the leaving controls fade out, and hiding lets the task finish its glide (51f)", async ({ page }) => {
  await enterLaptop(page);
  const ghostsAfterShow = await page.evaluate(() => {
    document.querySelector(".wall-peek-wide").click();
    return [...document.body.children]
      .filter(c => c.style.position === "fixed" && c.getAttribute("aria-hidden") === "true")
      .filter(c => c.getAnimations().some(a => a.playState === "running")).length;
  });
  expect(ghostsAfterShow).toBeGreaterThan(0);
  await page.waitForFunction(() => document.getAnimations().length === 0);

  const hide = await page.evaluate(async () => {
    document.querySelector(".today-list-hide").click();
    const list = document.querySelector(".tasks-section");
    const fade = list.getAnimations()[0];
    // After the app's own onfinish has run (listeners fire in order).
    await new Promise(r => fade.addEventListener("finish", r, { once: true }));
    const glide = document.querySelector("[data-flip='title']").getAnimations()[0];
    return { listFade: fade.effect.getTiming().duration, glideState: glide?.playState };
  });
  expect(hide.listFade).toBe(120);
  expect(hide.glideState).toBe("running");
});

// Codex review of #405. The header's five items need about 650px; a laptop
// list under that (1024–1279) takes two tidy rows — title, count and Hide
// list, then the filter — never Hide list alone on a third.
test("laptop: the list header is one row when it fits, two tidy rows when it doesn't", async ({ page }) => {
  const tops = () => page.evaluate(() => Object.fromEntries(
    [".today-list-title", ".today-list-count", ".today-list-tools", ".today-list-head-end"].map(sel => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return [sel.slice(12), { top: r.top, bottom: r.bottom }];
    })));
  const sameRow = (a, b) => a.top < b.bottom && b.top < a.bottom;
  await enterLaptop(page);
  await page.keyboard.press("l");
  await expect(page.locator(".tasks-section")).toBeVisible();
  let t = await tops();
  for (const k of ["count", "tools", "head-end"]) expect(sameRow(t.title, t[k]), k).toBe(true);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect.poll(async () => { t = await tops(); return sameRow(t.title, t.tools); }).toBe(false);
  expect(sameRow(t.title, t.count)).toBe(true);
  expect(sameRow(t.title, t["head-end"])).toBe(true);
  expect(t.tools.top).toBeGreaterThanOrEqual(t["head-end"].bottom - 1);
});

// Codex review of #405: if the list must show again during its 120ms fade
// (the one thing was finished, so there is nothing on the wall), the end of
// the fade must not put back the display: none it started from.
test("laptop: a list the app shows again mid-fade stays shown after the fade", async ({ page }) => {
  await enterLaptop(page);
  await page.keyboard.press("l");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const display = await page.evaluate(async () => {
    document.querySelector(".today-list-hide").click();
    const list = document.querySelector(".tasks-section");
    const fade = list.getAnimations()[0];
    // Mark the one thing done while the list is still fading out.
    [...document.querySelectorAll("button")].find(b => /^Mark done/.test(b.textContent.trim()))?.click();
    await new Promise(r => fade.addEventListener("finish", r, { once: true }));
    await new Promise(r => setTimeout(r, 50));
    return getComputedStyle(list).display;
  });
  expect(display).not.toBe("none");
  await expect(page.locator(".tasks-section")).toBeVisible();
});

test("laptop: with Reduce Motion the list fades through paper and nothing moves", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterLaptop(page);
  await page.keyboard.press("l");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await page.waitForTimeout(40);
  const moved = await page.evaluate(() => document.getAnimations().some(a =>
    a.effect.getKeyframes().some(k => k.transform && k.transform !== "none")));
  expect(moved).toBe(false);
  // Codex review of #405: the toggle keeps focus here too, once the fade has
  // switched the layout.
  await page.locator(".today-list-hide").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tasks-section")).toBeHidden();
  await expect(page.locator(".wall-peek")).toBeFocused();
  await page.waitForTimeout(200); // past the 130ms guard against a double toggle
  await page.keyboard.press("Enter");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.locator(".today-list-hide")).toBeFocused();
});

// — Turn 50: a task, opened (50a–b), and making one the one thing (50c–d) —

async function laptopListOpen(page) {
  await enterLaptop(page);
  await page.keyboard.press("l");
  await expect(page.locator(".tasks-section")).toBeVisible();
  await page.waitForTimeout(400);
}

test("laptop: tapping a row opens a 480px drawer that is not modal; ↑/↓ change the task; Esc returns to the row (50b)", async ({ page }) => {
  await laptopListOpen(page);
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  const first = (await rows.nth(0).locator(".task-title-text").innerText()).trim();
  const second = (await rows.nth(1).locator(".task-title-text").innerText()).trim();
  await rows.nth(0).locator(".task-title-text").click();
  const detail = page.getByTestId("task-detail");
  await expect(detail).toBeVisible();
  expect(Math.round((await detail.boundingBox()).width)).toBe(480);
  await expect(detail).toHaveAttribute("aria-modal", "false");
  await expect(detail.getByRole("heading", { name: first })).toBeVisible();
  // No row menu any more.
  await expect(page.locator(".task-row-menu, [data-testid='task-options-menu']")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(detail.getByRole("heading", { name: second })).toBeVisible();
  await expect(detail.locator(".detail-kicker").first()).toHaveText(/TODAY · 2 OF \d+/);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(rows.nth(1)).toBeFocused();
});

test("the task sheet saves as you type: priority, note and title (50a)", async ({ page }) => {
  await laptopListOpen(page);
  const row = listRow(page, "10-minute walk");
  await row.locator(".task-title-text").click();
  const detail = page.getByTestId("task-detail");
  await detail.getByRole("radio", { name: "Priority 1" }).click();
  await expect(row.locator(".task-row-priority")).toHaveText("P1");
  await detail.getByPlaceholder("Add a note…").fill("Around the block, no phone.");
  await page.waitForTimeout(900);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await listRow(page, "10-minute walk").locator(".task-title-text").click();
  await expect(page.getByTestId("task-detail").getByPlaceholder("Add a note…")).toHaveValue("Around the block, no phone.");
  // E edits the title; Enter saves it.
  await page.getByTestId("task-detail").getByRole("heading").click();
  const input = page.getByTestId("task-detail").getByRole("textbox", { name: "Title" });
  await input.fill("10-minute walk outside");
  await input.press("Enter");
  await expect(listRow(page, "10-minute walk outside")).toBeVisible();
});

test("Make this the one thing: the old one goes back to the top of the list, tinted, with Undo (50c–d)", async ({ page }) => {
  await laptopListOpen(page);
  const oldTitle = (await page.locator(".wall-title").innerText()).trim();
  await listRow(page, "10-minute walk").locator(".task-title-text").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Make this the one thing/ }).click();
  await expect(page.locator(".wall-title")).toHaveText(/10-minute walk/);
  const firstRow = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']").first();
  await expect(firstRow.locator(".task-title-text")).toHaveText(oldTitle);
  await expect(firstRow).toHaveClass(/is-tinted/);
  await expect(page.getByRole("status").filter({ hasText: `${oldTitle} is back at the top of the list.` })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".wall-title")).toHaveText(oldTitle);
});

test("keyboard on a row: P makes it the one thing, T moves it to tomorrow, ⌫ deletes — each with Undo (50b)", async ({ page }) => {
  await laptopListOpen(page);
  const list = page.getByTestId("today-tasks-list");
  const walk = listRow(page, "10-minute walk");
  await walk.focus();
  await page.keyboard.press("t");
  await expect(list.getByText("10-minute walk")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Moved to tomorrow: 10-minute walk" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(listRow(page, "10-minute walk")).toBeVisible();

  await listRow(page, "10-minute walk").focus();
  await page.keyboard.press("Backspace");
  await expect(list.getByText("10-minute walk")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(listRow(page, "10-minute walk")).toBeVisible();

  await listRow(page, "10-minute walk").focus();
  await page.keyboard.press("p");
  await expect(page.locator(".wall-title")).toHaveText(/10-minute walk/);
});

test("laptop: hovering a row shows the pin, which makes it the one thing (50d)", async ({ page }) => {
  await laptopListOpen(page);
  const row = listRow(page, "10-minute walk");
  const pin = row.getByRole("button", { name: /^Make the one thing/ });
  await expect(pin).toBeHidden();
  await row.hover();
  await expect(pin).toBeVisible();
  await pin.click();
  await expect(page.locator(".wall-title")).toHaveText(/10-minute walk/);
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
});

test("phone: the task opens as a full-height sheet over the list; × closes it (50a)", async ({ page }) => {
  await enterDemoWithPeek(page);
  await listRow(page, "10-minute walk").locator(".task-title-text").click();
  const detail = page.getByTestId("task-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveClass(/is-sheet/);
  await expect(detail.getByRole("button", { name: "Tomorrow" })).toBeVisible();
  await detail.getByRole("button", { name: "Close" }).click();
  await expect(detail).toHaveCount(0);
});

// Codex review of #406: Tomorrow unpins the task, so a session running on it
// ends there — recorded, not left open to be resumed after Undo.
test("Tomorrow on the one thing ends its running session (50b)", async ({ page }) => {
  await enterLaptop(page);
  const title = (await page.locator(".wall-title").innerText()).trim();
  await page.locator(".wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await overlay.locator(".focus-mode-exit-btn").click();
  await expect(page.locator(".wall-primary")).toContainText("Resume focus");

  await page.locator(".wall-title").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(page.locator(".floating-focus-timer")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".wall-title")).toHaveText(title, { timeout: 8_000 });
  await expect(page.locator(".wall-primary")).toContainText("Start focus");
});

// Codex review of #406: the phone sheet is modal, so Tab and Shift+Tab stay
// inside it and never reach the list or navigation behind the scrim.
test("mobile reliability: Tab stays inside the open task sheet", async ({ page }) => {
  await enterDemo(page);
  await openSheet(page);
  await page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").first().locator(".task-row-top").click();
  const detail = page.getByTestId("task-detail");
  await expect(detail).toHaveAttribute("aria-modal", "true");
  const inside = () => page.evaluate(() => !!document.activeElement?.closest("[data-testid='task-detail']"));
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await inside(), `Tab ${i + 1}`).toBe(true);
  }
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true);
  }
});

// Codex review of #406: making the first one thing (nothing pinned) has its
// Undo too.
test("mobile reliability: making the one thing on an empty wall offers Undo", async ({ page }) => {
  await emptyTheWall(page);
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").first();
  const title = (await row.locator(".task-title-text").innerText()).trim();
  await row.locator(".task-row-top").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Make this the one thing/ }).click();
  await expect(page.locator(".wall-title")).toHaveText(title);
  await expect(page.getByRole("status").filter({ hasText: `Made the one thing: ${title}` })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".wall-commit-field")).toBeVisible({ timeout: 8_000 });
});

// Codex review of #406: P on a row sends it to the wall, and focus follows
// it there; with the drawer open, P closes it.
test("laptop: P on a row makes it the one thing and focus follows to the wall", async ({ page }) => {
  await laptopListOpen(page);
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  const title = (await rows.first().locator(".task-title-text").innerText()).trim();
  await rows.first().focus();
  await page.keyboard.press("p");
  await expect(page.locator(".wall-title")).toHaveText(title);
  await expect(page.locator(".wall-title")).toBeFocused();

  const next = (await rows.first().locator(".task-title-text").innerText()).trim();
  await rows.first().locator(".task-title-text").click();
  await expect(page.getByTestId("task-detail")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toHaveText(next);
  await expect(page.locator(".wall-title")).toBeFocused();
});

// Codex review of #406: an open task follows the window from drawer to sheet
// without keeping the drawer's measured top.
test("an open task becomes the full-height sheet when the window narrows", async ({ page }) => {
  await laptopListOpen(page);
  await page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").first().locator(".task-title-text").click();
  const detail = page.getByTestId("task-detail");
  await expect(detail).toHaveClass(/is-drawer/);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(detail).toHaveClass(/is-sheet/);
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));
  expect(Math.round((await detail.boundingBox()).y)).toBe(12);
});

// ── 50g–j: moved to tomorrow ──────────────────────────────────────────────

// 50g–h: the list closes with "N moved to tomorrow", a disclosure; opened,
// each has Bring back, which returns it to its old spot, tinted, with Undo.
test("laptop: moved tasks close the list in a quiet line; Bring back returns one to its spot, with Undo (50g–h)", async ({ page }) => {
  await laptopListOpen(page);
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  const titles = await rows.locator(".task-title-text").allInnerTexts();
  expect(titles.length).toBeGreaterThanOrEqual(2);
  // The last row: a Bring back that only put it on top would show.
  const lastTitle = titles[titles.length - 1].trim();
  await rows.last().focus();
  await page.keyboard.press("t");
  await expect(rows).toHaveCount(titles.length - 1);

  const line = page.getByRole("button", { name: /^1 moved to tomorrow/ });
  await expect(line).toHaveAttribute("aria-expanded", "false");
  await line.click();
  await expect(line).toHaveAttribute("aria-expanded", "true");
  await expect(line).toContainText("Hide");
  const back = page.getByRole("button", { name: `Bring back: ${lastTitle}` });
  await back.click();
  // Back where it was, last, tinted; the line goes with nothing left in it.
  await expect(rows.last().locator(".task-title-text")).toHaveText(lastTitle);
  await expect(page.locator(".task-row.is-tinted")).toHaveCount(1);
  await expect(line).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: `Brought back: ${lastTitle}` })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveCount(titles.length - 1);
  await expect(page.getByRole("button", { name: /^1 moved to tomorrow/ })).toBeVisible();
});

// 50i–j: the next morning they head the list under "Moved from yesterday",
// the rest under "Today"; the day after, the headings are gone.
test("the next morning, moved tasks head the list under their own heading, for that day only (50i–j)", async ({ page }) => {
  await laptopListOpen(page);
  const list = page.getByTestId("today-tasks-list");
  const rows = list.locator("[data-testid='task-row']:not(.completed)");
  const last = (await rows.last().locator(".task-title-text").innerText()).trim();
  await rows.last().focus();
  await page.keyboard.press("t");
  await expect(list.locator(".today-list-group")).toHaveCount(0);

  const rerender = async () => {
    await page.getByRole("button", { name: /^Must-do · \d+$/ }).click();
    await page.getByRole("button", { name: /^All · \d+$/ }).click();
  };
  await page.clock.setFixedTime(new Date("2024-06-16T10:00:00"));
  await rerender();
  const groups = list.locator(".today-list-group");
  await expect(groups).toHaveText(["Moved from yesterday · 1", "Today"]);
  await expect(rows.first().locator(".task-title-text")).toHaveText(last);
  // Not pinned automatically.
  await expect(page.locator(".wall-title")).not.toHaveText(last);

  await page.clock.setFixedTime(new Date("2024-06-17T10:00:00"));
  await rerender();
  await expect(groups).toHaveCount(0);
  await expect(list.getByText(last)).toBeVisible();
});

// Codex review of #406: the list is one tab stop (50b) — the grip, circle
// and step controls inside rows are not in the tab order — and the row
// itself is what Space picks up to reorder, in both drag modes.
test("laptop: the list is one tab stop, and Space on a row reorders it", async ({ page }) => {
  await laptopListOpen(page);
  const list = page.getByTestId("today-tasks-list");
  const rows = list.locator("[data-testid='task-row']:not(.completed)");
  const titles = (await rows.locator(".task-title-text").allInnerTexts()).map(t => t.trim());
  await rows.first().focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("[data-testid='today-tasks-list']"))).toBe(false);

  // Each step waits for dnd-kit's own announcement, as a screen reader hears it.
  const announced = (re) => page.waitForFunction((src) =>
    [...document.querySelectorAll("[id^='DndLiveRegion']")].some(el => new RegExp(src).test(el.textContent)), re.source);
  await rows.first().focus();
  await page.keyboard.press("Space");
  await announced(/Picked up|was moved over/);
  await page.keyboard.press("ArrowDown");
  // Over another row, not over itself.
  await announced(/Draggable item (\S+) was moved over droppable area (?!\1\b)\S+/);
  await page.keyboard.press("Space");
  await expect(rows.nth(1).locator(".task-title-text")).toHaveText(titles[0]);
  await expect(rows.nth(0).locator(".task-title-text")).toHaveText(titles[1]);
});

// Codex review of #420: the peek's "Up next" is the list's first row, in
// the list's own order — after a reorder too.
test("phone: after a reorder, Up next names the list's new first task", async ({ page }) => {
  await enterDemoWithPeek(page);
  const list = page.getByTestId("today-tasks-list");
  const rows = list.locator("[data-testid='task-row']:not(.completed)");
  const titles = (await rows.locator(".task-title-text").allInnerTexts()).map(t => t.trim());
  const announced = (re) => page.waitForFunction((src) =>
    [...document.querySelectorAll("[id^='DndLiveRegion']")].some(el => new RegExp(src).test(el.textContent)), re.source);
  await rows.first().focus();
  await page.keyboard.press("Space");
  await announced(/Picked up|was moved over/);
  await page.keyboard.press("ArrowDown");
  await announced(/Draggable item (\S+) was moved over droppable area (?!\1\b)\S+/);
  await page.keyboard.press("Space");
  await expect(rows.nth(0).locator(".task-title-text")).toHaveText(titles[1]);

  await page.locator(".today-list-hide").click();
  await expect(page.locator(".wall-peek-label")).toHaveText(`Up next · ${titles[1]}`);
});

// Codex review of #420: a chooser left open when the session starts closes
// with it; a running session offers no length.
test("mobile reliability: Start with the chooser open closes it; back from focus, no menu", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "How long" }).click();
  await expect(page.getByRole("menu", { name: "How long" })).toBeVisible();
  await page.locator(".wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  // Leave with Esc: a click outside would close the menu on its own.
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(".wall-primary")).toContainText("Resume focus");
  await expect(page.getByRole("menu", { name: "How long" })).toHaveCount(0);
});

// 57b answer 17: a light day — the one thing is all that is open — says so
// in the list, and offers This week in Plan.
test("laptop: with only the one thing open, the list says so and offers This week", async ({ page }) => {
  await enterLaptop(page);
  await page.keyboard.press("l");
  const list = page.getByTestId("today-tasks-list");
  const open = list.locator("[data-testid='task-row']:not(.completed)");
  await expect(list.locator(".today-list-empty")).toHaveCount(0);
  while (await open.count()) {
    await open.first().getByTestId("task-checkbox").click();
    await expect(page.locator(".undo-toast")).toBeVisible();
  }
  const empty = list.locator(".today-list-empty");
  await expect(empty).toHaveText("One task today. Add another, or pull from This week ›");
  await empty.getByRole("button", { name: "pull from This week ›" }).click();
  await expect(page.getByRole("banner").getByRole("button", { name: "Plan", exact: true })).toHaveAttribute("aria-current", "page");
});

// Codex review of #406: E opens a task to edit its title; a task opened
// after that, with Enter, opens as usual.
test("laptop: E edits the title of that task only; the next one opens normally", async ({ page }) => {
  await laptopListOpen(page);
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  const detail = page.getByTestId("task-detail");
  await rows.first().focus();
  await page.keyboard.press("e");
  await expect(detail.locator(".detail-title-input")).toBeVisible();
  await page.keyboard.press("Escape");
  // Out of the field, focus is back on the title, where Esc closes the sheet.
  await expect(detail.locator(".detail-title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await rows.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".detail-title-input")).toHaveCount(0);
});

// Codex review of #406: a task with the older P4 shows it, and can go back
// to it after choosing another.
test("the task sheet keeps a P4 task's priority on offer", async ({ page }) => {
  await laptopListOpen(page);
  const row = listRow(page, "10-minute walk");
  await expect(row.locator(".task-row-priority")).toHaveText("P4");
  await row.locator(".task-title-text").click();
  const group = page.getByTestId("task-detail").getByRole("radiogroup", { name: "Priority" });
  await expect(group.getByRole("radio", { name: "Priority 4" })).toHaveAttribute("aria-checked", "true");
  await group.getByRole("radio", { name: "Priority 1" }).click();
  await expect(group.getByRole("radio", { name: "Priority 1" })).toHaveAttribute("aria-checked", "true");
  await group.getByRole("radio", { name: "Priority 4" }).click();
  await expect(group.getByRole("radio", { name: "Priority 4" })).toHaveAttribute("aria-checked", "true");
});

// Codex review of #405: with nothing pinned the wall has no Day map link of
// its own, so on a laptop the list header keeps it.
test("laptop: with no one thing, the list header still opens the Day map", async ({ page }) => {
  await enterLaptop(page);
  await page.locator(".wall-title").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Not the one thing now/ }).click();
  await expect(page.locator(".wall-commit-field")).toBeVisible();
  const link = page.locator(".today-list-link");
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { name: /Day map/i }).first()).toBeVisible();
});

// Codex review of #405: reversed mid-fade, what leaves fades out from where
// it is, not from fully opaque.
test("laptop: a toggle reversed mid-fade fades the leaving link from its current opacity", async ({ page }) => {
  await enterLaptop(page);
  const start = await page.evaluate(() => {
    document.querySelector(".wall-peek").click();
    const link = document.querySelector(".wall-daymap");
    const enter = link.getAnimations()[0];
    enter.currentTime = 60 + 110; // halfway through its 220ms fade-in, after the 60ms delay
    const now = Number(getComputedStyle(link).opacity);
    document.querySelector(".today-list-hide").click();
    const ghost = [...document.body.children].find(c => c.style.position === "fixed" && c.getAttribute("aria-hidden") === "true" && c.classList.contains("wall-daymap"));
    return { now, from: ghost?.getAnimations()[0]?.effect.getKeyframes()[0].opacity };
  });
  expect(start.now).toBeGreaterThan(0.05);
  expect(start.now).toBeLessThan(0.95);
  expect(Number(start.from)).toBeCloseTo(start.now, 2);
});

// Codex review of #406: an estimate the chips don't carry (25m, the default)
// is shown, and can be chosen back.
test("the task sheet keeps a task's own estimate on offer", async ({ page }) => {
  await laptopListOpen(page);
  // The demo's tasks carry the app's 25-minute default.
  await listRow(page, "10-minute walk").locator(".task-title-text").click();
  const detail = page.getByTestId("task-detail");
  await detail.getByRole("button", { name: /^Estimate/ }).click();
  const group = detail.getByRole("radiogroup", { name: "Estimate" });
  await expect(group.getByRole("radio", { name: "25m" })).toHaveAttribute("aria-checked", "true");
  await group.getByRole("radio", { name: "1h", exact: true }).click();
  await detail.getByRole("button", { name: /^Estimate/ }).click();
  await group.getByRole("radio", { name: "25m" }).click();
  await detail.getByRole("button", { name: /^Estimate/ }).click();
  await expect(group.getByRole("radio", { name: "25m" })).toHaveAttribute("aria-checked", "true");
});

// Owner's call on the Codex review of #406: on a narrow laptop the drawer
// opens over the task column, so the list beside it stays fully usable; from
// 1280px it sits on the right, over the list, as 50b draws it.
test("narrow laptop: the drawer opens over the task column and leaves the list usable", async ({ page }) => {
  await laptopListOpen(page);
  await page.setViewportSize({ width: 1024, height: 800 });
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  const second = (await rows.nth(1).locator(".task-title-text").innerText()).trim();
  await rows.first().locator(".task-title-text").click();
  const detail = page.getByTestId("task-detail");
  await expect(detail).toBeVisible();
  const [box, list] = await Promise.all([detail.boundingBox(), page.locator(".tasks-section").boundingBox()]);
  expect(Math.round(box.x)).toBe(0);
  expect(box.x + box.width).toBeLessThanOrEqual(list.x);
  // A row beside it can be clicked, and opens in the same drawer.
  await rows.nth(1).locator(".task-title-text").click();
  await expect(detail.getByRole("heading", { name: second })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  const wide = await detail.boundingBox();
  expect(Math.round(wide.x + wide.width)).toBe(1280);
});

// Codex review of #407: a drag across the "Today" heading is not taken — the
// groups are ordered apart, so a saved cross-group order would only surface
// the day after, when the heading is gone.
test("a moved-from-yesterday task can't be dragged across the Today heading (50i)", async ({ page }) => {
  await laptopListOpen(page);
  const list = page.getByTestId("today-tasks-list");
  const rows = list.locator("[data-testid='task-row']:not(.completed)");
  const last = (await rows.last().locator(".task-title-text").innerText()).trim();
  await rows.last().focus();
  await page.keyboard.press("t");
  const rerender = async () => {
    await page.getByRole("button", { name: /^Must-do · \d+$/ }).click();
    await page.getByRole("button", { name: /^All · \d+$/ }).click();
  };
  await page.clock.setFixedTime(new Date("2024-06-16T10:00:00"));
  await rerender();
  await expect(rows.first().locator(".task-title-text")).toHaveText(last);

  const announced = (re) => page.waitForFunction((src) =>
    [...document.querySelectorAll("[id^='DndLiveRegion']")].some(el => new RegExp(src).test(el.textContent)), re.source);
  await rows.first().focus();
  await page.keyboard.press("Space");
  await announced(/Picked up|was moved over/);
  await page.keyboard.press("ArrowDown");
  await announced(/Draggable item (\S+) was moved over droppable area (?!\1\b)\S+/);
  await page.keyboard.press("Space");
  await expect(rows.first().locator(".task-title-text")).toHaveText(last);

  // The day after, with no headings, the order is still as it was shown.
  await page.clock.setFixedTime(new Date("2024-06-17T10:00:00"));
  await rerender();
  await expect(list.locator(".today-list-group")).toHaveCount(0);
  await expect(rows.first().locator(".task-title-text")).toHaveText(last);
});
