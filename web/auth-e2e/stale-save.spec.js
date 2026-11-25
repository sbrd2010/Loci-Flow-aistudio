// #680: a save made after a wait must not write back an older copy of
// everything else. Path: Add task with a reminder while the notification
// permission is undecided (the first prompt, on turning the reminder on, was
// dismissed), so the dialog waits for the second prompt on Add. While it
// waits, the phone changes things; when the prompt answers, the new task
// lands and every change from the phone survives, on the server, on both
// devices (payload and merge base), after a reload and on a fresh client.
//
// The prompt is stubbed so the test decides when (and how) it answers.
// Ordering is proven from data (convergence barriers), not sleeps.
import { test, expect, readServer, renameTask, signIn } from "./helpers";

const NEW_TASK = "Sample reminder task";

// Notification permission: the first request (turning the reminder on) is
// dismissed, so the permission stays undecided; later ones wait for the test.
// Long timers are counted, so a reminder due at a given time can be found.
async function laptopSetup(context) {
  await context.addInitScript(() => {
    let release;
    let answered = new Promise(r => { release = r; });
    window.__permissionAsks = 0;
    window.__releasePermission = (value) => { const r = release; answered = new Promise(n => { release = n; }); r(value); };
    class FakeNotification { constructor() {} close() {} }
    FakeNotification.permission = "default";
    FakeNotification.requestPermission = () => {
      window.__permissionAsks += 1;
      if (window.__permissionAsks === 1) return Promise.resolve("default");
      return answered.then(v => { FakeNotification.permission = v; return v; });
    };
    Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
    const realSet = window.setTimeout.bind(window);
    const realClear = window.clearTimeout.bind(window);
    window.__longTimers = new Map();
    window.setTimeout = (fn, delay, ...rest) => {
      const id = realSet((...args) => { window.__longTimers.delete(id); if (typeof fn === "function") fn(...args); }, delay, ...rest);
      if (delay > 3_600_000) window.__longTimers.set(id, Date.now() + delay);
      return id;
    };
    window.clearTimeout = (id) => { window.__longTimers.delete(id); realClear(id); };
    window.__timersDueAt = (at) => [...window.__longTimers.values()].filter(due => Math.abs(due - at) < 10_000).length;
  });
}
const tomorrowNine = (page) => page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); });

// Opens Add task with a reminder (Tomorrow 09:00); returns the dialog.
async function openAddWithReminder(page, title = NEW_TASK) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByTestId("add-task-title").fill(title);
  await dialog.getByRole("button", { name: "More details" }).click();
  await dialog.getByRole("button", { name: "Set a reminder" }).click();
  await dialog.getByRole("group", { name: "Quick reminders" }).getByRole("button", { name: /^Tomorrow/ }).click();
  return dialog;
}
async function submitAndHold(page, dialog) {
  await dialog.getByTestId("add-task-submit").click();
  await expect.poll(() => page.evaluate(() => window.__permissionAsks)).toBe(2);
}

const record = (client, uuid) => client.page.evaluate(([u, id]) => {
  const r = JSON.parse(localStorage.getItem(`loci_payload_v1_${u}`) || "null");
  const pick = (t) => (t ? { title: t.title, isCompleted: !!t.isCompleted, isDeleted: !!t.isDeleted, lastUpdated: t.lastUpdated } : null);
  const find = (l) => (l || []).find(t => t.uuid === id);
  return { local: pick(find(r?.payload?.tasks)), base: pick(find(r?.base?.tasks)), name: r?.payload?.config?.userName ?? null, baseName: r?.base?.config?.userName ?? null, titles: (r?.payload?.tasks || []).filter(t => !t.isDeleted).map(t => t.title) };
}, [client.uid, uuid]);
const pickServer = (t) => (t ? { title: t.title, isCompleted: !!t.isCompleted, isDeleted: !!t.isDeleted, lastUpdated: t.lastUpdated } : null);
const serverTask = async (request, uid, uuid) => pickServer((await readServer(request, uid)).tasks.find(t => t.uuid === uuid));
const newTasksOnServer = async (request, uid) => (await readServer(request, uid)).tasks.filter(t => t.title === NEW_TASK && !t.isDeleted);

// What the phone does while the laptop waits, and the seeded task's state it must leave.
const CHANGES = {
  rename: { act: (b) => renameTask(b.page, "Water sample plants", "Water sample plants, renamed on the phone"), expect: { title: "Water sample plants, renamed on the phone", isCompleted: false, isDeleted: false } },
  complete: { act: (b) => b.page.getByRole("button", { name: "Mark done: Water sample plants" }).click(), expect: { title: "Water sample plants", isCompleted: true, isDeleted: false } },
  delete: {
    act: async (b) => {
      await b.page.getByTestId("today-tasks-list").getByTestId("task-row").filter({ hasText: "Water sample plants" }).locator(".task-title-text").click();
      await b.page.getByTestId("task-detail").getByRole("button", { name: "Delete" }).click();
    },
    expect: { title: "Water sample plants", isCompleted: false, isDeleted: true },
  },
};

for (const [name, change] of Object.entries(CHANGES)) {
  test(`#680: a phone ${name} made while Add task waits survives the laptop's save, everywhere`, async ({ clients }) => {
    const a = await clients.open(undefined, { setupContext: laptopSetup });
    const b = await clients.open(a.email, { phone: true });
    await submitAndHold(a.page, await openAddWithReminder(a.page));

    await change.act(b);
    // Barrier: the change is committed and the laptop has it, live and as its base.
    await expect.poll(async () => { const s = await serverTask(clients.request, a.uid, "seed-b"); return s && { title: s.title, isCompleted: s.isCompleted, isDeleted: s.isDeleted }; }).toEqual(change.expect);
    const committed = await serverTask(clients.request, a.uid, "seed-b");
    await expect.poll(async () => { const r = await record(a, "seed-b"); return [r.local, r.base]; }).toEqual([committed, committed]);

    await a.page.evaluate(() => window.__releasePermission("granted"));
    await expect(a.page.getByRole("status").filter({ hasText: "Added to Today" })).toBeVisible();
    // Barrier: the new task is on the server and in both devices' payload and base.
    await expect.poll(async () => (await newTasksOnServer(clients.request, a.uid)).length).toBe(1);
    for (const client of [a, b]) await expect.poll(async () => (await record(client, "seed-b")).titles.includes(NEW_TASK)).toBe(true);
    // One reminder for the new task (checked before the reload, which resets the stubbed permission).
    const at = await tomorrowNine(a.page);
    await expect.poll(() => a.page.evaluate(due => window.__timersDueAt(due), at)).toBe(1);
    // The phone's change, content and clock, is untouched on the server and both devices.
    expect(await serverTask(clients.request, a.uid, "seed-b")).toEqual(committed);
    for (const client of [a, b]) {
      await expect.poll(async () => { const r = await record(client, "seed-b"); return [r.local, r.base]; }).toEqual([committed, committed]);
    }
    await a.page.reload();
    await expect.poll(async () => (await record(a, "seed-b")).local).toEqual(committed);
    const fresh = await clients.fresh(a.email);
    await expect.poll(async () => (await record(fresh, "seed-b")).local).toEqual(committed);
    expect(await serverTask(clients.request, a.uid, "seed-b")).toEqual(committed);
  });
}

test("#680: a task added on the phone while Add task waits is kept, next to the new one", async ({ clients }) => {
  const a = await clients.open(undefined, { setupContext: laptopSetup });
  const b = await clients.open(a.email, { phone: true });
  await submitAndHold(a.page, await openAddWithReminder(a.page));
  const { addTask } = await import("./helpers");
  await addTask(b.page, "Sample added on the phone");
  await expect.poll(async () => (await record(a, "seed-b")).titles.includes("Sample added on the phone")).toBe(true);
  await a.page.evaluate(() => window.__releasePermission("granted"));
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.filter(t => !t.isDeleted).map(t => t.title).sort())
    .toEqual(["Sample added on the phone", NEW_TASK, "Sort sample notes", "Water sample plants"].sort());
  for (const client of [a, b]) await expect.poll(async () => (await record(client, "seed-b")).titles.sort()).toEqual(["Sample added on the phone", NEW_TASK, "Sort sample notes", "Water sample plants"].sort());
});

test("#680: a settings change made on the phone (Settings screen) while Add task waits survives", async ({ clients }) => {
  const a = await clients.open(undefined, { setupContext: laptopSetup });
  const b = await clients.open(a.email, { phone: true });
  await submitAndHold(a.page, await openAddWithReminder(a.page));
  await b.page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
  await b.page.locator(".set-profile").click();
  await b.page.locator("#settings-name").fill("Sample Renamed"); // Profile autosaves the name
  await expect.poll(async () => (await readServer(clients.request, a.uid)).config.userName).toBe("Sample Renamed");
  await expect.poll(async () => { const r = await record(a, "seed-b"); return [r.name, r.baseName]; }).toEqual(["Sample Renamed", "Sample Renamed"]);
  await a.page.evaluate(() => window.__releasePermission("granted"));
  await expect.poll(async () => (await newTasksOnServer(clients.request, a.uid)).length).toBe(1);
  await expect.poll(async () => (await record(a, "seed-b")).titles.includes(NEW_TASK)).toBe(true);
  expect((await readServer(clients.request, a.uid)).config.userName).toBe("Sample Renamed");
  for (const client of [a, b]) await expect.poll(async () => { const r = await record(client, "seed-b"); return [r.name, r.baseName]; }).toEqual(["Sample Renamed", "Sample Renamed"]);
});

test("#680: nothing changes elsewhere (control): the task is added, the rest exactly as before", async ({ clients }) => {
  const a = await clients.open(undefined, { setupContext: laptopSetup });
  const before = await serverTask(clients.request, a.uid, "seed-b");
  await submitAndHold(a.page, await openAddWithReminder(a.page));
  await a.page.evaluate(() => window.__releasePermission("granted"));
  await expect.poll(async () => (await newTasksOnServer(clients.request, a.uid)).length).toBe(1);
  expect(await serverTask(clients.request, a.uid, "seed-b")).toEqual(before);
});

test("#680: Add pressed again while the prompt waits (click and keyboard) adds one task", async ({ clients }) => {
  const a = await clients.open(undefined, { setupContext: laptopSetup });
  const dialog = await openAddWithReminder(a.page);
  await submitAndHold(a.page, dialog);
  await dialog.getByTestId("add-task-submit").click();
  await dialog.getByTestId("add-task-title").press("Control+Enter");
  await a.page.evaluate(() => window.__releasePermission("granted"));
  await expect.poll(async () => (await newTasksOnServer(clients.request, a.uid)).length).toBe(1);
  await a.page.waitForTimeout(2500); // a duplicate would be queued within the save debounce
  expect((await newTasksOnServer(clients.request, a.uid)).length).toBe(1);
});

test("#680: closing Add task while the prompt waits adds nothing and sets no reminder", async ({ clients }) => {
  const a = await clients.open(undefined, { setupContext: laptopSetup });
  const dialog = await openAddWithReminder(a.page);
  await submitAndHold(a.page, dialog);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await a.page.evaluate(() => window.__releasePermission("granted"));
  await a.page.waitForTimeout(2500);
  expect((await newTasksOnServer(clients.request, a.uid)).length).toBe(0);
  expect((await record(a, "seed-b")).titles).not.toContain(NEW_TASK);
  expect(await a.page.evaluate(due => window.__timersDueAt(due), await tomorrowNine(a.page))).toBe(0);
});

for (const answer of ["denied", "default"]) {
  test(`#680: the permission ${answer === "denied" ? "denied" : "dismissed again"} still adds the task, without a reminder timer`, async ({ clients }) => {
    const a = await clients.open(undefined, { setupContext: laptopSetup });
    await submitAndHold(a.page, await openAddWithReminder(a.page));
    await a.page.evaluate(v => window.__releasePermission(v), answer);
    await expect.poll(async () => (await newTasksOnServer(clients.request, a.uid)).length).toBe(1);
    expect(await a.page.evaluate(due => window.__timersDueAt(due), await tomorrowNine(a.page))).toBe(0);
  });
}

test("#680: signed out, then back in as the same account, while the prompt waits: the old Add writes nothing", async ({ clients }) => {
  const a = await clients.open(undefined, { setupContext: laptopSetup });
  await submitAndHold(a.page, await openAddWithReminder(a.page));
  await a.page.evaluate(async () => { const { auth } = await import("/src/firebase.js"); await auth.signOut(); });
  await expect(a.page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await signIn(a.page, a.email, { navigate: false });
  await expect.poll(async () => (await record(a, "seed-b")).titles.length).toBeGreaterThan(0);
  await a.page.evaluate(() => window.__releasePermission("granted"));
  await a.page.waitForTimeout(2500);
  expect((await newTasksOnServer(clients.request, a.uid)).length).toBe(0);
  expect(await a.page.evaluate(due => window.__timersDueAt(due), await tomorrowNine(a.page))).toBe(0);
});

test("#680: offline when the prompt answers: the task is added at once and reaches the server on reconnect", async ({ clients }) => {
  const a = await clients.open(undefined, { setupContext: laptopSetup });
  await submitAndHold(a.page, await openAddWithReminder(a.page));
  await a.context.setOffline(true);
  await a.page.evaluate(() => window.__releasePermission("granted"));
  await expect(a.page.getByRole("status").filter({ hasText: "Added to Today" })).toBeVisible();
  await expect.poll(async () => (await record(a, "seed-b")).titles.includes(NEW_TASK)).toBe(true);
  expect((await newTasksOnServer(clients.request, a.uid)).length).toBe(0);
  await a.context.setOffline(false);
  await expect.poll(async () => (await newTasksOnServer(clients.request, a.uid)).length, { timeout: 30_000 }).toBe(1);
});

