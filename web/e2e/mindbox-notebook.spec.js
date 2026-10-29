import { test, expect } from "@playwright/test";

async function openNotebook(page, width = 1280, height = 800, thoughts = []) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(items => {
    localStorage.setItem("loci_today_peek_open", "1");
    window.__LOCI_DEMO_FIXTURE__ = () => ({
      userId: "demo", tasks: [], contributions: [], brainDump: items,
      config: { userId: "demo", userName: "Sample", isOnboardingCompleted: true, dayStartHour: 0, dayEndHour: 24 },
      timestamp: Date.now(),
    });
  }, thoughts);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2026-10-29T10:00:00"));
  await page.getByTestId("demo-btn").click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Mind Box", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brain dump", exact: true })).toBeVisible();
  return page.locator(".mbx-field").getByRole("textbox", { name: "Thought" });
}

test("numbering continues on Enter, an empty item ends it, and Ctrl+Enter saves", async ({ page }) => {
  const field = await openNotebook(page);
  await field.fill("1. Blue sample");
  await field.press("Enter");
  await field.pressSequentially("Green sample");
  await field.press("Enter");
  await field.press("Enter");
  expect(await field.innerText()).toContain("1. Blue sample\n2. Green sample");
  await expect(page.getByTestId("thought-row")).toHaveCount(0);
  await field.press("Control+Enter");
  await expect(field).toHaveText("");
  await expect(page.getByTestId("thought-row")).toHaveCount(1);
  const text = await page.locator(".thought-text").innerText();
  expect(text).toContain("1. Blue sample\n2. Green sample");
  expect(text).not.toContain("3.");
});

test("saved thoughts edit in place, retain their added date, and Cancel discards the draft", async ({ page }) => {
  const createdAt = new Date(2026, 9, 13, 8).getTime();
  await openNotebook(page, 1280, 800, [{ id: "sample-a", text: "Original sample", createdAt }]);
  const row = page.getByTestId("thought-row");
  await expect(row.locator("time")).toHaveText("13 Oct");
  await row.getByRole("button", { name: "Edit thought", exact: true }).click();
  const edit = page.getByRole("region", { name: "Edit thought", exact: true });
  await edit.getByRole("textbox", { name: "Thought" }).fill("Edited sample");
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(row).toHaveAttribute("data-thought-id", "sample-a");
  await expect(row.locator(".thought-text")).toHaveText("Edited sample");
  await expect(row.locator("time")).toHaveText("13 Oct · Edited");
  await expect(row.locator("time")).toHaveAttribute("datetime", new Date(createdAt).toISOString());
  await row.getByRole("button", { name: "Edit thought", exact: true }).click();
  await edit.getByRole("textbox", { name: "Thought" }).fill("Discarded draft");
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row.locator(".thought-text")).toHaveText("Edited sample");
});

test("highlights and bold survive saving, navigation, editing, and highlight removal", async ({ page }) => {
  const field = await openNotebook(page);
  await field.fill("Coloured sample");
  await field.press("Control+a");
  await field.press("Control+b");
  await page.locator(".mbx-field").getByRole("button", { name: "Formatting", exact: true }).click();
  await page.getByRole("button", { name: "Yellow highlight", exact: true }).click();
  await page.locator(".mbx-field").getByRole("button", { name: "Save thought", exact: true }).click();
  const row = page.getByTestId("thought-row");
  await expect(row.locator(".thought-text mark")).toHaveText("Coloured sample");
  await expect(row.locator(".thought-text strong")).toHaveText("Coloured sample");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Mind Box", exact: true }).click();
  await expect(row.locator("mark")).toHaveText("Coloured sample");
  await row.getByRole("button", { name: "Edit thought", exact: true }).click();
  const edit = page.getByRole("region", { name: "Edit thought", exact: true });
  await edit.getByRole("textbox", { name: "Thought" }).press("Control+a");
  await edit.getByRole("button", { name: "Formatting", exact: true }).click();
  await edit.getByRole("button", { name: "Remove highlight", exact: true }).click();
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(row.locator("mark")).toHaveCount(0);
  await expect(row.locator("strong")).toHaveText("Coloured sample");
});

test("list toolbar preserves formatting and supports native Undo", async ({ page }) => {
  const field = await openNotebook(page);
  await field.fill("Blue sample\nGreen sample");
  await field.press("Control+a");
  await page.locator(".mbx-field").getByRole("button", { name: "Formatting", exact: true }).click();
  await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
  expect(await field.innerText()).toContain("• Blue sample\n• Green sample");
  await field.press("Control+z");
  expect(await field.innerText()).toContain("Blue sample\nGreen sample");
  expect(await field.innerText()).not.toContain("•");
});

test("phone Return uses the beforeinput path to continue a list without saving", async ({ page }) => {
  const field = await openNotebook(page, 375, 667);
  await field.fill("1. Phone sample");
  await field.press("End");
  await field.evaluate(el => el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertParagraph", bubbles: true, cancelable: true })));
  expect(await field.innerText()).toContain("1. Phone sample\n2. ");
  await expect(page.getByTestId("thought-row")).toHaveCount(0);
});

test("a long thought keeps all its text when made into a task", async ({ page }) => {
  const field = await openNotebook(page);
  const text = "Blue notebook sample. ".repeat(75);
  await field.fill(text);
  await page.locator(".mbx-field").getByRole("button", { name: "Save thought", exact: true }).click();
  const thought = page.getByTestId("thought-row");
  await thought.click();
  await thought.getByRole("button", { name: "Make it a task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  expect((await dialog.getByTestId("add-task-title").inputValue()).length).toBeLessThanOrEqual(1000);
  await expect(dialog.getByText("The complete thought will be kept in the task’s note.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /^Add to/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(thought).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  const task = page.getByTestId("task-row").filter({ hasText: "Blue notebook sample." }).first();
  await task.locator(".task-title-text").click();
  await expect(page.getByTestId("task-detail").locator(".detail-note")).toHaveValue(text);
});

for (const [width, height] of [[320, 568], [1280, 720]]) {
  test(`${width}×${height}: expanded writing keeps Save reachable by scrolling`, async ({ page }) => {
    const field = await openNotebook(page, width, height);
    await field.fill(Array.from({ length: 25 }, (_, i) => `Sample line ${i + 1}`).join("\n"));
    const before = await field.boundingBox();
    await page.locator(".mbx-field").getByRole("button", { name: "Expand writing area", exact: true }).click();
    expect((await field.boundingBox()).height).toBeGreaterThan(before.height);
    await page.locator(".mbx-dump-head").hover();
    await page.mouse.wheel(0, 400);
    const save = page.locator(".mbx-field").getByRole("button", { name: "Save thought", exact: true });
    await expect(save).toBeInViewport({ ratio: 1 });
    const fold = await page.evaluate(() => {
      const bar = document.querySelector(".tab-bar");
      return bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().top : innerHeight;
    });
    const box = await save.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(fold);
  });
}

for (const [width, height] of [[320, 568], [375, 667], [412, 915], [1280, 720], [1440, 900], [1920, 1080], [2560, 1440]]) {
  test(`${width}×${height}: five full lines and notebook controls remain usable`, async ({ page }) => {
    const field = await openNotebook(page, width, height);
    const visibleLines = await field.evaluate(el => {
      const s = getComputedStyle(el);
      return (el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / parseFloat(s.lineHeight);
    });
    expect(visibleLines).toBeGreaterThanOrEqual(5);
    const editor = page.locator(".mbx-field");
    for (const name of ["Formatting", "Emoji", "Expand writing area", "Save thought"]) {
      const button = editor.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}
