import { test, expect } from "@playwright/test";

// AI Coach resilience tests run in demo mode and mock provider calls.
// They protect user-facing failure handling without spending real AI quota.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2026-06-04T15:30:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
}

async function seedGroqKey(page) {
  await page.evaluate(() => {
    localStorage.setItem("loci_groq_key", "test-groq-key");
    localStorage.removeItem("loci_gemini_key");
  });
}

async function seedDailyUsageAt119(page) {
  await page.evaluate(() => {
    const pad2 = (value) => String(value).padStart(2, "0");
    const date = new Date();
    const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const hour = `${day}T${pad2(date.getHours())}`;
    localStorage.setItem(`loci_ai_usage_v1:signed-out:day:${day}`, "119");
    localStorage.setItem(`loci_ai_usage_v1:signed-out:hour:${hour}`, "0");
  });
}

async function openCoach(page) {
  await seedGroqKey(page);
  await page.getByRole("button", { name: /AI Coach/i }).click();
  await expect(page.getByText(/Chat with/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".chat-input-row input")).toBeVisible({ timeout: 5_000 });
}

async function askCoach(page, text) {
  await page.locator(".chat-input-row input").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .card, .chat-window, .chat-bubble, .chat-input-row"
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

test("mobile reliability: AI Coach shows friendly rate-limit failure without crashing", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/openai/v1/chat/completions", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "rate limit" } }),
    });
  });

  await enterDemo(page);
  await openCoach(page);
  await askCoach(page, "What should I start next?");

  await expect(page.getByText(/Rate limit.*wait 30 sec and retry/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".chat-input-row input")).toBeEnabled({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});

test("mobile reliability: AI Coach displays the 100 percent daily usage warning", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/openai/v1/chat/completions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: "One tiny step is enough." } }],
      }),
    });
  });

  await enterDemo(page);
  await seedGroqKey(page);
  await seedDailyUsageAt119(page);
  await openCoach(page);
  await askCoach(page, "Give me a tiny first step.");

  await expect(page.getByText(/One tiny step is enough/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/AI usage note: this reply used your 120\/120 daily AI calls/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/pause after this until tomorrow/i)).toBeVisible({ timeout: 8_000 });
  await expectNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});
