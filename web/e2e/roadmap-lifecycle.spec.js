import { test, expect } from "@playwright/test";

// Roadmap reliability smoke tests run in demo mode so they do not mutate Firebase data.
// These protect horizon task flows before v0.1 is shared with 5-10 testers.

async function enterDemo(page) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openRoadmap(page) {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Horizons" }).click();
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible({ timeout: 8_000 });
}

function roadmapCard(page, title) {
  return page.locator(".roadmap-task-card", { hasText: title }).first();
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(".app-container, .screen-content, .roadmap-container, .plan-horizons").forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

test("reliability: roadmap task can be added, edited, and moved to Today", async ({ page }) => {
  await enterDemo(page);
  await openRoadmap(page);

  const originalTitle = "Roadmap lifecycle seed task";
  const editedTitle = "Ready for Today smoke task";

  await page.getByRole("button", { name: "Add a task to This week" }).click();
  await expect(page.locator(".add-card")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill(originalTitle);
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(roadmapCard(page, originalTitle)).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  // The row opens the task's sheet (52h); the full editor is its More details.
  await roadmapCard(page, originalTitle).click();
  await expect(page.getByTestId("task-detail")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("task-detail").locator(".detail-kicker").first()).toHaveText(/^THIS WEEK · \d+ OF \d+$/);
  await page.getByTestId("task-detail").getByRole("button", { name: /^More details/ }).click();

  await expect(page.getByRole("heading", { name: "Edit task" })).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill(editedTitle);
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(roadmapCard(page, editedTitle)).toBeVisible({ timeout: 5_000 });
  await expect(roadmapCard(page, originalTitle)).not.toBeVisible({ timeout: 5_000 });

  await roadmapCard(page, editedTitle).click();
  await page.getByTestId("task-detail").getByRole("button", { name: "Move to Today" }).click();
  await expect(roadmapCard(page, editedTitle)).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toContainText(`Moved to Today: ${editedTitle}`);

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByTestId("today-tasks-list").getByText(editedTitle)).toBeVisible({ timeout: 5_000 });
});

test("reliability: manual sub-steps added on a roadmap task are visible in its sheet", async ({ page }) => {
  await enterDemo(page);
  await openRoadmap(page);

  const title = "Roadmap checklist visibility seed task";
  await page.getByRole("button", { name: "Add a task to This week" }).click();
  await expect(page.locator(".add-card")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill(title);
  await page.getByRole("button", { name: /More details/i }).click();
  await page.getByTestId("add-task-substeps-draft").fill("- Check visa rules\n2. Compare flight prices");
  await page.getByTestId("add-task-substeps-add").click();
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });

  const card = roadmapCard(page, title);
  await expect(card).toBeVisible({ timeout: 5_000 });

  // 52h: the row's meta is priority · estimate · front; the steps are in the sheet.
  await card.click();
  const sheet = page.getByTestId("task-detail");
  await expect(sheet.getByText("STEPS · 0 OF 2")).toBeVisible({ timeout: 5_000 });
  await expect(sheet.getByText("Check visa rules")).toBeVisible();
  await expect(sheet.getByText("Compare flight prices")).toBeVisible();
});

test("reliability: roadmap task can be deleted, with Undo (no confirm)", async ({ page }) => {
  await enterDemo(page);
  await openRoadmap(page);

  const title = "Push the project or deliverable one step closer to done";
  await expect(roadmapCard(page, title)).toBeVisible({ timeout: 8_000 });

  await roadmapCard(page, title).click();
  await page.getByTestId("task-detail").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(roadmapCard(page, title)).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".undo-toast")).toContainText(`Deleted: ${title}`);

  // Undo brings it back; deleting again sticks.
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(roadmapCard(page, title)).toBeVisible({ timeout: 5_000 });
  await roadmapCard(page, title).click();
  await page.getByTestId("task-detail").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(roadmapCard(page, title)).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
});