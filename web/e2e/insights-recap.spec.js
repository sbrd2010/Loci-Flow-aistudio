import { test, expect } from "@playwright/test";

// Ask Coach (Insights → Ask Coach) reliability tests, run in Demo Mode so
// they never mutate Firebase data or call a real AI provider. Demo Mode has
// no uid, so persistent recap caching is intentionally disabled there (see
// insightsRecapCache.js) — these tests cover UI *interaction* states only
// (loading/success/refresh/error/range-switching/mobile overflow); cache
// get/set/overwrite/stale/reopen behavior is covered by
// insightsRecapCache.test.js in Vitest, not here.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date("2026-07-11T10:00:00"));
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openInsights(page) {
  await page.locator(".bottom-nav").getByRole("button", { name: "Mind Box" }).click();
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });
  await page.getByText("Insights", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible({ timeout: 5_000 });
}

function askCoachButton(page) {
  return page.locator(".insights-recap-btn");
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [document.documentElement.scrollWidth, document.body?.scrollWidth || 0];
    document.querySelectorAll(
      ".app-container, .screen-content, .insights-recap-box, .insights-recap-btn, .insights-recap-disclosure"
    ).forEach((el) => measured.push(el.scrollWidth));
    return { innerWidth: window.innerWidth, maxScrollWidth: Math.max(...measured) };
  });
  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

test("mobile reliability: Ask Coach shows the no-key state when no AI key is configured", async ({ page }) => {
  await enterDemo(page);
  await openInsights(page);

  await expect(page.getByText(/Add an AI key/)).toBeVisible();
  await expect(askCoachButton(page)).not.toBeVisible();
});

test("mobile reliability: Ask Coach generates and displays a recap, then Refresh regenerates it", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  const groqRequestBodies = [];
  let callCount = 0;
  await page.route("https://api.groq.com/**", async (route) => {
    callCount += 1;
    groqRequestBodies.push(JSON.parse(route.request().postData()));
    const content = callCount === 1
      ? "Loci recorded a steady pace this week. Nice work staying consistent."
      : "Refreshed: Loci recorded a steady pace this week, with a strong finish.";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    });
  });

  await enterDemo(page);
  await openInsights(page);

  await expect(askCoachButton(page)).toHaveText("Ask Coach");
  await askCoachButton(page).click();

  await expect(page.getByText("Loci recorded a steady pace this week. Nice work staying consistent.")).toBeVisible({ timeout: 8_000 });
  await expect(askCoachButton(page)).toHaveText("Refresh");

  // The request must never interpolate task titles into the system prompt —
  // the recap input travels as a single JSON data block in the user message
  // (unfenced — a fenced ```json block would let a task title containing
  // "```" appear to close it early).
  expect(groqRequestBodies[0].messages.some((m) => m.role === "user" && m.content.includes('"promptVersion"'))).toBe(true);
  expect(groqRequestBodies[0].messages.some((m) => m.role === "user" && m.content.includes("```"))).toBe(false);

  // Explicit Refresh — a second, independent generation that overwrites the display.
  await askCoachButton(page).click();
  await expect(page.getByText("Refreshed: Loci recorded a steady pace this week, with a strong finish.")).toBeVisible({ timeout: 8_000 });
  expect(groqRequestBodies.length).toBe(2);
});

test("mobile reliability: a provider failure shows an error state and offers a retry, without ever displaying as a recap", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  await page.route("https://api.groq.com/**", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "service unavailable" }) });
  });

  await enterDemo(page);
  await openInsights(page);

  await askCoachButton(page).click();
  await expect(page.locator(".insights-recap-error")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".insights-recap-box")).not.toBeVisible();
  // Still offers a retry — the button reverts to "Ask Coach", not stuck loading.
  await expect(askCoachButton(page)).toHaveText("Ask Coach");
  await expect(askCoachButton(page)).toBeEnabled();
});

test("mobile reliability: switching range hides a recap generated for a different range (stale-response protection)", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  await page.route("https://api.groq.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "This is the 7-day recap." } }] }),
    });
  });

  await enterDemo(page);
  await openInsights(page);

  await askCoachButton(page).click();
  await expect(page.getByText("This is the 7-day recap.")).toBeVisible({ timeout: 8_000 });

  // Switching to 30 Days is a different (uid, rangeKey, inputSignature) identity —
  // the 7-day recap must not remain visible under the new range.
  await page.locator(".insights-range-row").getByRole("button", { name: "30 Days" }).click();
  await expect(page.getByText("This is the 7-day recap.")).not.toBeVisible();
  await expect(askCoachButton(page)).toHaveText("Ask Coach");
});

test("mobile reliability: an out-of-order-resolving request never displays over, or clears the loading state of, a newer request", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  let resolveA;
  let resolveB;
  const pendingA = new Promise((r) => { resolveA = r; });
  const pendingB = new Promise((r) => { resolveB = r; });
  let requestCount = 0;

  await page.route("https://api.groq.com/**", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await pendingA;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Recap A (7d, first request)." } }] }) });
    } else {
      await pendingB;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Recap B (30d, second request)." } }] }) });
    }
  });

  await enterDemo(page);
  await openInsights(page);

  // Start 7d request A.
  await askCoachButton(page).click();
  await expect(askCoachButton(page)).toHaveText("Analyzing…");

  // Switch to 30 Days and start request B.
  await page.locator(".insights-range-row").getByRole("button", { name: "30 Days" }).click();
  await askCoachButton(page).click();
  await expect(askCoachButton(page)).toHaveText("Analyzing…");

  // Resolve A first (out of order) — it must neither display nor clear B's loading state.
  resolveA();
  await page.waitForTimeout(300);
  await expect(page.getByText("Recap A (7d, first request).")).not.toBeVisible();
  await expect(askCoachButton(page)).toHaveText("Analyzing…");

  // Resolve B — only B ever displays.
  resolveB();
  await expect(page.getByText("Recap B (30d, second request).")).toBeVisible({ timeout: 8_000 });
  await expect(askCoachButton(page)).toHaveText("Refresh");
});

test("mobile reliability: 7 Days -> 30 Days -> 7 Days while the original request is still pending starts a genuinely new request, not a silent no-op", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
  });

  let resolveFirst;
  const pendingFirst = new Promise((r) => { resolveFirst = r; });
  let requestCount = 0;

  await page.route("https://api.groq.com/**", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await pendingFirst; // simulates a request that's still pending when the user revisits 7 Days
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Stale first recap." } }] }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Fresh second recap." } }] }) });
    }
  });

  await enterDemo(page);
  await openInsights(page);

  await askCoachButton(page).click(); // request A on 7 Days, left pending
  await page.locator(".insights-range-row").getByRole("button", { name: "30 Days" }).click();
  await page.locator(".insights-range-row").getByRole("button", { name: "7 Days" }).click();

  // The second tap for 7 Days must start a genuinely new request, not silently no-op.
  await askCoachButton(page).click();
  await expect(page.getByText("Fresh second recap.")).toBeVisible({ timeout: 8_000 });
  expect(requestCount).toBe(2);

  resolveFirst(); // let the still-pending original settle, just to clean up
});

const PHONE_VIEWPORTS = [
  { name: "iPhone 11 Pro", width: 375, height: 812 },
  { name: "Pixel 6a", width: 412, height: 915 },
];

for (const viewport of PHONE_VIEWPORTS) {
  test(`mobile reliability: Ask Coach has no horizontal overflow on ${viewport.name}, before and after generating a recap`, async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("loci_groq_key", "test-key-not-a-real-key");
    });
    await page.route("https://api.groq.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: "Loci recorded steady progress. Here are a few observations:\n\n- Kept a consistent daily pace\n- Completed a mix of Work and Health tasks\n- No single day dominated the week" } }],
        }),
      });
    });

    await enterDemo(page, viewport);
    await openInsights(page);
    await expectNoHorizontalOverflow(page);

    await askCoachButton(page).click();
    await expect(page.locator(".insights-recap-box")).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);
  });
}
