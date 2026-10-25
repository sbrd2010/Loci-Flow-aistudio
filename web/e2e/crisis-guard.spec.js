import { test, expect } from "@playwright/test";

// #554: crisis wording typed into a place that sends text to the AI provider is
// answered on the device. Coach and Rescue are covered in coach-chat.spec.js and
// deep-focus.spec.js; these are the other free-text paths.

async function enterDemo(page, viewport = { width: 412, height: 892 }) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("loci_today_peek_open", "1");
      window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
    } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

function recordGroq(page, reply = "[]") {
  const bodies = [];
  return page.route("https://api.groq.com/**", async (route) => {
    bodies.push(JSON.parse(route.request().postData()));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: reply } }] }),
    });
  }).then(() => bodies);
}

test("Mind Box: Organise answers a crisis thought here, keeps it, and organises the rest", async ({ page }) => {
  const bodies = await recordGroq(page);
  await enterDemo(page, { width: 1280, height: 900 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Mind Box", exact: true }).click();

  const input = page.locator(".mbx-field").getByRole("textbox", { name: "Thought" });
  await input.fill("I want to die");
  await input.press("Enter");
  await expect(page.getByTestId("thought-row").first()).toContainText("I want to die");

  await page.locator(".mbx-ai:visible").first().click();
  await expect(page.getByRole("status").filter({ hasText: /emergency services/i })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/kept out of the AI step/i)).toBeVisible();

  // The other thoughts still went; the crisis one did not.
  expect(bodies.length).toBeGreaterThan(0);
  const sent = JSON.stringify(bodies.map(b => b.messages));
  expect(sent).not.toMatch(/want to die/i);

  // And it is still in the Mind Box.
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.getByTestId("thought-row").first()).toContainText("I want to die");
});

test("Add task: Ask AI answers crisis wording here and sends nothing", async ({ page }) => {
  const bodies = await recordGroq(page);
  await enterDemo(page);
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));
  const add = page.locator(".today-list-add");
  if (await add.isVisible()) await add.click();
  else {
    // The open list can cover the wall's "+"; N opens the same dialog.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("n");
  }
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  await dialog.getByTestId("add-task-title").fill("I want to kill myself");
  await dialog.getByRole("button", { name: "Ask AI to improve this" }).click();

  await expect(dialog.getByText(/emergency services/i)).toBeVisible({ timeout: 5_000 });
  expect(bodies).toEqual([]);
  // The text is still in the field.
  await expect(dialog.getByTestId("add-task-title")).toHaveValue("I want to kill myself");
});
