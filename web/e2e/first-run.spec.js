import { test, expect } from "@playwright/test";

// #653: a new account's first run, end to end, in demo mode (no Firebase, no
// AI). The fixture marks onboarding as not done, so the welcome appears.
async function newAccount(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.__LOCI_DEMO_FIXTURE__ = () => ({
      userId: "demo", tasks: [], contributions: [], brainDump: [],
      config: { userId: "demo", userName: "Sample", isOnboardingCompleted: false, dayStartHour: 0, dayEndHour: 24 },
      timestamp: Date.now(),
    });
  });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.getByRole("heading", { name: "A calmer way to get things done." })).toBeVisible();
}

const guide = (page) => page.getByRole("complementary", { name: "Guide" });

for (const [label, width, height] of [["phone", 390, 844], ["laptop", 1280, 720]]) {
  test(`${label}: first task, Do this now, the tour, then the person's own Start focus`, async ({ page }) => {
    await newAccount(page, width, height);
    await page.getByRole("button", { name: "Let’s begin" }).click();
    await page.getByRole("button", { name: "Help me just start" }).click();
    await expect(page.getByText("Coach will start from there.")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    const sheet = page.getByRole("dialog", { name: "Write down one real thing" });
    await sheet.getByLabel("What do you want to do?").fill("Reply to the landlord");
    await sheet.getByRole("button", { name: "Next" }).click();
    const stepSheet = page.getByRole("dialog", { name: "What’s the smallest thing you could do first?" });
    await stepSheet.getByLabel("First step").fill("Open the lease email");
    await stepSheet.getByRole("button", { name: "Add task", exact: true }).click();

    await expect(guide(page)).toContainText("Make it your one thing");
    // The real path: open the task, then its own Do this now.
    await page.locator('[data-guide-id="upnext"]').getByText("Reply to the landlord").first().click();
    await page.getByRole("button", { name: /Do this now/ }).click();

    await expect(guide(page)).toContainText("Your task is ready");
    await guide(page).getByRole("button", { name: "Show me around · 90 s" }).click();
    await expect(guide(page)).toContainText("TOUR · 1 OF 5");
    await guide(page).getByRole("button", { name: "Next" }).click();
    await expect(guide(page)).toContainText("Up next and Day map");
    await guide(page).getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Brain dump", exact: true })).toBeVisible();
    await guide(page).getByRole("button", { name: "Later" }).click();
    await expect(guide(page)).toContainText("TOUR · 4 OF 5");
    await guide(page).getByRole("button", { name: "Next" }).click();

    await expect(guide(page)).toContainText("EXAMPLE — WRITTEN IN ADVANCE, NOT LIVE");
    // The answer "Help me just start" opens the "I'm stuck" example.
    await expect(guide(page).getByRole("button", { name: "I’m stuck" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-guide-id="coach"]')).toHaveAttribute("inert", "");
    await guide(page).getByRole("button", { name: "Finish" }).click();

    // Back on Today: the tour ends at Start focus, which only the person presses.
    await expect(guide(page)).toContainText("That’s the tour");
    await expect(page.locator('[data-guide-id="coach"]')).toHaveCount(0);
    await page.locator('[data-guide-id="start"]').click();
    await expect(guide(page)).toHaveCount(0);
  });
}

test("Skip setup opens the app with no guide", async ({ page }) => {
  await newAccount(page, 390, 844);
  await page.getByRole("button", { name: "Skip setup, show me the app" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Write down one real thing" })).toHaveCount(0);
});

test("Skip guide on the first-task sheet leaves a short note, and Esc does not reopen it", async ({ page }) => {
  await newAccount(page, 390, 844);
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await page.getByRole("button", { name: "Skip this question" }).click();
  await page.getByRole("button", { name: "Skip guide" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guide closed." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Write down one real thing" })).toHaveCount(0);
});
