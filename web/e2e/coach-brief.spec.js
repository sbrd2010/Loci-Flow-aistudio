import { test, expect } from "@playwright/test";

// Coach's brief (Q51, 62a–b, 62h): runs only on "Brief me", shows its groups,
// every action is a button with Undo, and "Ask about this" takes the brief to
// Chat as a chip. Demo mode with a mocked provider; nothing reaches Firebase.

async function openReview(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();
  await page.getByRole("tab", { name: "Review" }).click();
  return page.getByRole("complementary", { name: "Coach's brief" });
}

test("Brief me shows the groups; buttons apply with Undo; Ask about this goes to Chat", async ({ page }) => {
  const bodies = [];
  await page.route("https://api.groq.com/**", async (route) => {
    const body = JSON.parse(route.request().postData());
    bodies.push(body);
    const isBrief = body.messages.some(m => m.role === "system" && m.content.includes("Coach's brief"));
    const content = isBrief
      ? JSON.stringify({
        howItWent: ["2 ticked this week, against 0 the week before."],
        patterns: ["Saturdays are your best day over 30 days."],
        tooMuch: { line: "1h15m on Today, 16h left.", items: [{ task: "T2", to: "week" }] },
        next: { task: "T2", line: "First step: close the other tabs." },
      })
      : "The brief says start with the first one.";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) });
  });
  const brief = await openReview(page);
  await expect(brief.getByText("Sends summary numbers and up to 10 task titles to your AI provider.")).toBeVisible();
  // Nothing runs until asked.
  const briefCalls = () => bodies.filter(b => b.messages.some(m => m.role === "system" && m.content.includes("Coach's brief")));
  expect(briefCalls()).toHaveLength(0);
  await brief.getByRole("button", { name: "Brief me" }).click();

  await expect(brief.getByRole("heading", { name: "How it went" })).toBeVisible({ timeout: 8_000 });
  await expect(brief).toContainText("2 ticked this week, against 0 the week before.");
  await expect(brief.getByRole("heading", { name: "Too much planned" })).toBeVisible();
  expect(briefCalls()).toHaveLength(1);
  const sent = JSON.parse(briefCalls()[0].messages.find(m => m.role === "user").content);
  expect(Object.keys(sent)).toEqual(expect.arrayContaining(["today", "last7", "last30", "tasks"]));
  expect(sent.tasks.length).toBeLessThanOrEqual(10);

  await brief.getByRole("button", { name: "Make it the one thing" }).click();
  await expect(brief.locator(".br-applied").first()).toContainText("✓ The one thing ·");
  await brief.getByRole("button", { name: "Undo" }).click();
  await expect(brief.getByRole("button", { name: "Make it the one thing" })).toBeVisible();

  await brief.getByRole("button", { name: "This week" }).click();
  await expect(brief).toContainText("✓ Moved to This week");

  await brief.getByRole("button", { name: "Ask about this →" }).click();
  await expect(page.getByRole("tab", { name: "Chat", selected: true })).toBeVisible();
  await expect(page.locator(".coach-composer .coach-stuck-chip")).toContainText(/^Brief · 15 Jun \d\d:\d\d/);
  await page.getByPlaceholder("Ask about the brief…").fill("Which one first?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("The brief says start with the first one.").first()).toBeVisible({ timeout: 8_000 });
  expect(JSON.stringify(bodies.at(-1))).toContain("COACH'S BRIEF");
  await expect(page.locator(".coach-composer .coach-stuck-chip")).toHaveCount(0);
});

test("a failed brief says so and offers Brief me again", async ({ page }) => {
  await page.route("https://api.groq.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Sorry, no JSON here." } }] }) }));
  const brief = await openReview(page);
  await brief.getByRole("button", { name: "Brief me" }).click();
  await expect(brief.getByRole("alert")).toHaveText("Couldn’t reach Coach. Try again.", { timeout: 8_000 });
  await expect(brief.getByRole("button", { name: "Brief me" })).toBeVisible();
});
