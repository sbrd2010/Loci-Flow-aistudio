import { test, expect } from "@playwright/test";
import { openRung } from "./helpers/plan.js";

// Add task (45a phone sheet, 45k laptop dialog). Demo mode: nothing reaches
// Firebase. The horizon defaults to where + was tapped, and the sheet says so.

async function enterDemo(page, viewport = { width: 412, height: 892 }) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
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

async function openFromToday(page) {
  // The list's "+ Add task" (72); on a phone the wall's + (70a).
  const add = page.locator(".today-list-add");
  if (await add.isVisible()) await add.click();
  else await openAddFromPhone(page);
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible({ timeout: 5_000 });
}

test("opened from Today: it says so, rings the horizon block, and the button names the horizon", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.locator(".add-note")).toHaveText("Adding to Today because you opened it from Today. Change below.");
  await expect(dialog.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".add-block")).toHaveClass(/is-ringed/);
  await expect(dialog.locator(".add-block")).not.toHaveClass(/is-ringed/, { timeout: 4_000 });
  await expect(dialog.getByTestId("add-task-submit")).toHaveText("Add to Today");

  // Changing the horizon changes the button, and the task lands there.
  await dialog.getByRole("button", { name: "Week", exact: true }).click();
  await expect(dialog.getByTestId("add-task-submit")).toHaveText("Add to This week");
  await dialog.getByTestId("add-task-title").fill("Book the Lisbon train");
  await dialog.getByRole("button", { name: "1h", exact: true }).click();
  await dialog.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("today-tasks-list").getByText("Book the Lisbon train")).toHaveCount(0);
});

test("opened from Plan: the note names the column it came from", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Horizons" }).click();
  await openRung(page, "week");
  await page.getByRole("button", { name: "Add to This week" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.locator(".add-note")).toContainText(/because you opened it from Plan · /);
  const pressed = (await dialog.locator(".add-block [aria-pressed='true']").first().innerText()).trim();
  expect(["Today", "Week", "Month", "Quarter", "6 mo", "Work"]).toContain(pressed);
});

test("a phone gets a bottom sheet; Escape closes it and Tab stays inside", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  const card = page.locator(".add-card");
  const box = await card.boundingBox();
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(891);
  expect(Math.round(box.width)).toBe(412);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    await expect(card.locator(":focus")).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

test("a laptop gets a 520px dialog, and ⌘↵ adds the task", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible();
  const box = await page.locator(".add-card").boundingBox();
  expect(Math.round(box.width)).toBe(520);
  expect(Math.round(box.x)).toBe((1280 - 520) / 2);
  await expect(dialog.locator(".add-kbd")).toBeVisible();
  await dialog.getByTestId("add-task-title").fill("Reply to Prof. Hale about the draft");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".add-card")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("today-tasks-list").getByText("Reply to Prof. Hale about the draft")).toBeVisible();
});

// The AI can suggest P4 and a length with no chip of its own (45m). Applying
// it must show both, not leave every chip unpressed while saving them.
test("an AI suggestion of P4 and 45m shows P4 and opens Other at 45m", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key"); } catch { /* private mode */ }
  });
  await page.route("https://api.groq.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      title: "File the June field notes", microStep: "Open the notes folder", priority: "P4",
      estimateMinutes: 45, horizonLevel: "today", subSteps: [],
    }) } }] }),
  }));
  await enterDemo(page);
  await openFromToday(page);
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByRole("button", { name: "Priority 4" })).toHaveCount(0);
  await dialog.getByTestId("add-task-title").fill("field notes");
  await dialog.getByRole("button", { name: "Ask AI to improve this" }).click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();

  await expect(dialog.getByRole("button", { name: "Priority 4" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Other", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Minutes")).toHaveValue("45");
});

// With no time chosen, nothing is shown as chosen — so nothing is saved: the
// task has no estimate, like one added from the wall, not a hidden 25m.
test("a task added without choosing a time is saved with no estimate", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key"); } catch { /* private mode */ }
  });
  const bodies = [];
  await page.route("https://api.groq.com/**", (route) => {
    bodies.push(route.request().postData() || "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "One small step." } }] }) });
  });
  await enterDemo(page);
  await openFromToday(page);
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByTestId("add-task-title").fill("Sort the museum receipts");
  for (const name of ["15m", "30m", "1h", "2h", "Other"]) {
    await expect(dialog.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
  }
  await dialog.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).toHaveCount(0, { timeout: 5_000 });

  // Coach's task context writes "(Nmin)" after a title only when it has one.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();
  await page.locator(".coach-composer-input").fill("what are my tasks");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => bodies.some(b => b.includes("Sort the museum receipts")), { timeout: 8_000 }).toBe(true);
  const body = bodies.find(b => b.includes("Sort the museum receipts"));
  expect(body).toContain("Sort the museum receipts {");
  expect(body).not.toContain("Sort the museum receipts (25min)");
});

// Codex review of #396, second round.
test("⌘↵ pressed again while the sheet says Saved adds the task once", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByTestId("add-task-title").fill("Order the spare lens cap");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".add-card")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("today-tasks-list").getByText("Order the spare lens cap")).toHaveCount(1);
});

test("opening Other shows 25m chosen, and 25m is what is saved", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key"); } catch { /* private mode */ }
  });
  const bodies = [];
  await page.route("https://api.groq.com/**", (route) => {
    bodies.push(route.request().postData() || "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "One small step." } }] }) });
  });
  await enterDemo(page);
  await openFromToday(page);
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByTestId("add-task-title").fill("Label the seed trays");
  await dialog.getByRole("button", { name: "Other", exact: true }).click();
  await expect(dialog.getByLabel("Minutes")).toHaveValue("25");
  await dialog.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).toHaveCount(0, { timeout: 5_000 });

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();
  await page.locator(".coach-composer-input").fill("what are my tasks");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => bodies.some(b => b.includes("Label the seed trays")), { timeout: 8_000 }).toBe(true);
  expect(bodies.find(b => b.includes("Label the seed trays"))).toContain("Label the seed trays (25min)");
});

// Q56.1 (64s–t): Add opens with Task | Thought. T opens on Thought from any
// tab; Enter saves it to Mind Box with a toast; Tab switches to Task.
test("T opens a thought anywhere; Enter saves it to Mind Box; Tab switches to Task", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("t");
  const dialog = page.getByRole("dialog", { name: "New thought" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Thought" })).toHaveAttribute("aria-checked", "true");
  const field = dialog.getByLabel("Thought");
  await expect(field).toBeFocused();
  await field.fill("Ask the gym about the Friday class");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Saved to Mind Box" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Mind Box", exact: true }).click();
  await expect(page.getByTestId("thought-row").first()).toContainText("Ask the gym about the Friday class");

  // Tab carries the text over to a task.
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("t");
  await page.getByRole("dialog", { name: "New thought" }).getByLabel("Thought").fill("Book the dentist");
  await page.keyboard.press("Tab");
  const task = page.getByRole("dialog", { name: "New task" });
  await expect(task.getByRole("radio", { name: "Task" })).toHaveAttribute("aria-checked", "true");
  await expect(task.getByTestId("add-task-title")).toHaveValue("Book the dentist");
});

test("N and + open on Task; the switch is there", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByRole("radio", { name: "Task" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: "Thought" }).click();
  await expect(page.getByRole("dialog", { name: "New thought" }).getByRole("button", { name: "Save thought" })).toBeDisabled();
});
