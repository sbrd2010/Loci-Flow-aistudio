import { test, expect } from "@playwright/test";

// Settings reliability smoke tests run in demo mode so they do not mutate Firebase user data.
// The bug-report form is opened and validated but not submitted, because submit writes to Firebase.

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

// The four tabs are in the main navigation (the bottom bar on phones and
// tablets, the header on a laptop); Settings is the header's gear.
async function openTab(page, name) {
  if (name === "Settings") {
    await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
    return;
  }
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .card, .modal-card, .tab-bar"
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

// Settings (44a–k): one list of groups on a phone, each row a page with
// "< Settings" back; from 840px a list of sections beside the chosen one.
// Nothing has a Save button — everything saves as it changes.


test("mobile reliability: Settings is grouped lists; privacy, bug report and demo sign-out still work", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");

  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 8_000 });
  for (const group of ["The day", "Your goal", "Coach", "Appearance", "Notifications", "Data", "Support"]) {
    await expect(page.getByRole("region", { name: group })).toBeVisible();
  }
  await expect(page.getByText(/\bXP\b/)).toHaveCount(0);
  await expect(page.getByText(/NVIDIA/i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Privacy policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("What we store")).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toHaveCount(0);

  await page.getByRole("button", { name: "Report a bug" }).click();
  const bug = page.getByRole("dialog", { name: "Report a bug" });
  await expect(bug).toBeVisible();
  await expect(bug.getByRole("button", { name: "Send report" })).toBeDisabled();
  await page.locator("#bug-what").fill("Settings smoke test opened the report form without sending.");
  await expect(bug.getByRole("button", { name: "Send report" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await bug.getByRole("button", { name: "Close" }).click();
  await expect(bug).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out of Loci" }).click();
  await expect(page.getByText("Sign out? Your data stays saved.")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 8_000 });
});

test("mobile reliability: the profile name saves as you type, with no Save button", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  await page.locator(".set-profile").click();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save/ })).toHaveCount(0);
  await page.locator("#settings-name").fill("Ines Varga");
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
  await expect(page.locator(".set-profile-name")).toHaveText("Ines Varga");
});

test("mobile reliability: the Evening check-in switch persists off", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  const sw = page.getByRole("switch", { name: "Evening check-in" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  // Away and back: read from the saved config, not local state.
  await openTab(page, "Today");
  await openTab(page, "Settings");
  await expect(page.getByRole("switch", { name: "Evening check-in" })).toHaveAttribute("aria-checked", "false");
});

test("Focus windows: the row sums them and names the day end; removing them all falls back to 07:00–24:00", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  // The demo's old 07:00–02:00 hours are one window it set, not "Not set".
  await expect(page.getByRole("button", { name: /^Focus windows/ })).toContainText("1 window · 19h · day ends 02:00");
  await page.getByRole("button", { name: /^Focus windows/ }).click();
  await expect(page.getByLabel("Focus window 1 start time")).toHaveValue("07:00");

  await page.getByRole("button", { name: "Remove focus window 1" }).click();
  await page.getByRole("button", { name: "Add a window" }).click();
  await page.getByLabel("Focus window 1 end time").fill("12:00");
  await page.getByRole("button", { name: "Add a window" }).click();
  await page.getByLabel("Focus window 2 start time").fill("13:00");
  await page.getByLabel("Focus window 2 end time").fill("17:15");
  await expect(page.locator(".set-facts")).toContainText("7h15m");
  await expect(page.locator(".set-facts")).toContainText("17:15");
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
  await expect(page.getByRole("button", { name: /^Focus windows/ })).toContainText("2 windows · 7h15m · day ends 17:15");

  await page.getByRole("button", { name: /^Focus windows/ }).click();
  await page.getByRole("button", { name: "Remove focus window 2" }).click();
  await page.getByRole("button", { name: "Remove focus window 1" }).click();
  await expect(page.locator(".set-facts")).toContainText("24:00");
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
  // Not the old 02:00: the first edit retired those hours.
  await expect(page.getByRole("button", { name: /^Focus windows/ })).toContainText("Not set · 07:00–24:00");
});

test("the coach page: name, tone and notes save as they change", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  await page.getByRole("button", { name: /Tone and profile/ }).click();
  await page.locator("#settings-mentor").fill("Yoda");
  await expect(page.getByRole("heading", { name: "Yoda", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Direct" }).click();
  await expect(page.getByRole("button", { name: "Direct" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
  await expect(page.getByRole("button", { name: /Tone and profile/ })).toContainText("Yoda");
  await page.getByRole("button", { name: /Tone and profile/ }).click();
  await expect(page.getByRole("button", { name: "Direct" })).toHaveAttribute("aria-pressed", "true");
});

test("AI provider: Auto, Groq, Cerebras, Gemini, Z.ai — no NVIDIA; a key is added, shown masked and removed", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  await page.getByRole("button", { name: /^AI provider/ }).click();
  const radios = page.getByRole("radiogroup", { name: "AI provider" }).getByRole("radio");
  await expect(radios).toHaveText([/Auto \(recommended\)/, /Groq/, /Cerebras/, /Gemini/, /Z\.ai/]);
  await expect(page.getByText(/NVIDIA/i)).toHaveCount(0);
  await page.getByRole("radio", { name: /^Gemini/ }).click();
  await expect(page.getByRole("radio", { name: /^Gemini/ })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: /^Groq/ }).click();
  const sheet = page.getByRole("dialog", { name: "Groq key" });
  await sheet.getByLabel("Key").fill("gsk_example_not_real_4f2a");
  await sheet.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("button", { name: /^Groq/ })).toContainText("Saved · ••••4f2a");
  await page.getByRole("button", { name: /^Groq/ }).click();
  await page.getByRole("dialog", { name: "Groq key" }).getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByRole("button", { name: /^Groq/ })).not.toContainText("Saved");
});

test("Key deadline: a preview of the band, and Clear goal", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  await page.getByRole("button", { name: /^Key deadline/ }).click();
  await page.getByLabel("Deadline").fill("2024-06-25");
  await expect(page.locator(".set-preview")).toContainText("10 days left");
  await page.getByRole("button", { name: "Clear goal" }).click();
  await expect(page.locator(".set-preview")).toContainText("Set a deadline");
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
  await expect(page.getByRole("button", { name: /^Key deadline/ })).toContainText("Not set");
});

test("Anchors on Today: Off takes the anchor line off Today", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator(".wall-anchor")).toBeVisible();
  await openTab(page, "Settings");
  await page.getByRole("button", { name: /^Anchors on Today/ }).click();
  await page.getByRole("radio", { name: /^Off/ }).click();
  await openTab(page, "Today");
  await expect(page.locator(".wall-anchor")).toHaveCount(0);
});

test("laptop: sections on the left, the chosen one on the right; The day's pages go back to The day", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openTab(page, "Settings");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(nav.getByRole("button")).toHaveText(["Profile", "The day", "Your goal", "Coach", "Coach memory", "AI provider", "Appearance", "Notifications", "Data", "Support", "Sign out"]);
  await expect(nav.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "The day" }).click();
  await expect(page.getByRole("heading", { name: "The day", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: /^Focus timer/ }).click();
  await page.getByRole("radio", { name: "45 min" }).click();
  await page.getByRole("button", { name: "The day", exact: true }).last().click();
  await expect(page.getByRole("button", { name: /^Focus timer/ })).toContainText("45 min");
  await expect(nav.getByRole("button", { name: "The day" })).toHaveAttribute("aria-current", "page");
  // Coach carries the coach's own rows (44j).
  await nav.getByRole("button", { name: "Coach", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Proactive nudges" })).toBeVisible();
});

test("settings names can be cleared and stay cleared after leaving their pages", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  await page.locator(".set-profile").click();
  await page.locator("#settings-name").fill("");
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
  await expect(page.locator(".set-profile-name")).toHaveText("Your profile");
  await page.locator(".set-profile").click();
  await expect(page.locator("#settings-name")).toHaveValue("");
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();

  await page.getByRole("button", { name: /Tone and profile/ }).click();
  await page.locator("#settings-mentor").fill("");
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
  await expect(page.getByRole("button", { name: /Tone and profile/ })).toContainText("Your coach");
  await page.getByRole("button", { name: /Tone and profile/ }).click();
  await expect(page.locator("#settings-mentor")).toHaveValue("");
});

test("Sync now does not claim a successful sync when demo has no server", async ({ page }) => {
  await enterDemo(page);
  await page.clock.setFixedTime(new Date("2024-06-16T10:00:00"));
  await openTab(page, "Settings");
  await page.getByRole("button", { name: /^Sync/ }).click();
  const lastSync = page.locator(".set-row", { hasText: "Last sync" }).locator(".set-row-value");
  await expect(lastSync).not.toHaveText("just now");
  const before = await lastSync.innerText();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(lastSync).toHaveText(before);
});

test("wide-only Settings sections return to the phone root on resize", async ({ page }) => {
  await enterDemo(page, { width: 900, height: 900 });
  await openTab(page, "Settings");
  for (const section of ["The day", "Appearance", "Support"]) {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: section }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.locator(".set-profile")).toBeVisible();
  }
});

test("retired NVIDIA storage is cleared and theme choices have 44px targets", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("loci_nvidia_key", "retired-secret");
    localStorage.setItem("loci_provider_pref", "nvidia");
  });
  await enterDemo(page);
  expect(await page.evaluate(() => localStorage.getItem("loci_nvidia_key"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("loci_provider_pref"))).toBeNull();
  await openTab(page, "Settings");
  const choices = page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio");
  for (let i = 0; i < 3; i++) {
    expect((await choices.nth(i).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
});

test("bug report takes keyboard focus, traps Tab and restores the trigger", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  const trigger = page.getByRole("button", { name: "Report a bug" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Report a bug" });
  await expect(page.locator("#bug-what")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#bug-device")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
