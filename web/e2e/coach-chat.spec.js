import { test, expect } from "@playwright/test";

// Coach chat reliability: gpt-oss-120b (the reasoning model behind both Groq
// and Cerebras) can spend its whole completion budget on hidden reasoning
// before writing any visible reply, truncating or emptying Coach replies.
// This locks in the fix — reasoning_effort: "low" on every Coach callAI() —
// so it can't silently regress the way it did (only Mind Box/Roadmap had it).

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
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

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Chat with/ })).toBeVisible({ timeout: 8_000 });

  await page.getByPlaceholder(/Shift\+Enter for a new line/).fill("I feel a bit scattered right now");
  await page.getByRole("button", { name: "Send" }).click();

  // Two replies now carry this text: Coach opens with the proactive nudge (J3
  // moved it off Today and onto Coach's first line), then answers the message.
  // The subject here is the request body, not which paragraph rendered.
  await expect(page.getByText("Let's pick one tiny next step.").first()).toBeVisible({ timeout: 8_000 });

  expect(groqRequestBodies.length).toBeGreaterThan(0);
  for (const body of groqRequestBodies) {
    expect(body.reasoning_effort).toBe("low");
  }
});

// Release gate, mirroring the Rescue one in deep-focus.spec.js.
//
// Addendum H of the design handoff: "the crisis check is a property of every
// free-text path to the provider, not of one screen... a person in crisis will
// type into whatever box is open." Coach is the other box. Until this test
// existed, Coach had only prompt instructions telling the model how to answer,
// which fail if the model ignores them or the request never completes.
//
// Every provider is watched, not just Groq — callAI falls back through the
// chain, so watching one would pass while another was being hit.
const AI_PROVIDER_GLOBS = [
  "https://api.groq.com/**",
  "https://integrate.api.nvidia.com/**",
  "https://api.cerebras.ai/**",
  "https://generativelanguage.googleapis.com/**",
  "https://api.z.ai/**",
];

test("mobile reliability: Coach chat never reaches the AI provider on crisis language", async ({ page }) => {
  // A fake key makes hasAIKey true, so the composer takes the live-AI path —
  // the one the short-circuit has to guard.
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  const hits = [];
  for (const glob of AI_PROVIDER_GLOBS) {
    await page.route(glob, async (route) => {
      hits.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ choices: [{ message: { content: "A normal coach reply." } }] }),
      });
    });
  }

  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();

  const composer = page.getByPlaceholder(/Shift\+Enter for a new line/);
  await expect(composer).toBeVisible({ timeout: 10_000 });

  // A proactive nudge may legitimately call the provider on arrival; let it
  // settle and ignore it, so the assertion below is about THIS message only.
  await page.waitForTimeout(1500);
  hits.length = 0;

  await composer.fill("I want to kill myself");
  await page.keyboard.press("Enter");

  await expect(page.getByText(/emergency services/i)).toBeVisible({ timeout: 8_000 });
  expect(hits).toEqual([]);
});

test("mobile reliability: Coach still reaches the provider for an ordinary message", async ({ page }) => {
  // The guard above must not have turned the composer into a dead end.
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  const hits = [];
  for (const glob of AI_PROVIDER_GLOBS) {
    await page.route(glob, async (route) => {
      hits.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ choices: [{ message: { content: "Here is a normal reply." } }] }),
      });
    });
  }

  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();
  const composer = page.getByPlaceholder(/Shift\+Enter for a new line/);
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  hits.length = 0;

  await composer.fill("What should I work on next?");
  await page.keyboard.press("Enter");

  await expect.poll(() => hits.length, { timeout: 10_000 }).toBeGreaterThan(0);
});

// Brief, Phase 6: the coach said it couldn't find a task just finished. A
// casual message ("light" mode) carried no tasks at all. Every request now
// carries today's tasks with their status and the focus session.
test("a casual message to the coach still carries the task just marked done", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });
  const bodies = [];
  await page.route("https://api.groq.com/**", async (route) => {
    bodies.push(route.request().postData() || "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Nice one." } }] }) });
  });
  await enterDemo(page);

  const title = (await page.locator(".wall-title").innerText()).trim();
  await page.locator(".today-wall .wall-action", { hasText: "Mark done" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();
  // Not a task question — the kind of message that got no task list at all.
  await page.getByPlaceholder(/Shift\+Enter for a new line/).fill("I feel a bit scattered right now");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => bodies.some(b => b.includes("TODAY SNAPSHOT")), { timeout: 8_000 }).toBe(true);
  const body = JSON.parse(bodies.filter(b => b.includes("TODAY SNAPSHOT")).pop());
  const system = body.messages[0].content;
  expect(system).toMatch(new RegExp(`\\[done \\d\\d:\\d\\d\\] ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  expect(system).toContain("FOCUS SESSION:");
});
