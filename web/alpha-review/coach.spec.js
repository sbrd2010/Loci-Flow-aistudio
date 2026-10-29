import { test, expect } from "@playwright/test";
import { user, seed, payload, database, isolate, login } from "./local-fixture.js";

const openCoach = page => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();

test("a saved proposal for a deleted task cannot complete a different task with the same title", async ({ page, context }) => {
  const u = await user();
  const p = payload(u);
  p.tasks = [{ ...p.tasks[0], isDeleted: true }, { ...p.tasks[0], id: 2, uuid: "different-task", isCompleted: false }];
  p.chatHistory = [{ isUser: false, text: "A synthetic proposal.", at: Date.now(), actions: [{
    id: "review-proposal", type: "COMPLETE_TASK", title: p.tasks[0].title,
    state: "proposed", matched: true, task: { uuid: "review-task", title: p.tasks[0].title },
  }] }];
  await seed(u, p); await isolate(context); await login(page, u, false); await openCoach(page);
  await page.locator(".coach-reply-actions .coach-task-chip").click();
  await expect(page.getByText("No longer on your list · Synthetic review task")).toBeVisible();
  const saved = await (await database(u, `sync/${u.uid}`)).json();
  expect(saved.tasks.find(t => t.uuid === "different-task").isCompleted).toBe(false);
});

test("untrusted Coach Markdown cannot execute HTML, open script URLs, or load tracking images", async ({ page, context }) => {
  const u = await user();
  const p = payload(u);
  p.chatHistory = [{ isUser: false, at: Date.now(), text: '<img src=x onerror="window.reviewXss=1">\n\n[unsafe](javascript:window.reviewXss=2)\n\n![review tracker](https://review-tracker.invalid/pixel)' }];
  await seed(u, p); const blocked = await isolate(context); await login(page, u, false); await openCoach(page);
  await expect(page.locator(".coach-md").last()).toContainText("review tracker");
  expect(await page.evaluate(() => window.reviewXss)).toBeUndefined();
  await expect(page.locator('.coach-md img, .coach-md [onerror], .coach-md a[href^="javascript:"]')).toHaveCount(0);
  expect(blocked.filter(url => url.includes("review-tracker.invalid"))).toEqual([]);
});

test("an unsent Coach draft is cleared on an account switch", async ({ page, context }) => {
  const a = await user(), b = await user(); await seed(a); await seed(b);
  await isolate(context); await login(page, a, false); await openCoach(page);
  await page.locator(".coach-composer-input").fill("Synthetic private draft from account A");
  await page.evaluate(async email => {
    const firebase = await import("/src/firebase.js");
    await firebase.reviewSignOut(); await firebase.reviewSignIn(email);
  }, b.email);
  await expect(page.locator(".app-container")).toBeVisible();
  await openCoach(page);
  await expect(page.locator(".coach-composer-input")).toHaveValue("");
});

test("a delayed AI reply from A cannot overwrite B's chat or make B's app unusable", async ({ page, context }) => {
  const a = await user(), b = await user(); await seed(a); await seed(b);
  await isolate(context);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let called = false;
  await context.route("https://api.groq.com/**", async route => {
    called = true;
    await gate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      choices: [{ message: { content: "Synthetic delayed answer for account A" }, finish_reason: "stop" }],
      usage: { total_tokens: 20 },
    }) });
  });
  await login(page, a, false);
  await page.evaluate(() => {
    localStorage.setItem("loci_groq_key", "synthetic-key");
    localStorage.setItem("loci_provider_pref", "groq");
    localStorage.setItem("loci_provider_only", "1");
  });
  await openCoach(page);
  await page.locator(".coach-composer-input").fill("Help me choose a small first step");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => called).toBe(true);
  await page.evaluate(async email => {
    const firebase = await import("/src/firebase.js");
    await firebase.reviewSignOut(); await firebase.reviewSignIn(email);
  }, b.email);
  await expect(page.locator(".app-container")).toBeVisible();
  release();
  await openCoach(page);
  await expect(page.locator(".coach-composer-input")).toBeEnabled();
  await expect(page.locator(".app-container")).toBeVisible();
  await expect(page.getByText("Synthetic delayed answer for account A", { exact: true })).toHaveCount(0);
  const saved = await (await database(b, `sync/${b.uid}`)).json();
  expect(JSON.stringify(saved)).not.toContain("Synthetic delayed answer for account A");
});
