import { test, expect } from "@playwright/test";

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

function todayRow(page, title) {
  return page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { hasText: title }).first();
}

async function openAddTask(page) {
  await page.locator(".today-list-add").click();
  await expect(page.getByRole("heading", { name: "Add Task" })).toBeVisible({ timeout: 5_000 });
}

async function openTaskMenu(page, title) {
  const row = todayRow(page, title);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.locator(".task-row-top").click();
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .tasks-section, .tasks-list, .task-row, .modal-card, .focus-mode-overlay"
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

  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, originalTitle)).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await openTaskMenu(page, originalTitle);
  await page.getByTestId("task-menu-edit").click();
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill(editedTitle);
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, editedTitle)).toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, originalTitle)).not.toBeVisible({ timeout: 5_000 });

  // Done acts at once and offers Undo (5s, a live region) — no confirm.
  const editedRow = todayRow(page, editedTitle);
  await editedRow.getByTestId("task-checkbox").click();
  await expect(page.getByRole("status").filter({ hasText: `Marked done: ${editedTitle}` })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(todayRow(page, editedTitle)).not.toHaveClass(/completed/, { timeout: 5_000 });

  await openTaskMenu(page, editedTitle);
  await page.getByTestId("task-menu-delete").click();
  await expect(todayRow(page, editedTitle)).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("status").filter({ hasText: `Deleted: ${editedTitle}` })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(todayRow(page, editedTitle)).toBeVisible({ timeout: 5_000 });

  // Pinning makes it the wall's one thing; the overlay does not auto-open.
  await openTaskMenu(page, editedTitle);
  await page.getByText("Pin to Focus", { exact: true }).click();
  const wallTitle = page.locator(".wall-title");
  await expect(wallTitle).toHaveText(editedTitle, { timeout: 5_000 });
  await page.locator(".wall-primary").click();
  const focusOverlay = page.locator(".focus-mode-overlay");
  await expect(focusOverlay).toBeVisible({ timeout: 5_000 });
  await expect(focusOverlay.getByRole("heading", { name: editedTitle })).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
  await focusOverlay.getByLabel("Exit focus mode").click();
  await expect(focusOverlay).not.toBeVisible({ timeout: 5_000 });
  await expect(wallTitle).toHaveText(editedTitle);

  // Mark done on the wall, then Undo: the task comes back as the one thing.
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
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, title)).toBeVisible({ timeout: 5_000 });

  await openTaskMenu(page, title);
  await page.getByTestId("task-menu-park").click();
  await expect(todayRow(page, title)).not.toBeVisible({ timeout: 5_000 });
});

test("mobile reliability: Add Task accepts manual sub-steps from pasted bullets", async ({ page }) => {
  await enterDemo(page);

  const title = "Manual checklist seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByRole("button", { name: /Advanced options/i }).click();
  await page.getByTestId("add-task-substeps-draft").fill("- Check visa rules\n2. Compare flight prices\nc) Book refundable hotel");
  await page.getByTestId("add-task-substeps-add").click();

  const subStepsList = page.getByTestId("add-task-substeps-list");
  await expect(subStepsList).toContainText("Check visa rules");
  await expect(subStepsList).toContainText("Compare flight prices");
  await expect(subStepsList).toContainText("Book refundable hotel");

  // Editing a step in place (the pencil icon) rewrites its text without removing it.
  await page.getByRole("button", { name: "Edit step Compare flight prices" }).click();
  await subStepsList.locator("input").fill("Compare flight and train prices");
  await subStepsList.locator("input").press("Enter");
  await expect(subStepsList).toContainText("Compare flight and train prices");
  await expect(subStepsList).not.toContainText("Compare flight prices");

  await page.getByRole("button", { name: "Remove step Compare flight and train prices" }).click();
  await expect(subStepsList).not.toContainText("Compare flight and train prices");

  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await expect(row).toContainText("Check visa rules");
  await expect(row).toContainText("Book refundable hotel");
  await expect(row).not.toContainText("Compare flight prices");
});

test("mobile reliability: Add Task flushes an in-progress sub-step edit on submit", async ({ page }) => {
  await enterDemo(page);

  const title = "Flush edit on submit seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByRole("button", { name: /Advanced options/i }).click();
  await page.getByTestId("add-task-substeps-draft").fill("Check visa rules\nCompare flight prices");
  await page.getByTestId("add-task-substeps-add").click();

  const subStepsList = page.getByTestId("add-task-substeps-list");
  await expect(subStepsList).toContainText("Compare flight prices");

  // Start editing a step but submit the whole dialog (Save/Add Task button)
  // instead of the row-level ✓ or Enter — the pending edit must still land.
  await page.getByRole("button", { name: "Edit step Compare flight prices" }).click();
  await subStepsList.locator("input").fill("Compare flight and train prices");
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await expect(row).toContainText("Compare flight and train prices");
});

async function addTaskWithSubSteps(page, title, subStepLines) {
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByRole("button", { name: /Advanced options/i }).click();
  await page.getByTestId("add-task-substeps-draft").fill(subStepLines.join("\n"));
  await page.getByTestId("add-task-substeps-add").click();
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
}

test("mobile reliability: a Today row shows every sub-step, not capped at 3", async ({ page }) => {
  await enterDemo(page);

  const title = "Row substep count seed task";
  const steps = ["Step one", "Step two", "Step three", "Step four", "Step five"];
  await addTaskWithSubSteps(page, title, steps);
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });

  for (const step of steps) {
    await expect(row.locator(".task-substep", { hasText: step })).toBeVisible({ timeout: 5_000 });
  }
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
  for (const step of longSteps) {
    await expect(row.locator(".task-substep", { hasText: step })).toBeVisible({ timeout: 5_000 });
  }

  await expectNoHorizontalOverflow(page);
});

test("mobile reliability: editing the wall's task off Today clears its focus/pin state", async ({ page }) => {
  await enterDemo(page);

  const title = "Wall horizon change seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });

  // Pin it — isNowFocus: true, the same state a running session leaves.
  await openTaskMenu(page, title);
  await page.getByText("Pin to Focus", { exact: true }).click();
  await expect(page.locator(".wall-title")).toHaveText(title, { timeout: 5_000 });

  // Split it opens the task editor, which can move the task off Today.
  await page.locator(".wall-action", { hasText: "Split it" }).click();
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "This Week" }).click();
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });

  // The task leaving Today must also clear isNowFocus — otherwise it stays
  // the app's globally "active" focused task (orphaned timer/session) even
  // though it is no longer in Today at all.
  await expect(page.locator(".wall-title")).toHaveCount(0, { timeout: 5_000 });

  // Bring it back from Plan: a pin that survived would put it straight back
  // on the wall; a cleared one lands in the list like any other task.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "HORIZONS" }).click();
  await page.locator(".roadmap-task-card", { hasText: title }).first().click();
  await page.getByRole("button", { name: /Move to Today/i }).click();
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  await expect(todayRow(page, title)).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".wall-title")).toHaveCount(0);
});

test("mobile reliability: deleting a sub-step requires confirmation and can be cancelled", async ({ page }) => {
  await enterDemo(page);

  const title = "Substep delete confirmation seed task";
  await addTaskWithSubSteps(page, title, ["Keep this step", "Remove this step"]);
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await expect(row).toContainText("Remove this step");

  // Cancel — the step must survive.
  await row.getByRole("button", { name: "Remove step" }).nth(1).click();
  await expect(page.getByText("Remove this step?", { exact: false })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toContainText("Remove this step");

  // Confirm — the step is actually removed.
  await row.getByRole("button", { name: "Remove step" }).nth(1).click();
  await expect(page.getByText("Remove this step?", { exact: false })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row).not.toContainText("Remove this step");
  await expect(row).toContainText("Keep this step");
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
