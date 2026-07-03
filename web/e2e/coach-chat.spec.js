import { test, expect } from "@playwright/test";

// Coach chat reliability: gpt-oss-120b (the reasoning model behind both Groq
// and Cerebras) can spend its whole completion budget on hidden reasoning
// before writing any visible reply, truncating or emptying Coach replies.
// This locks in the fix — reasoning_effort: "low" on every Coach callAI() —
// so it can't silently regress the way it did (only Mind Box/Roadmap had it).

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

test("mobile reliability: Coach chat sends reasoning_effort low to Groq", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  const groqRequestBodies = [];
  await page.route("https://api.groq.com/**", async (route) => {
    groqRequestBodies.push(JSON.parse(route.request().postData()));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "Let's pick one tiny next step." } }] }),
    });
  });

  await enterDemo(page);

  await page.locator(".bottom-nav").getByRole("button", { name: "AI Coach" }).click();
  await expect(page.getByRole("heading", { name: /Chat with/ })).toBeVisible({ timeout: 8_000 });

  await page.getByPlaceholder(/Shift\+Enter for a new line/).fill("I feel a bit scattered right now");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Let's pick one tiny next step.")).toBeVisible({ timeout: 8_000 });

  expect(groqRequestBodies.length).toBeGreaterThan(0);
  for (const body of groqRequestBodies) {
    expect(body.reasoning_effort).toBe("low");
  }
});
