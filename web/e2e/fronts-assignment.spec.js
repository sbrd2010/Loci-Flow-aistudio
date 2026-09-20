import { test, expect } from "@playwright/test";

// Fronts are only real once a task can be put on one. A front's next move and
// its progress are DERIVED from the tasks assigned to it, so assignment is the
// whole feature: before it existed, every front created through Plan showed
// "No next move yet" forever and every task stayed under "Not on a front".
//
// Demo mode, so nothing here touches Firebase.

async function enterDemo(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openPlan(page) {
  await page.locator(".bottom-nav").getByRole("button", { name: "Roadmap" }).click();
  await expect(page.locator(".plan-tab")).toBeVisible({ timeout: 10_000 });
}

async function addFront(page, name) {
  await page.getByRole("button", { name: "New front" }).click();
  await page.locator("#plan-new-name").fill(name);
  await page.getByRole("button", { name: "Add the front" }).click();
  await expect(page.locator(".plan-front-name", { hasText: name })).toBeVisible();
}

test("mobile reliability: a task can be put on a front, and the front then shows it as its next move", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Membrane paper");

  const front = page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: "Membrane paper" }) });
  // A brand-new front has nothing on it.
  await expect(front.locator(".plan-front-move-empty")).toBeVisible();
  await expect(front.locator(".plan-front-progress")).toHaveCount(0);

  // Take the first loose task and put it on the front.
  const firstLoose = page.locator(".plan-loose-row").first();
  const taskTitle = (await firstLoose.locator(".plan-loose-title").innerText()).trim();
  const looseCountBefore = await page.locator(".plan-loose-row").count();
  await firstLoose.locator(".plan-loose-assign").selectOption({ label: "Membrane paper" });

  // The front now derives its next move and progress from that task...
  await expect(front.locator(".plan-front-move-text")).toHaveText(taskTitle);
  await expect(front.locator(".plan-front-figure")).toHaveText("0/1");
  // ...and the task has left the loose list.
  await expect(page.locator(".plan-loose-row")).toHaveCount(looseCountBefore - 1);
  await expect(page.locator(".plan-loose-title", { hasText: taskTitle })).toHaveCount(0);
});

test("mobile reliability: assignment survives leaving and re-entering Plan", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Thesis chapter 3");

  const firstLoose = page.locator(".plan-loose-row").first();
  const taskTitle = (await firstLoose.locator(".plan-loose-title").innerText()).trim();
  await firstLoose.locator(".plan-loose-assign").selectOption({ label: "Thesis chapter 3" });

  const front = page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: "Thesis chapter 3" }) });
  await expect(front.locator(".plan-front-move-text")).toHaveText(taskTitle);

  // Leaving Plan and coming back must not lose it — the write went to the
  // payload, not to component state.
  await page.locator(".bottom-nav").getByRole("button", { name: "Today" }).click();
  await openPlan(page);
  await expect(front.locator(".plan-front-move-text")).toHaveText(taskTitle);
  await expect(front.locator(".plan-front-figure")).toHaveText("0/1");
});

test("mobile reliability: the picker offers exactly the fronts the screen shows", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Front alpha");
  await addFront(page, "Front beta");

  // Not a fixed number: the demo config carries a legacy Key Deadline, which
  // frontsFromConfig projects into a real, selectable front. The invariant is
  // that the picker and the list agree.
  const frontCount = await page.locator(".plan-front-name").count();
  expect(frontCount).toBeGreaterThanOrEqual(2);

  const options = page.locator(".plan-loose-row").first().locator(".plan-loose-assign option");
  await expect(options).toHaveCount(frontCount + 1); // every front, plus the prompt
  await expect(options.nth(0)).toHaveText(/Put on a front/);

  const names = await page.locator(".plan-front-name").allInnerTexts();
  const offered = (await options.allInnerTexts()).slice(1);
  expect(offered).toEqual(names);
});

test("mobile reliability: the task dialog shows a task's front and can change it", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Grant proposal");

  const firstLoose = page.locator(".plan-loose-row").first();
  const taskTitle = (await firstLoose.locator(".plan-loose-title").innerText()).trim();
  await firstLoose.locator(".plan-loose-assign").selectOption({ label: "Grant proposal" });

  // Open that task's editor from Today and confirm the field reflects reality
  // rather than defaulting to blank.
  await page.locator(".bottom-nav").getByRole("button", { name: "Today" }).click();
  const row = page.locator("[data-testid='task-row']", { hasText: taskTitle }).first();
  await row.scrollIntoViewIfNeeded();
  await row.locator(".task-row-top").click();
  await page.getByTestId("task-menu-edit").click();
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible({ timeout: 5_000 });

  const select = page.locator("#task-front");
  await expect(select).toBeVisible();
  await expect(select.locator("option:checked")).toHaveText("Grant proposal");

  // Taking it off a front from here puts it back in the loose list.
  await select.selectOption({ label: "Not on a front" });
  await page.getByTestId("add-task-submit").click();

  await openPlan(page);
  const front = page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: "Grant proposal" }) });
  await expect(front.locator(".plan-front-move-empty")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".plan-loose-title", { hasText: taskTitle })).toHaveCount(1);
});

test("mobile reliability: a front can be closed, and its tasks come back rather than vanish", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Temporary front");

  const firstLoose = page.locator(".plan-loose-row").first();
  const taskTitle = (await firstLoose.locator(".plan-loose-title").innerText()).trim();
  const looseBefore = await page.locator(".plan-loose-row").count();
  await firstLoose.locator(".plan-loose-assign").selectOption({ label: "Temporary front" });
  await expect(page.locator(".plan-loose-row")).toHaveCount(looseBefore - 1);

  const front = page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: "Temporary front" }) });
  await front.getByRole("button", { name: /Close the front Temporary front/ }).click();

  // Destructive, so it asks — and cancelling really cancels.
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(front).toHaveCount(1);

  await front.getByRole("button", { name: /Close the front Temporary front/ }).click();
  // exact, or it also matches the trigger's aria-label "Close the front <name>".
  await page.getByRole("button", { name: "Close the front", exact: true }).click();

  await expect(page.locator(".plan-front-name", { hasText: "Temporary front" })).toHaveCount(0);
  // The task is back in the loose list, not lost with the front.
  await expect(page.locator(".plan-loose-title", { hasText: taskTitle })).toHaveCount(1);
  await expect(page.locator(".plan-loose-row")).toHaveCount(looseBefore);
});

test("mobile reliability: the projected Key Deadline front offers no Close button", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);

  // It is derived from the deadline in Settings rather than stored, so there is
  // nothing for a Close button here to remove.
  const closeButtons = page.locator(".plan-front-close");
  await expect(closeButtons).toHaveCount(0);

  await addFront(page, "A real front");
  await expect(page.locator(".plan-front-close")).toHaveCount(1);
});
