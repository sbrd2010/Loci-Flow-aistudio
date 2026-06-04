import { test, expect } from "@playwright/test";

// Roadmap reliability smoke tests run in demo mode so they do not mutate Firebase data.
// These protect horizon task flows before v0.1 is shared with 5-10 testers.

async function enterDemo(page) {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openRoadmap(page) {
  await page.locator(".bottom-nav").getByRole("button", { name: "Roadmap" }).click();
  await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible({ timeout: 8_000 });
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
    document.querySelectorAll(".app-container, .screen-content, .roadmap-container, .roadmap-compact-layout, .horizon-panel").forEach((el) => {
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

  await page.locator(".horizon-panel .column-add-btn").click();
  await expect(page.locator(".modal-card")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill(originalTitle);
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(roadmapCard(page, originalTitle)).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await roadmapCard(page, originalTitle).click();
  await expect(page.getByRole("heading", { name: "Manage Commitment" })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /Edit task/i }).click();

  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill(editedTitle);
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(roadmapCard(page, editedTitle)).toBeVisible({ timeout: 5_000 });
  await expect(roadmapCard(page, originalTitle)).not.toBeVisible({ timeout: 5_000 });

  await roadmapCard(page, editedTitle).click();
  await page.getByRole("button", { name: /Move to Today/i }).click();
  await expect(roadmapCard(page, editedTitle)).not.toBeVisible({ timeout: 5_000 });

  await page.locator(".bottom-nav").getByRole("button", { name: "Today" }).click();
  await expect(page.getByTestId("today-tasks-list").getByText(editedTitle)).toBeVisible({ timeout: 5_000 });
});

test("reliability: roadmap task can be deleted through confirmation", async ({ page }) => {
  await enterDemo(page);
  await openRoadmap(page);

  const title = "Push the project or deliverable one step closer to done";
  await expect(roadmapCard(page, title)).toBeVisible({ timeout: 8_000 });

  await roadmapCard(page, title).click();
  await expect(page.getByRole("heading", { name: "Manage Commitment" })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /Delete Task/i }).click();

  await expect(page.getByText(`Delete "${title}"?`)).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(roadmapCard(page, title)).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
});