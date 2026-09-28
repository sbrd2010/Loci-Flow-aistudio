import { test, expect } from "@playwright/test";

// The task sheet follow-up (52a–c, and answer 15): "Details ›" on the wall,
// steps edited in place (Backspace on an empty one removes it, with Undo),
// SUGGESTED steps that go in only when taken, and a More row for Reminder
// and Category. Demo mode, so nothing reaches Firebase.

async function enterDemo(page, viewport = { width: 1280, height: 800 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".wall-title")).toBeVisible({ timeout: 10_000 });
}

const sheet = (page) => page.getByTestId("task-detail");
const stepValues = (page) => sheet(page).locator(".detail-step-input").evaluateAll(els => els.map(el => el.value));

async function openFromDetails(page) {
  await page.locator(".wall-details").click();
  await expect(sheet(page)).toBeVisible();
}

function mockSuggestions(page, steps) {
  return page.route("https://api.groq.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(steps) } }] }),
  }));
}

async function withKey(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key"); } catch { /* private mode */ }
  });
}

for (const [name, viewport] of [["phone", { width: 375, height: 812 }], ["laptop", { width: 1280, height: 800 }]]) {
  test(`${name}: "Details ›" on the one thing opens its sheet, whose footer has no Done`, async ({ page }) => {
    await enterDemo(page, viewport);
    const title = (await page.locator(".wall-title").innerText()).trim();
    await expect(page.locator(".wall-first-step .wall-details")).toHaveText("Details ›");
    await openFromDetails(page);
    await expect(sheet(page)).toHaveAttribute("aria-label", `Task: ${title}`);
    // Done is the title's circle, not a footer action.
    await expect(sheet(page).getByRole("button", { name: `Mark done: ${title}` })).toBeVisible();
    await expect(sheet(page).locator(".detail-foot").getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
  });
}

// The step the wall shows: the first not yet done.
const nextOpen = (page) => sheet(page).locator(".detail-step-check").evaluateAll(els => els.findIndex(el => el.getAttribute("aria-checked") !== "true"));

test("Backspace in an emptied step removes it at once, with Undo; the wall's next step follows", async ({ page }) => {
  await enterDemo(page);
  await openFromDetails(page);
  const before = await stepValues(page);
  const i = await nextOpen(page);
  expect(i).toBeGreaterThanOrEqual(0);
  await expect(page.locator(".wall-first-step")).toContainText(before[i]);

  const step = sheet(page).getByLabel(`Step ${i + 1}`, { exact: true });
  await step.fill("");
  await step.press("Backspace");
  await expect.poll(() => stepValues(page)).toEqual(before.filter((_, j) => j !== i));
  await expect(page.locator(".undo-toast")).toContainText(`Step removed: ${before[i]}`);
  // The wall moves on to the next step not yet done.
  const after = await stepValues(page);
  await expect(page.locator(".wall-first-step")).toContainText(after[await nextOpen(page)]);

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => stepValues(page)).toEqual(before);
  await expect(page.locator(".wall-first-step")).toContainText(before[i]);
});

test("Enter in a step saves its edit and moves to the next one", async ({ page }) => {
  await enterDemo(page);
  await openFromDetails(page);
  const before = await stepValues(page);
  const i = await nextOpen(page);
  const step = sheet(page).getByLabel(`Step ${i + 1}`, { exact: true });
  await step.fill("Open the inbox, nothing else");
  await step.press("Enter");
  await expect(sheet(page).getByLabel(`Step ${i + 2}`, { exact: true })).toBeFocused();
  await expect.poll(() => stepValues(page)).toEqual(before.map((t, j) => (j === i ? "Open the inbox, nothing else" : t)));
  await expect(page.locator(".wall-first-step")).toContainText("Open the inbox, nothing else");
});

test("suggested steps are offered, never added: Add takes one, Add all the rest, Dismiss none", async ({ page }) => {
  await withKey(page);
  await mockSuggestions(page, ["Find the thread", "Write two sentences", "Press send"]);
  await enterDemo(page);
  await openFromDetails(page);
  const before = await stepValues(page);

  await sheet(page).getByRole("button", { name: "Suggest steps" }).click();
  const suggested = sheet(page).locator(".detail-suggested");
  await expect(suggested.locator(".detail-suggested-text")).toHaveText(["Find the thread", "Write two sentences", "Press send"]);
  // Nothing is added until taken.
  expect(await stepValues(page)).toEqual(before);

  await sheet(page).getByRole("button", { name: "Add step Write two sentences" }).click();
  await expect.poll(() => stepValues(page)).toEqual([...before, "Write two sentences"]);
  await expect(suggested.locator(".detail-suggested-text")).toHaveText(["Find the thread", "Press send"]);

  await suggested.getByRole("button", { name: "Add all" }).click();
  await expect.poll(() => stepValues(page)).toEqual([...before, "Write two sentences", "Find the thread", "Press send"]);
  await expect(suggested).toHaveCount(0);

  // A suggestion typed in meanwhile is not added twice by Add all.
  await mockSuggestions(page, ["Close the tabs", "Save a draft"]);
  await sheet(page).getByRole("button", { name: /^Suggest (steps|again)$/ }).click();
  await expect(suggested.locator(".detail-suggested-text")).toHaveText(["Close the tabs", "Save a draft"]);
  await sheet(page).getByLabel("Add a step").fill("close the tabs");
  await sheet(page).getByLabel("Add a step").press("Enter");
  await suggested.getByRole("button", { name: "Add all" }).click();
  await expect.poll(() => stepValues(page)).toEqual([...before, "Write two sentences", "Find the thread", "Press send", "close the tabs", "Save a draft"]);

  // Dismiss adds nothing.
  await mockSuggestions(page, ["Close the laptop"]);
  await sheet(page).getByRole("button", { name: /^Suggest (steps|again)$/ }).click();
  await expect(suggested.locator(".detail-suggested-text")).toHaveText(["Close the laptop"]);
  await suggested.getByRole("button", { name: "Dismiss" }).click();
  await expect(suggested).toHaveCount(0);
  expect(await stepValues(page)).not.toContain("Close the laptop");
});

test("with no AI key, Suggest steps says where to add one", async ({ page }) => {
  await enterDemo(page);
  await openFromDetails(page);
  await sheet(page).getByRole("button", { name: "Suggest steps" }).click();
  await expect(sheet(page).locator(".detail-suggest-note")).toHaveText("Add an AI key in Settings to get suggested steps.");
});

test("More opens Reminder and Category, closed until asked", async ({ page }) => {
  await enterDemo(page);
  await openFromDetails(page);
  const more = sheet(page).locator(".detail-more-toggle");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(sheet(page).getByRole("button", { name: /^Category/ })).toHaveCount(0);
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");

  await sheet(page).getByRole("button", { name: /^Category/ }).click();
  await sheet(page).getByRole("radio", { name: "Health" }).click();
  await expect(sheet(page).getByRole("button", { name: /^Category/ }).locator(".detail-value")).toHaveText("Health");

  const reminder = sheet(page).getByRole("button", { name: /^Reminder/ });
  await expect(reminder.locator(".detail-value")).toHaveText("None");
  await reminder.click();
  await sheet(page).getByLabel("Reminder date").fill("2024-06-16");
  await sheet(page).getByLabel("Reminder time").fill("09:30");
  await expect(reminder.locator(".detail-value")).not.toHaveText("None");
  await sheet(page).getByRole("button", { name: "No reminder" }).click();
  await expect(reminder.locator(".detail-value")).toHaveText("None");
});

// Codex review of #418: a task's first action stored apart from its steps
// (Add task, Mind Box, the demo) is step 1, and survives editing the others.
test("a first step stored apart from the steps is step 1, and a change to another step keeps it", async ({ page }) => {
  await enterDemo(page);
  await openFromDetails(page);
  const before = await stepValues(page);
  const first = before[0];
  await expect(page.locator(".wall-first-step")).toContainText(`First step — ${first}`);

  // Tick the last step: the first one is still there, and still first.
  await sheet(page).locator(".detail-step-check").last().click();
  await expect(sheet(page).locator(".detail-step-check").last()).toHaveAttribute("aria-checked", "true");
  await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await openFromDetails(page);
  await expect.poll(() => stepValues(page)).toEqual(before);
  await expect(page.locator(".wall-first-step")).toContainText(first);
});

// Codex review of #418: the sheet is the only editor, so every length Add
// task offers can be set here.
test("an estimate outside the chips can be set from Other", async ({ page }) => {
  await enterDemo(page);
  await openFromDetails(page);
  await sheet(page).getByRole("button", { name: /^Estimate/ }).click();
  await sheet(page).getByLabel("Other length").selectOption("45");
  await expect(sheet(page).getByRole("button", { name: /^Estimate/ }).locator(".detail-value")).toHaveText("45m");
});

// Codex review of #418: Plan's drawer can move to another task while the AI
// answers; that answer must not show up on (and be added to) the new task.
// Each task mounts its own sheet (key = uuid), which is what keeps it off.
test("suggestions that arrive after the drawer moved to another task are dropped", async ({ page }) => {
  await withKey(page);
  let release;
  const answered = new Promise(r => { release = r; });
  await page.route("https://api.groq.com/**", async (route) => {
    await answered;
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(["Meant for the first task"]) } }] }),
    });
  });
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const rows = page.locator(".plan-row");
  await rows.nth(0).click();
  await sheet(page).getByRole("button", { name: "Suggest steps" }).click();
  await expect(sheet(page).getByRole("button", { name: "Suggesting…" })).toBeVisible();
  const second = (await rows.nth(1).locator(".plan-row-title").innerText()).trim();
  await rows.nth(1).click();
  await expect(sheet(page)).toHaveAttribute("aria-label", `Task: ${second}`);
  release();
  await page.waitForTimeout(500);
  await expect(sheet(page).locator(".detail-suggested")).toHaveCount(0);
  await expect(sheet(page).getByText("Meant for the first task")).toHaveCount(0);
});

// Codex review of #418: a step emptied some other way (select-all + Delete,
// Cut) and then left is removed too, with Undo — never left blank on screen
// while its old text stays saved.
test("a step emptied and then left is removed, with Undo", async ({ page }) => {
  await enterDemo(page);
  await openFromDetails(page);
  const before = await stepValues(page);
  const step = sheet(page).getByLabel("Step 2", { exact: true });
  await step.fill("");
  await sheet(page).getByLabel("Add a step").focus();
  await expect.poll(() => stepValues(page)).toEqual(before.filter((_, j) => j !== 1));
  await expect(page.locator(".undo-toast")).toContainText(`Step removed: ${before[1]}`);
  await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await openFromDetails(page);
  await expect.poll(() => stepValues(page)).toEqual(before.filter((_, j) => j !== 1));
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => stepValues(page)).toEqual(before);
});

// Codex review of #418: Esc closes the sheet with focus still in a step;
// the edit is saved, as the title's and note's are.
for (const [name, viewport] of [["phone", { width: 375, height: 812 }], ["laptop", { width: 1280, height: 800 }]]) {
  test(`${name}: a step edit is kept when Esc closes the sheet mid-edit`, async ({ page }) => {
    await enterDemo(page, viewport);
    await openFromDetails(page);
    const before = await stepValues(page);
    const step = sheet(page).getByLabel("Step 2", { exact: true });
    await step.click();
    await step.fill("Read it slowly, twice");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await openFromDetails(page);
    await expect.poll(() => stepValues(page)).toEqual(before.map((t, j) => (j === 1 ? "Read it slowly, twice" : t)));
  });
}
