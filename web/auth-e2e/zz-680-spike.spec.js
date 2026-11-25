// SPIKE for #680 (test-only): does a save built from a render-time payload,
// made after an await, undo another device's edit?
//
// Reachable path used: Add task with a reminder while notification permission
// is undecided. AddTaskDialog.handleSubmit awaits nativeRequestPermission()
// (the browser's "Allow notifications?" prompt), then saves
// { ...payload, tasks: [...payload.tasks, freshTask] } from the render in
// which Add was pressed. The prompt is stubbed so the test decides when it
// answers; ordering is proven from data, not sleeps.
import { test, expect, databaseUrl, readServer, renameTask } from "./helpers";

const holdPermission = (context) => context.addInitScript(() => {
  let release;
  const answered = new Promise(r => { release = r; });
  window.__permissionAsked = false;
  window.__releasePermission = (value) => release(value);
  class FakeNotification { constructor() {} close() {} }
  FakeNotification.permission = "default";
  // The first prompt (turning the reminder on) is dismissed with its close
  // button: Chrome leaves the permission undecided. The second (on Add) is
  // held until the test answers it.
  let asks = 0;
  FakeNotification.requestPermission = () => {
    asks += 1;
    if (asks === 1) return Promise.resolve("default");
    window.__permissionAsked = true;
    return answered.then(v => { FakeNotification.permission = v; return v; });
  };
  Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
});


async function addWithReminder(page, title) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByTestId("add-task-title").fill(title);
  await dialog.getByRole("button", { name: "More details" }).click();
  await dialog.getByRole("button", { name: "Set a reminder" }).click();
  await dialog.getByRole("group", { name: "Quick reminders" }).getByRole("button", { name: /^Tomorrow/ }).click();
  await dialog.getByTestId("add-task-submit").click();
  await expect.poll(() => page.evaluate(() => window.__permissionAsked)).toBe(true);
}

// What the phone does while the laptop's prompt is open, and how to read it back.
const VARIANTS = {
  control: { act: async () => {}, read: t => t.title, want: "Water sample plants" },
  rename: { act: async ({ b }) => renameTask(b.page, "Water sample plants", "Water sample plants, renamed on the phone"), read: t => t.title, want: "Water sample plants, renamed on the phone" },
  complete: { act: async ({ b }) => b.page.getByRole("button", { name: "Mark done: Water sample plants" }).click(), read: t => !!t.isCompleted, want: true },
  delete: {
    act: async ({ b }) => {
      await b.page.getByTestId("today-tasks-list").getByTestId("task-row").filter({ hasText: "Water sample plants" }).locator(".task-title-text").click();
      await b.page.getByTestId("task-detail").getByRole("button", { name: "Delete" }).click();
    },
    read: t => !!t.isDeleted, want: true,
  },
};
const serverSeedB = async (request, uid) => (await readServer(request, uid)).tasks.find(t => t.uuid === "seed-b");
const cachedSeedB = (client) => client.page.evaluate(([u]) => {
  const r = JSON.parse(localStorage.getItem(`loci_payload_v1_${u}`) || "null");
  const find = l => (l || []).find(t => t.uuid === "seed-b") || null;
  return { local: find(r?.payload?.tasks), base: find(r?.base?.tasks), name: r?.payload?.config?.userName, baseName: r?.base?.config?.userName };
}, [client.uid]);

for (const [name, v] of Object.entries(VARIANTS)) {
  test(`#680 spike: add with a reminder, prompt open; the phone: ${name}`, async ({ clients }) => {
    const a = await clients.open(undefined, { setupContext: holdPermission });
    const b = await clients.open(a.email, { phone: true });
    await addWithReminder(a.page, "Sample reminder task");
    await v.act({ a, b });
    // Ordering proven from data: the change is on the server and in the laptop's live copy and base.
    await expect.poll(async () => v.read(await serverSeedB(clients.request, a.uid))).toBe(v.want);
    await expect.poll(async () => { const c = await cachedSeedB(a); return [v.read(c.local), v.read(c.base)]; }).toEqual([v.want, v.want]);
    const before = await serverSeedB(clients.request, a.uid);
    await a.page.evaluate(() => window.__releasePermission("granted"));
    await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Sample reminder task")).toBe(true);
    await new Promise(r => setTimeout(r, 3000));
    const after = await serverSeedB(clients.request, a.uid);
    console.log("SPIKE680", JSON.stringify({ name, before: [v.read(before), before.lastUpdated], after: [v.read(after), after.lastUpdated] }));
    expect(v.read(after)).toBe(v.want);
  });
}

test("#680 spike: add with a reminder, prompt open; a setting changed elsewhere", async ({ clients }) => {
  const a = await clients.open(undefined, { setupContext: holdPermission });
  await addWithReminder(a.page, "Sample reminder task");
  // Another device's committed settings edit, written to the server (emulator admin).
  const now = Date.now();
  const patched = await clients.request.patch(databaseUrl(`sync/${a.uid}`), {
    headers: { Authorization: "Bearer owner" }, // Emulator-only administrative credential.
    data: { "config/userName": "Sample Renamed", "config/lastUpdated": now, timestamp: now },
  });
  expect(patched.ok()).toBe(true);
  await expect.poll(async () => { const c = await cachedSeedB(a); return [c.name, c.baseName]; }).toEqual(["Sample Renamed", "Sample Renamed"]);
  await a.page.evaluate(() => window.__releasePermission("granted"));
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Sample reminder task")).toBe(true);
  await new Promise(r => setTimeout(r, 3000));
  const name = (await readServer(clients.request, a.uid)).config.userName;
  console.log("SPIKE680", JSON.stringify({ name: "config", after: name }));
  expect(name).toBe("Sample Renamed");
});
