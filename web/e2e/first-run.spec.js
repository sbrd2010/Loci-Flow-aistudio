import { test, expect } from "@playwright/test";

// #653: a new account's first run, end to end, in demo mode (no Firebase, no
// AI). The fixture marks onboarding as not done, so the welcome appears.
// The three tasks a real new account starts with (useSync.js STARTER_TASKS).
const STARTERS = [
  { title: "Write down the one thing that matters most today", concreteStep: "Add it as a task, then open it and tap 'Do this now'.", priority: "P1", category: "Personal", timeEstimateMinutes: 10 },
  { title: "Try one 25-minute focus session", concreteStep: "Tap 'Start focus' on your Now task.", priority: "P2", category: "Work", timeEstimateMinutes: 25 },
  { title: "Take a short walk to reset", concreteStep: "Put on shoes and walk 10 minutes", priority: "P4", category: "Health", timeEstimateMinutes: 15 },
].map((fields, i) => ({
  id: 1000 + i, userId: "demo", uuid: `starter-${i}`, horizonLevel: "today", deadlineTimestamp: null, isCompleted: false, isParked: false,
  isNowFocus: false, orderIndex: i, dateCompletedString: null, isDeleted: false, lastUpdated: 1, subSteps: [], ...fields,
}));

async function newAccount(page, width, height, tasks = []) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(seed => {
    window.__LOCI_DEMO_FIXTURE__ = () => ({
      userId: "demo", tasks: seed, contributions: [], brainDump: [],
      config: { userId: "demo", userName: "Sample", isOnboardingCompleted: false, dayStartHour: 0, dayEndHour: 24 },
      timestamp: Date.now(),
    });
  }, tasks);
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.getByRole("heading", { name: "A calmer way to get things done." })).toBeVisible();
}

const guide = (page) => page.getByRole("complementary", { name: "Guide" });

for (const [label, width, height, tasks] of [["phone", 390, 844, []], ["small phone, starter tasks", 375, 812, STARTERS], ["laptop, starter tasks", 1280, 720, STARTERS]]) {
  test(`${label}: first task, Do this now, the tour, then the person's own Start focus`, async ({ page }) => {
    await newAccount(page, width, height, tasks);
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
    // Only the person's own task is outlined, never a starter task.
    const own = page.locator('[data-guide-id="upnext"] [data-guide-own]');
    await expect(own).toHaveCount(1);
    await expect(own).toContainText("Reply to the landlord");
    // The real path: open the task, then its own Do this now.
    await own.click();
    await page.getByRole("button", { name: /Do this now/ }).click();

    await expect(guide(page)).toContainText("Your task is ready");
    await guide(page).getByRole("button", { name: "Show me around · 90 s" }).click();
    await expect(guide(page)).toContainText("TOUR · 1 OF 5");
    await guide(page).getByRole("button", { name: "Next" }).click();
    await expect(guide(page)).toContainText("Up next and Day map");
    // Day map is opened, not only named: the real page, then on with the tour.
    await guide(page).getByRole("button", { name: "Open Day map" }).click();
    await expect(page.locator(".day-map-page")).toBeVisible();
    await expect(guide(page)).toContainText("Up next and Day map");
    await guide(page).getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Brain dump", exact: true })).toBeVisible();
    if (label === "phone") {
      // A thought really saved: acknowledged, and the tour carries on.
      const field = page.locator(".mbx-field").getByRole("textbox", { name: "Thought" });
      await field.fill("Call the plumber about the tap");
      await field.press("Control+Enter");
      await expect(guide(page)).toContainText("Added to Mind Box.");
      await guide(page).getByRole("button", { name: "Next" }).click();
    } else {
      await guide(page).getByRole("button", { name: "Later" }).click();
    }
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

test("a double tap on Add task saves one task, not two", async ({ page }) => {
  await newAccount(page, 390, 844);
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await page.getByRole("button", { name: "Skip this question" }).click();
  await page.getByLabel("What do you want to do?").fill("Book the dentist");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("First step").fill("Find the number");
  await page.getByRole("dialog").getByRole("button", { name: "Add task", exact: true }).dblclick();
  await expect(guide(page)).toContainText("Make it your one thing");
  // The second tap does not fall through to the tab bar, and one task is saved.
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-guide-id="upnext"]').getByText("Book the dentist")).toHaveCount(1);
});

test("phone: at Ready the guide card leaves the Now card's buttons clear", async ({ page }) => {
  await newAccount(page, 375, 812, STARTERS);
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await page.getByRole("button", { name: "Skip this question" }).click();
  await page.getByLabel("What do you want to do?").fill("Book the dentist");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "This is already small" }).click();
  await page.locator('[data-guide-id="upnext"] [data-guide-own]').click();
  await page.getByRole("button", { name: /Do this now/ }).click();
  await expect(guide(page)).toContainText("Your task is ready");
  // Scrolled to the end, nothing on the wall sits under the card.
  await page.locator(".screen-content").evaluate(el => el.scrollTo(0, el.scrollHeight));
  const card = await guide(page).boundingBox();
  const hero = await page.locator('[data-guide-id="now"]').boundingBox();
  expect(hero.y + hero.height).toBeLessThanOrEqual(card.y);
});

test("Replay the tour with nothing on Today is the tour, not a new-task step, and ends without Start focus", async ({ page }) => {
  await newAccount(page, 390, 844);
  await page.getByRole("button", { name: "Skip setup, show me the app" }).click();
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Replay the tour/ }).click();
  await expect(guide(page)).toContainText("TOUR · 1 OF 5");
  await expect(guide(page)).toContainText("shows here once you");
  await expect(page.getByRole("dialog", { name: "Write down one real thing" })).toHaveCount(0);
  for (const name of ["Next", "Next", "Later", "Next", "Finish"]) await guide(page).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tour done." })).toBeVisible();
  await expect(page.locator('[data-guide-id="start"]')).toHaveCount(0);
});

test("finishing the guided task during the tour ends it quietly, without ringing Start focus", async ({ page }) => {
  await newAccount(page, 390, 844);
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await page.getByRole("button", { name: "Skip this question" }).click();
  await page.getByLabel("What do you want to do?").fill("Book the dentist");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "This is already small" }).click();
  await page.locator('[data-guide-id="upnext"] [data-guide-own]').click();
  await page.getByRole("button", { name: /Do this now/ }).click();
  await guide(page).getByRole("button", { name: "Show me around · 90 s" }).click();
  // Done on the wall's own control, mid-tour (as another device could).
  await page.locator(".wall-quiet-link:visible", { hasText: /^Done$/ }).click();
  for (const name of ["Next", "Next", "Later", "Next", "Finish"]) await guide(page).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tour done." })).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
});

// To Ready with a task of their own, the shortest way.
async function toReady(page) {
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await page.getByRole("button", { name: "Skip this question" }).click();
  await page.getByLabel("What do you want to do?").fill("Book the dentist");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "This is already small" }).click();
  await page.locator('[data-guide-id="upnext"] [data-guide-own]').click();
  await page.getByRole("button", { name: /Do this now/ }).click();
  await expect(guide(page)).toContainText("Your task is ready");
}

test("laptop: Esc on the Day map goes back and keeps the tour", async ({ page }) => {
  await newAccount(page, 1280, 720, STARTERS);
  await toReady(page);
  await guide(page).getByRole("button", { name: "Show me around · 90 s" }).click();
  await guide(page).getByRole("button", { name: "Next" }).click();
  await guide(page).getByRole("button", { name: "Open Day map" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".day-map-page")).toHaveCount(0);
  await expect(guide(page)).toContainText("Up next and Day map");
});

test("Coach stays out of reach at its stop, also after leaving its tab and coming back", async ({ page }) => {
  await newAccount(page, 390, 844);
  await toReady(page);
  await guide(page).getByRole("button", { name: "Show me around · 90 s" }).click();
  for (const name of ["Next", "Next", "Later", "Next"]) await guide(page).getByRole("button", { name, exact: true }).click();
  await expect(page.locator('[data-guide-id="coach"]')).toHaveAttribute("inert", "");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Today" }).click();
  await nav.getByRole("button", { name: "Coach" }).click();
  await expect(page.locator('[data-guide-id="coach"]')).toHaveAttribute("inert", "");
  await guide(page).getByRole("button", { name: "Finish" }).click();
  await expect(page.locator("[inert]")).toHaveCount(0);
});

test("the first-task sheet keeps focus inside it, and app shortcuts don't fire behind it", async ({ page }) => {
  await newAccount(page, 1280, 720, STARTERS);
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await page.getByRole("button", { name: "Skip this question" }).click();
  const sheet = page.getByRole("dialog", { name: "Write down one real thing" });
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await sheet.getByRole("button", { name: "Skip guide" }).focus();
  await page.keyboard.press("n");
  await page.keyboard.press("l");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(sheet).toBeVisible();
});

test("each demo is a fresh visit: no tour left over from the last one", async ({ page }) => {
  await newAccount(page, 390, 844);
  await page.getByRole("button", { name: "Skip setup, show me the app" }).click();
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Replay the tour/ }).click();
  await expect(guide(page)).toContainText("TOUR · 1 OF 5");
  await page.getByRole("button", { name: "Exit" }).click();
  await page.getByTestId("demo-btn").click();
  await page.getByRole("button", { name: "Skip setup, show me the app" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
});

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
