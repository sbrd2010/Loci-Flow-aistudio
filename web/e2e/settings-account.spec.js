import { test, expect } from "@playwright/test";

// Settings reliability smoke tests run in demo mode so they do not mutate Firebase user data.
// The bug-report form is opened and validated but not submitted, because submit writes to Firebase.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openTab(page, name) {
  await page.locator(".bottom-nav").getByRole("button", { name }).click();
}

async function ensureProfileOpen(page) {
  const nameInput = page.locator("#settings-name");
  if (!(await nameInput.isVisible())) {
    await page.getByRole("button", { name: /Your Profile/i }).click();
  }
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .card, .modal-card, .bottom-nav"
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

test("mobile reliability: Settings supports profile save, privacy, bug-report modal, and demo sign-out", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");

  await expect(page.getByRole("heading", { name: "Your Profile" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("heading", { name: "AI Keys" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("heading", { name: "Data Sync" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible({ timeout: 8_000 });
  await expectNoHorizontalOverflow(page);

  await ensureProfileOpen(page);
  await page.locator("#settings-name").fill("Settings Smoke User");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByRole("button", { name: /Saved/i })).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: /Data Sync/i }).click();
  await expect(page.getByText("Your tasks sync instantly with Firebase across all your devices.")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Active Tasks")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Total XP")).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("What we store")).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).not.toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: /Report a bug/i }).click();
  await expect(page.getByRole("heading", { name: "Report a Bug" })).toBeVisible({ timeout: 5_000 });
  await page.locator("#bug-what").fill("Settings smoke test opened the report form without submitting.");
  await page.locator("#bug-device").fill("Playwright mobile viewport");
  await expect(page.getByRole("button", { name: "Submit Bug Report" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await page.locator("button", { hasText: "×" }).last().click();
  await expect(page.getByRole("heading", { name: "Report a Bug" })).not.toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Sign out of Loci" }).click();
  await expect(page.getByText("Sign out? Your data stays saved.")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".app-container")).not.toBeVisible({ timeout: 5_000 });
});

test("mobile reliability: Daily Coach Check-ins toggle persists off", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Settings");
  await ensureProfileOpen(page);

  const toggleRow = page.locator(".toggle-row", { hasText: "Daily Coach Check-ins" });
  const checkbox = toggleRow.locator("input.pill-toggle");
  await expect(checkbox).toBeChecked();

  await toggleRow.click();
  await expect(checkbox).not.toBeChecked();
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByRole("button", { name: /Saved/i })).toBeVisible({ timeout: 5_000 });

  // Collapse and reopen the section — this re-syncs the form's local state from
  // the saved config prop, confirming the off state was actually written to
  // payload.config (not just held in local component state).
  await page.getByRole("button", { name: /Your Profile/i }).click();
  await expect(page.locator("#settings-name")).not.toBeVisible({ timeout: 5_000 });
  await ensureProfileOpen(page);
  await expect(page.locator(".toggle-row", { hasText: "Daily Coach Check-ins" }).locator("input.pill-toggle")).not.toBeChecked();
});
