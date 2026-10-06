import { test, expect } from "@playwright/test";
import { openRung } from "./helpers/plan.js";

// Today task lifecycle smoke tests run in demo mode so they do not mutate Firebase data.
// They protect the daily execution loop: add, edit, focus, complete, undo, delete, undo.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
}

async function putListAway(page) {
  const hide = page.locator(".today-list-hide");
  if (await hide.isVisible()) await hide.click();
}

function todayRow(page, title) {
  return page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { hasText: title }).first();
}

// On a phone the open list is a sheet over the wall, and it can cover the
// wall's "+" (the test used to win a race with the sheet sliding up). Once the
// sheet settles: the "+" if nothing covers it, else N, which opens the same.
async function openAddFromPhone(page) {
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));
  const plus = page.getByRole("button", { name: "Add a task to Today" }).first();
  const reachable = await plus.evaluate(el => {
    const r = el.getBoundingClientRect();
    return !!document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)?.closest(".wall-peek-add");
  });
  if (reachable) await plus.click();
  else {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("n");
  }
}

async function openAddTask(page) {
  // The list's "+ Add task" (72); on a phone the wall's + (70a).
  const add = page.locator(".today-list-add");
  if (await add.isVisible()) await add.click();
  else await openAddFromPhone(page);
  await expect(page.getByRole("heading", { name: "New task" })).toBeVisible({ timeout: 5_000 });
}

async function openTaskMenu(page, title) {
  const row = todayRow(page, title);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.locator(".task-title-text").click();
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .tasks-section, .tasks-list, .task-row, .modal-card, .add-card, .focus-mode-overlay"
    ).forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

test("mobile reliability: Today task can be added, edited, focused, completed, restored, deleted, and undone", async ({ page }) => {
  await enterDemo(page);

  const originalTitle = "Today lifecycle seed task";
  const editedTitle = "Edited daily smoke item";

  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(originalTitle);
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, originalTitle)).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  // The sheet edits in place (52: no separate editor).
  await openTaskMenu(page, originalTitle);
  const detail = page.getByTestId("task-detail");
  await detail.locator(".detail-title").click();
  await detail.getByLabel("Title").fill(editedTitle);
  await detail.getByLabel("Title").press("Enter");
  await detail.getByRole("button", { name: "Close", exact: true }).click();

  await expect(todayRow(page, editedTitle)).toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, originalTitle)).not.toBeVisible({ timeout: 5_000 });

  // Done acts at once and offers Undo (5s, a live region) — no confirm.
  const editedRow = todayRow(page, editedTitle);
  await editedRow.getByTestId("task-checkbox").click();
  await expect(page.getByRole("status").filter({ hasText: `Marked done: ${editedTitle}` })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(todayRow(page, editedTitle)).not.toHaveClass(/completed/, { timeout: 5_000 });

  await openTaskMenu(page, editedTitle);
  await page.getByTestId("task-detail").getByRole("button", { name: /^Delete/ }).click();
  await expect(todayRow(page, editedTitle)).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("status").filter({ hasText: `Deleted: ${editedTitle}` })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(todayRow(page, editedTitle)).toBeVisible({ timeout: 5_000 });

  // Pinning makes it the wall's one thing; the overlay does not auto-open.
  await openTaskMenu(page, editedTitle);
  await page.getByTestId("task-detail").getByRole("button", { name: /^Make this the one thing/ }).click();
  const wallTitle = page.locator(".wall-title");
  await expect(wallTitle).toHaveText(editedTitle, { timeout: 5_000 });
  // The list is a sheet over the wall on a phone; put it away before using
  // the wall's own controls, as a person would.
  await putListAway(page);
  await page.locator(".wall-primary").click();
  const focusOverlay = page.locator(".focus-mode-overlay");
  await expect(focusOverlay).toBeVisible({ timeout: 5_000 });
  await expect(focusOverlay.getByRole("heading", { name: editedTitle })).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
  await focusOverlay.getByLabel("Leave focus").click();
  await expect(focusOverlay).not.toBeVisible({ timeout: 5_000 });
  await expect(wallTitle).toHaveText(editedTitle);

  // Mark done on the wall, then Undo: the task comes back as the one thing.
  await putListAway(page);
  await page.locator(".wall-action", { hasText: "Mark done" }).click();
  await expect(wallTitle).toHaveCount(0, { timeout: 5_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(wallTitle).toHaveText(editedTitle, { timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
});

test("mobile reliability: Today task can be parked from its row menu and disappears from Today", async ({ page }) => {
  await enterDemo(page);

  const title = "Park lifecycle seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, title)).toBeVisible({ timeout: 5_000 });

  await openTaskMenu(page, title);
  await page.getByTestId("task-detail").getByRole("button", { name: /^Park/ }).click();
  await expect(todayRow(page, title)).not.toBeVisible({ timeout: 5_000 });
});

test("mobile reliability: Add Task accepts manual sub-steps from pasted bullets", async ({ page }) => {
  await enterDemo(page);

  const title = "Manual checklist seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByRole("button", { name: /More details/i }).click();
  await page.getByTestId("add-task-substeps-draft").fill("- Check visa rules\n2. Compare flight prices\nc) Book refundable hotel");
  await page.getByTestId("add-task-substeps-add").click();

  const subStepsList = page.getByTestId("add-task-substeps-list");
  await expect(subStepsList).toContainText("Check visa rules");
  await expect(subStepsList).toContainText("Compare flight prices");
  await expect(subStepsList).toContainText("Book refundable hotel");

  // Editing a step in place (the pencil icon) rewrites its text without removing it.
  await page.getByRole("button", { name: "Edit step Compare flight prices" }).click();
  await subStepsList.locator(".add-step-edit").fill("Compare flight and train prices");
  await subStepsList.locator(".add-step-edit").press("Enter");
  await expect(subStepsList).toContainText("Compare flight and train prices");
  await expect(subStepsList).not.toContainText("Compare flight prices");

  await page.getByRole("button", { name: "Remove step Compare flight and train prices" }).click();
  await expect(subStepsList).not.toContainText("Compare flight and train prices");

  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  // Q59 (70a): the row counts its steps; its sheet lists them.
  await expect(row.locator(".task-row-steps")).toHaveText("0 / 2 steps");
  await row.locator(".task-title-text").click();
  const steps = page.getByTestId("task-detail").locator(".detail-step");
  await expect(steps).toContainText(["Check visa rules", "Book refundable hotel"]);
  await expect(page.getByTestId("task-detail")).not.toContainText("Compare flight prices");
});

test("mobile reliability: Add Task flushes an in-progress sub-step edit on submit", async ({ page }) => {
  await enterDemo(page);

  const title = "Flush edit on submit seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByRole("button", { name: /More details/i }).click();
  await page.getByTestId("add-task-substeps-draft").fill("Check visa rules\nCompare flight prices");
  await page.getByTestId("add-task-substeps-add").click();

  const subStepsList = page.getByTestId("add-task-substeps-list");
  await expect(subStepsList).toContainText("Compare flight prices");

  // Start editing a step but submit the whole dialog (Save/Add Task button)
  // instead of the row-level ✓ or Enter — the pending edit must still land.
  await page.getByRole("button", { name: "Edit step Compare flight prices" }).click();
  await subStepsList.locator(".add-step-edit").fill("Compare flight and train prices");
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.locator(".task-title-text").click();
  await expect(page.getByTestId("task-detail").locator(".detail-step")).toContainText(["Compare flight and train prices"]);
});

async function addTaskWithSubSteps(page, title, subStepLines) {
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByRole("button", { name: /More details/i }).click();
  await page.getByTestId("add-task-substeps-draft").fill(subStepLines.join("\n"));
  await page.getByTestId("add-task-substeps-add").click();
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
}

test("mobile reliability: a Today row counts every sub-step, and its sheet lists them all", async ({ page }) => {
  await enterDemo(page);

  const title = "Row substep count seed task";
  const steps = ["Step one", "Step two", "Step three", "Step four", "Step five"];
  await addTaskWithSubSteps(page, title, steps);
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await expect(row.locator(".task-row-steps")).toHaveText("0 / 5 steps");
  await row.locator(".task-title-text").click();
  await expect(page.getByTestId("task-detail").locator(".detail-step")).toHaveCount(5);
});

test("mobile reliability: a Today row has no horizontal overflow with several long sub-step strings", async ({ page }) => {
  await enterDemo(page);

  const title = "Row long substep overflow seed task";
  const longSteps = [
    "This is a deliberately long sub-step description meant to wrap across multiple lines on a narrow phone screen",
    "Another long line — checking job description details against CV versions 1, 2, 3, and 4 before applying",
    "Yet another long sub-step line to make sure five wrapped items in a row still fit without overflowing horizontally",
  ];
  await addTaskWithSubSteps(page, title, longSteps);
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await expect(row.locator(".task-row-steps")).toHaveText("0 / 3 steps");

  await expectNoHorizontalOverflow(page);
});

test("mobile reliability: editing the wall's task off Today clears its focus/pin state", async ({ page }) => {
  await enterDemo(page);

  const title = "Wall horizon change seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });

  // Pin it — isNowFocus: true, the same state a running session leaves.
  await openTaskMenu(page, title);
  await page.getByTestId("task-detail").getByRole("button", { name: /^Make this the one thing/ }).click();
  await expect(page.locator(".wall-title")).toHaveText(title, { timeout: 5_000 });

  // The sheet's Horizon picker can move the task off Today. The one thing
  // has no row; its title on the wall opens it (50a).
  await putListAway(page);
  await page.locator(".wall-title").click();
  const detail = page.getByTestId("task-detail");
  await detail.getByRole("button", { name: /^Horizon/ }).click();
  await detail.getByRole("radio", { name: /^This week/ }).click();

  // The task leaving Today must also clear isNowFocus — otherwise it stays
  // the app's globally "active" focused task (orphaned timer/session) even
  // though it is no longer in Today at all.
  await expect(page.locator(".wall-title")).toHaveCount(0, { timeout: 5_000 });

  // Bring it back from Plan: a pin that survived would put it straight back
  // on the wall; a cleared one lands in the list like any other task.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Horizons" }).click();
  await openRung(page, "week");
  await page.locator(".roadmap-task-card", { hasText: title }).first().click();
  await page.getByRole("button", { name: /Move to Today/i }).click();
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  await expect(todayRow(page, title)).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".wall-title")).toHaveCount(0);
});

// 52: a step goes at once, with Undo — never "Are you sure?". Its steps are
// in the task's sheet (Q59: the row only counts them).
test("mobile reliability: deleting a sub-step in the sheet removes it at once, with Undo", async ({ page }) => {
  await enterDemo(page);

  const title = "Substep delete undo seed task";
  await addTaskWithSubSteps(page, title, ["Keep this step", "Remove this step"]);
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.locator(".task-title-text").click();
  const sheet = page.getByTestId("task-detail");
  const steps = sheet.locator(".detail-step");
  await expect(steps).toContainText(["Keep this step", "Remove this step"]);

  await sheet.getByRole("button", { name: "Remove step Remove this step" }).click();
  await expect(page.getByText("Remove this step?", { exact: false })).toHaveCount(0);
  await expect(steps).toContainText(["Keep this step"]);
  await expect(sheet).not.toContainText("Remove this step");
  await expect(page.locator(".undo-toast")).toContainText("Step removed: Remove this step");

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(steps).toContainText(["Keep this step", "Remove this step"]);
});

// The toast's live region is always on the page and only its text changes —
// a region inserted already holding its message is often not announced.
test("mobile reliability: Undo is announced through a live region that was already there", async ({ page }) => {
  await enterDemo(page);
  const region = page.locator("[role='status'][aria-live='polite']").filter({ hasNotText: /./ }).first();
  await expect(region).toHaveCount(1);
  const handle = await region.elementHandle();
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").last();
  const title = (await row.locator(".task-title-text").innerText()).trim();
  await row.getByTestId("task-checkbox").click();
  // The same element, now carrying the words.
  await expect.poll(() => handle.evaluate(el => el.textContent)).toBe(`Marked done: ${title}. Undo available.`);
});

// "Holds while hovered or focused": the two are separate, so moving the
// mouse off a toast whose Undo has keyboard focus must not restart the clock.
test("mobile reliability: a focused Undo stays after the mouse passes over and leaves", async ({ page }) => {
  await enterDemo(page);
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").last();
  await row.getByTestId("task-checkbox").click();
  const toast = page.locator(".undo-toast");
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).focus();
  await toast.hover();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(5_800);
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Undo" })).toBeFocused();
});

// 50b: the list is one tab stop. ↓ / ↑ move between rows, Enter opens the
// task, Escape closes it and returns focus to the row.
test("mobile reliability: rows are reachable from the keyboard and Enter opens the task", async ({ page }) => {
  await enterDemo(page);
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  await expect(rows.first()).toBeVisible();
  // One tab stop: exactly one row is in the tab order.
  await expect(page.getByTestId("today-tasks-list").locator("[data-testid='task-row'][tabindex='0']")).toHaveCount(1);
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  const title = (await rows.nth(1).locator(".task-title-text").innerText()).trim();
  await page.keyboard.press("Enter");
  const detail = page.getByTestId("task-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: title })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(rows.nth(1)).toBeFocused();
});

// In Drag anywhere mode Space picks a row up; Enter still opens the task.
test("mobile reliability: in Drag anywhere mode Enter opens the task and Escape returns to the row", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Drag anywhere" }).click();
  await expect(page.getByRole("switch", { name: "Drag anywhere" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByTestId("today-tasks-list")).toBeVisible();
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)").first();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
  await expect(row).toBeFocused();
});

// "Done today · N" counts what was finished today, and the fold shows the
// same set — a task done yesterday that still sits on Today is neither.
test("mobile reliability: the Done today fold and its count agree across a day change", async ({ page }) => {
  await enterDemo(page);
  const list = page.getByTestId("today-tasks-list");
  const title = "10-minute walk between tasks to reset your focus";
  await list.locator("[data-testid='task-row']", { hasText: title }).getByTestId("task-checkbox").click();
  // 58.6: the done rows sit in the "Done today · N" fold.
  const fold = page.locator(".today-done-fold .today-parked-line");
  const doneToday = Number((await fold.innerText()).match(/Done today · (\d+)/i)[1]);
  await fold.click();
  await expect(list.locator(".task-row.completed")).toHaveCount(doneToday);

  // Next day: re-render (flip the view) and look again.
  await page.clock.setFixedTime(new Date("2024-06-16T10:00:00"));
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Day map", exact: true }).click();
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
  await expect(page.locator(".today-done-fold")).toHaveCount(0);
  await expect(list.locator(".task-row.completed")).toHaveCount(0);
});
