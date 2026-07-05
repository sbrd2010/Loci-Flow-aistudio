import { test, expect } from "@playwright/test";

// Deep Focus reliability smoke tests run in demo mode so they do not mutate Firebase data.
// They protect the execution flow Rohan cares about most: pin task, focus, capture stray thought, return.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .focus-card, .focus-mode-overlay, .focus-mode-body, .focus-mode-task-panel, .focus-mode-controls, .focus-mode-dump-row"
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

test("mobile reliability: Deep Focus overlay supports pause, resume, and brain-dump capture", async ({ page }) => {
  await enterDemo(page);

  // Demo task demo-t1 is pinned — pinned section is immediately visible
  const pinnedSection = page.locator(".pinned-focus-section");
  await pinnedSection.scrollIntoViewIfNeeded();
  await expect(pinnedSection).toBeVisible({ timeout: 8_000 });
  await expect(pinnedSection).toContainText("PINNED FOCUS");

  // Open full-screen timer via Focus → button (starts timer immediately)
  await pinnedSection.locator(".pinned-focus-start-btn").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await expect(overlay.getByText("Deep Focus")).toBeVisible();
  await expect(overlay.getByRole("heading", { name: "Reply to the important message sitting in your inbox" })).toBeVisible();
  await expect(overlay.getByLabel("Pause timer")).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await overlay.getByLabel("Pause timer").click();
  await expect(overlay.getByText("Paused")).toBeVisible({ timeout: 5_000 });
  await expect(overlay.getByLabel("Start timer")).toBeVisible({ timeout: 5_000 });

  await overlay.getByLabel("Start timer").click();
  await expect(overlay.getByText("In progress")).toBeVisible({ timeout: 5_000 });

  const thought = "Remember to check parking after focus";
  const dumpInput = overlay.getByLabel("Capture a thought to Brain Dump");
  await dumpInput.fill(thought);
  await overlay.getByLabel("Save thought to Brain Dump").click();
  await expect(dumpInput).toHaveValue("");

  await overlay.getByLabel("Exit focus mode").click();
  await expect(overlay).not.toBeVisible({ timeout: 5_000 });

  await page.locator(".bottom-nav").getByRole("button", { name: "Mind Box" }).click();
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });
  // Brain dump items live in inbox only — open it to verify the captured thought is there
  await page.getByTestId("brain-dump-inbox-btn").click();
  await expect(page.getByText(thought)).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
});

test("mobile reliability: Rescue Mode is reachable from Today and from inside Deep Focus", async ({ page }) => {
  await enterDemo(page);

  // Today tab: the Rescue chip opens the same triage flow Mind Box's button opens.
  await page.locator("button.stuck-btn", { hasText: "Rescue" }).click();
  await expect(page.getByRole("heading", { name: "What's happening right now?" })).toBeVisible({ timeout: 5_000 });
  await page.getByText("Exit rescue mode").click();
  await expect(page.getByRole("heading", { name: "What's happening right now?" })).not.toBeVisible({ timeout: 5_000 });

  // Start a Deep Focus session, then reach Rescue Mode from inside it.
  const pinnedSection = page.locator(".pinned-focus-section");
  await pinnedSection.scrollIntoViewIfNeeded();
  await pinnedSection.locator(".pinned-focus-start-btn").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await expect(overlay.getByLabel("Pause timer")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Open Rescue Mode" }).click();
  await expect(page.getByRole("heading", { name: "What's happening right now?" })).toBeVisible({ timeout: 5_000 });

  // Opening Rescue Mode mid-session pauses the underlying focus timer.
  await expect(overlay.getByText("Paused")).toBeVisible({ timeout: 5_000 });

  await page.getByText("Exit rescue mode").click();
  await expect(page.getByRole("heading", { name: "What's happening right now?" })).not.toBeVisible({ timeout: 5_000 });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByLabel("Start timer")).toBeVisible({ timeout: 5_000 });

  await overlay.getByLabel("Exit focus mode").click();
  await expect(overlay).not.toBeVisible({ timeout: 5_000 });
});

test("mobile reliability: Rescue chat never reaches the AI provider on crisis language", async ({ page }) => {
  // A fake key makes hasKey true so Rescue chat takes the live-AI path (aiCall),
  // not the no-key offline path — this is the code path the safety short-circuit
  // in RescueMode.jsx's aiCall() must guard, so it's the one worth regression-testing.
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  let groqCalled = false;
  await page.route("https://api.groq.com/**", async (route) => {
    groqCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "Let's find one small step together." } }] }),
    });
  });

  await enterDemo(page);

  await page.locator("button.stuck-btn", { hasText: "Rescue" }).click();
  await expect(page.getByRole("heading", { name: "What's happening right now?" })).toBeVisible({ timeout: 5_000 });
  await page.getByText("Anxious / can't start").click();
  await page.getByText("Talk it through").click();

  // Opening chat sends a non-crisis opener ("I'm stuck and need help.") that legitimately
  // reaches the AI — wait for that real call to land before testing the safety short-circuit.
  await expect.poll(() => groqCalled, { timeout: 8_000 }).toBe(true);
  groqCalled = false;

  await page.getByPlaceholder(/Tell me what's going on/).fill("I want to kill myself");
  await page.keyboard.press("Enter");

  await expect(page.getByText(/emergency services/i)).toBeVisible({ timeout: 8_000 });
  expect(groqCalled).toBe(false);
});

test("mobile reliability: Rescue chat action tag starts an in-rescue timer", async ({ page }) => {
  await enterDemo(page);
  await page.evaluate(() => localStorage.setItem("loci_groq_key", "test-groq-key"));
  await page.route("https://api.groq.com/openai/v1/chat/completions", async route => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "Starting a five-minute reset. [[RESCUE_START_TIMER:5]]" } }] }),
    });
  });

  await page.locator("button.stuck-btn", { hasText: "Rescue" }).click();
  await page.getByText("Low energy / fog").click();
  await page.getByText("Talk to AI Coach").click();

  await expect(page.getByText("Relax. You'll start when this ends.")).toBeVisible({ timeout: 5_000 });
});

test("mobile reliability: Rescue chat is reachable again after skipping an AI-started timer", async ({ page }) => {
  await enterDemo(page);
  await page.evaluate(() => localStorage.setItem("loci_groq_key", "test-groq-key"));
  await page.route("https://api.groq.com/openai/v1/chat/completions", async route => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "Starting a five-minute reset. [[RESCUE_START_TIMER:5]]" } }] }),
    });
  });

  await page.locator("button.stuck-btn", { hasText: "Rescue" }).click();
  await page.getByText("Low energy / fog").click();
  await page.getByText("Talk to AI Coach").click();
  // The action tag moves the user from chat to the timer screen.
  await expect(page.getByText("Relax. You'll start when this ends.")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Skip timer" }).click();
  await page.getByText("Talk to AI Coach").click();
  // Regression: chatStarted only guards the opener message, not navigation —
  // this must actually land back on the chat screen, not silently no-op.
  await expect(page.getByPlaceholder("Tell me what's going on…")).toBeVisible({ timeout: 5_000 });
});

test("mobile reliability: Rescue does not park the task on an unprompted action tag", async ({ page }) => {
  await enterDemo(page);
  await page.evaluate(() => localStorage.setItem("loci_groq_key", "test-groq-key"));
  await page.route("https://api.groq.com/openai/v1/chat/completions", async route => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "Let's take a break from it. [[RESCUE_PARK_TASK]]" } }] }),
    });
  });

  const pinnedSection = page.locator(".pinned-focus-section");
  await pinnedSection.scrollIntoViewIfNeeded();
  await expect(pinnedSection).toContainText("Reply to the important message sitting in your inbox");

  // Opens Rescue on the pinned task via the Today-tab chip; the opener
  // message ("I'm stuck and need help.") never asks to park/defer/skip it —
  // filterApplicableRescueActions (rescueCoachPrompt.js) must block the tag.
  await page.locator("button.stuck-btn", { hasText: "Rescue" }).click();
  await page.getByText("Too much going on").click();
  await page.getByText("Talk to AI Coach").click();
  await expect(page.getByText("Let's take a break from it.")).toBeVisible({ timeout: 5_000 });

  await page.getByText("Exit rescue mode").click();
  await expect(pinnedSection).toContainText("Reply to the important message sitting in your inbox", { timeout: 5_000 });
});

test("mobile reliability: Rescue ignores an action tag that resolves after the user already exited", async ({ page }) => {
  await enterDemo(page);
  await page.evaluate(() => localStorage.setItem("loci_groq_key", "test-groq-key"));
  await page.route("https://api.groq.com/openai/v1/chat/completions", async route => {
    // Resolves well after the user has already exited Rescue below.
    await new Promise(r => setTimeout(r, 1500));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "Sounds good, taking a break from it. [[RESCUE_PARK_TASK]]" } }] }),
    });
  });

  const pinnedSection = page.locator(".pinned-focus-section");
  await pinnedSection.scrollIntoViewIfNeeded();
  await expect(pinnedSection).toContainText("Reply to the important message sitting in your inbox");

  await page.locator("button.stuck-btn", { hasText: "Rescue" }).click();
  await page.getByText("Too much going on").click();
  await page.getByText("Talk to AI Coach").click();

  // A message that DOES match park intent — if the reply arrived before exit,
  // this would legitimately park the task. It resolves only after Rescue is
  // dismissed below, so the mountedRef guard in RescueMode.jsx must drop it.
  await page.getByPlaceholder("Tell me what's going on…").fill("let's park this for later");
  await page.getByRole("button", { name: "↑" }).click();
  await page.getByText("Exit rescue mode").click();

  await page.waitForTimeout(2_000);
  await expect(pinnedSection).toContainText("Reply to the important message sitting in your inbox", { timeout: 5_000 });
});

test("mobile reliability: Rescue safety short-circuit does not call AI again", async ({ page }) => {
  await enterDemo(page);
  await page.evaluate(() => localStorage.setItem("loci_groq_key", "test-groq-key"));
  let aiCalls = 0;
  await page.route("https://api.groq.com/openai/v1/chat/completions", async route => {
    aiCalls += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "I’m here with you." } }] }),
    });
  });

  await page.locator("button.stuck-btn", { hasText: "Rescue" }).click();
  await page.getByText("Anxious / can't start").click();
  await page.getByText("Talk it through").click();
  await expect(page.getByText("I’m here with you.")).toBeVisible({ timeout: 5_000 });

  await page.getByPlaceholder("Tell me what's going on…").fill("I might hurt myself");
  await page.getByRole("button", { name: "↑" }).click();
  await expect(page.getByText("emergency services")).toBeVisible({ timeout: 5_000 });
  expect(aiCalls).toBe(1);
});
