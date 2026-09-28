import { test, expect } from "@playwright/test";

// Fronts are only real once a task can be put on one. A front's next move and
// its progress are DERIVED from the tasks assigned to it, so assignment is the
// whole feature: before it existed, every front created through Plan showed
// "No next move yet" forever. A task is put on a front from its sheet (52).
//
// Demo mode, so nothing here touches Firebase.

async function enterDemo(page) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

// Plan opens on Horizons (45h); fronts are its other view.
async function openPlan(page) {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Fronts" }).click();
  await expect(page.locator(".plan-tab")).toBeVisible({ timeout: 10_000 });
}

async function addFront(page, name) {
  await page.getByRole("button", { name: "New front" }).click();
  await page.locator("#plan-new-name").fill(name);
  await page.getByRole("button", { name: "Add the front" }).click();
  await expect(page.locator(".plan-front-name", { hasText: name })).toBeVisible();
}

// 52: a task is put on a front from its sheet (the "Not on a front" list is
// gone). Opens the first This week task in Plan's Horizons, picks the front,
// closes the sheet, and returns the task's title.
async function putFirstWeekTaskOn(page, frontName) {
  await page.getByRole("tab", { name: "Horizons" }).click();
  const row = page.locator(".plan-horizon", { has: page.locator("#plan-h-week") }).locator(".plan-row").first();
  const title = (await row.locator(".plan-row-title").innerText()).trim();
  await row.click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: /^Front/ }).click();
  await sheet.getByRole("radio", { name: frontName, exact: true }).click();
  await expect(sheet.getByRole("button", { name: /^Front/ })).toContainText(frontName);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("tab", { name: "Fronts" }).click();
  return title;
}

// The front a task is on, as its sheet in Horizons shows it.
async function frontOfTask(page, title) {
  await page.getByRole("tab", { name: "Horizons" }).click();
  await page.locator(".plan-row", { hasText: title }).first().click();
  const sheet = page.getByTestId("task-detail");
  const value = (await sheet.getByRole("button", { name: /^Front/ }).locator(".detail-value").innerText()).trim();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "Fronts" }).click();
  return value;
}

test("mobile reliability: a task can be put on a front, and the front then shows it as its next move", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Membrane paper");

  const front = page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: "Membrane paper" }) });
  // A brand-new front has nothing on it.
  await expect(front.locator(".plan-front-move-empty")).toBeVisible();
  await expect(front.locator(".plan-front-progress")).toHaveCount(0);

  const taskTitle = await putFirstWeekTaskOn(page, "Membrane paper");

  // The front now derives its next move and progress from that task.
  await expect(front.locator(".plan-front-move-text")).toHaveText(taskTitle);
  await expect(front.locator(".plan-front-figure")).toHaveText("0/1");
});

test("mobile reliability: assignment survives leaving and re-entering Plan", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Thesis chapter 3");
  const taskTitle = await putFirstWeekTaskOn(page, "Thesis chapter 3");

  const front = page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: "Thesis chapter 3" }) });
  await expect(front.locator(".plan-front-move-text")).toHaveText(taskTitle);

  // Leaving Plan and coming back must not lose it — the write went to the
  // payload, not to component state.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await openPlan(page);
  await expect(front.locator(".plan-front-move-text")).toHaveText(taskTitle);
  await expect(front.locator(".plan-front-figure")).toHaveText("0/1");
});

test("mobile reliability: the sheet's Front picker offers exactly the fronts the screen shows", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Front alpha");
  await addFront(page, "Front beta");

  // Not a fixed number: the demo config carries a legacy Key Deadline, which
  // frontsFromConfig projects into a real, selectable front. The invariant is
  // that the picker and the list agree.
  const names = await page.locator(".plan-front-name").allInnerTexts();
  expect(names.length).toBeGreaterThanOrEqual(2);

  await page.getByRole("tab", { name: "Horizons" }).click();
  await page.locator(".plan-row").first().click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: /^Front/ }).click();
  const offered = await sheet.getByRole("radiogroup", { name: "Front" }).getByRole("radio").allInnerTexts();
  expect(offered[0]).toBe("None");
  expect(offered.slice(1)).toEqual(names);
});

test("mobile reliability: the task editor shows a task's front and can change it", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Grant proposal");
  const taskTitle = await putFirstWeekTaskOn(page, "Grant proposal");

  // Open that task's full editor from its sheet and confirm the field
  // reflects reality rather than defaulting to blank.
  await page.getByRole("tab", { name: "Horizons" }).click();
  await page.locator(".plan-row", { hasText: taskTitle }).first().click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^More details/ }).click();
  await expect(page.getByRole("heading", { name: "Edit task" })).toBeVisible({ timeout: 5_000 });

  const select = page.locator("#task-front");
  await expect(select).toBeVisible();
  await expect(select.locator("option:checked")).toHaveText("Grant proposal");

  // Taking it off a front from here leaves the front empty.
  await select.selectOption({ label: "Not on a front" });
  await page.getByTestId("add-task-submit").click();

  await page.getByRole("tab", { name: "Fronts" }).click();
  const front = page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: "Grant proposal" }) });
  await expect(front.locator(".plan-front-move-empty")).toBeVisible({ timeout: 5_000 });
  expect(await frontOfTask(page, taskTitle)).toBe("None");
});

test("mobile reliability: a front can be closed, and its tasks are left with no front rather than vanish", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await addFront(page, "Temporary front");
  const taskTitle = await putFirstWeekTaskOn(page, "Temporary front");

  const front = page.locator(".plan-front", { has: page.locator(".plan-front-name", { hasText: "Temporary front" }) });
  await front.getByRole("button", { name: /Close the front Temporary front/ }).click();

  // Destructive, so it asks — and cancelling really cancels.
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(front).toHaveCount(1);

  await front.getByRole("button", { name: /Close the front Temporary front/ }).click();
  // exact, or it also matches the trigger's aria-label "Close the front <name>".
  await page.getByRole("button", { name: "Close the front", exact: true }).click();

  await expect(page.locator(".plan-front-name", { hasText: "Temporary front" })).toHaveCount(0);
  // The task is still in Plan, on no front — not lost with the front.
  expect(await frontOfTask(page, taskTitle)).toBe("None");
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
