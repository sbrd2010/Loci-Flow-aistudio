// #680 Tier 2: Coach's task chips ask "Park … ?" / "Set … as your Now
// Focus?" in a confirm dialog. Confirming must apply the chip to the task as
// it is now, and keep every change another device committed while the dialog
// was open: on the server, in both devices' payload and merge base, and after
// a reload. A Coach reply naming one task is seeded (no AI call), which shows
// the real chips on the last reply.
import { test, expect, databaseUrl, readServer } from "./helpers";

const OWNER_AUTH = { Authorization: "Bearer owner" }; // Emulator-only administrative credential.
const WEEK_TASK = (email) => ({
  id: 3, uuid: "wk-x", title: "Return the sample books", userId: email, concreteStep: "Open the sample folder",
  horizonLevel: "week", priority: "P2", category: "Personal", timeEstimateMinutes: 25,
  isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false, orderIndex: 3, lastUpdated: Date.now() - 30_000,
});

async function seed(clients, a, target) {
  const at = Date.now();
  const title = target === "wk-x" ? "Return the sample books" : "Water sample plants";
  const r = await clients.request.patch(databaseUrl(`sync/${a.uid}`), {
    headers: OWNER_AUTH,
    data: {
      "tasks/2": WEEK_TASK(a.email),
      chatHistory: [
        { text: "Sample question", isUser: true, at: at - 2000 },
        { text: "Sample reply about that task.", isUser: false, at: at - 1000, actions: [{ type: "PARK_TASK", title, matched: true, task: { uuid: target, title } }] },
      ],
      timestamp: at,
    },
  });
  expect(r.ok()).toBe(true);
  await expect.poll(async () => (await cache(a)).tasks.some(t => t.uuid === "wk-x")).toBe(true);
}
const cache = (client) => client.page.evaluate(([u]) => {
  const r = JSON.parse(localStorage.getItem(`loci_payload_v1_${u}`) || "null");
  return { ...(r?.payload || {}), base: r?.base || {} };
}, [client.uid]);

// What the phone changes while the laptop's dialog is open, and how to read it back.
const PHONE = {
  setting: {
    act: async (b) => {
      await b.page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
      await b.page.locator(".set-profile").click();
      await b.page.locator("#settings-name").fill("Sample Renamed");
    },
    read: (p) => p.config?.userName, want: "Sample Renamed",
  },
  thought: {
    act: async (b) => {
      await b.page.getByRole("button", { name: "Mind Box", exact: true }).click();
      const field = b.page.locator(".mbx-field").getByRole("textbox", { name: "Thought" });
      await field.fill("Sample thought from the phone");
      await field.press("Control+Enter");
    },
    read: (p) => (p.brainDump || []).some(d => d.text === "Sample thought from the phone"), want: true,
  },
  completion: {
    act: async (b) => b.page.getByRole("button", { name: "Mark done: Sort sample notes" }).click(),
    read: (p) => (p.contributions || []).reduce((n, c) => n + (c.count || 0), 0), want: 1,
  },
};

const CHIPS = [
  { chip: "Make it your now task", confirm: "Yes", target: "seed-b", phone: "setting", effect: (t) => t.isNowFocus === true },
  { chip: "Park", confirm: "Park it", target: "seed-b", phone: "thought", effect: (t) => t.isParked === true },
  { chip: "Move to Today", confirm: "Yes", target: "wk-x", phone: "completion", effect: (t) => t.horizonLevel === "today" },
  { chip: "Today, as your now task", confirm: "Yes", target: "wk-x", phone: "setting", effect: (t) => t.horizonLevel === "today" && t.isNowFocus === true },
];

async function openChip(a, chip) {
  await a.page.getByRole("button", { name: "Coach", exact: true }).first().click();
  await a.page.getByRole("button", { name: chip, exact: true }).click();
  return a.page.getByRole("dialog");
}

for (const c of CHIPS) {
  test(`#680: Coach "${c.chip}", confirmed after the phone changed a ${c.phone}: both land, everywhere`, async ({ clients }) => {
    const a = await clients.open();
    await seed(clients, a, c.target);
    const dialog = await openChip(a, c.chip);
    const b = await clients.open(a.email, { phone: true });
    const phone = PHONE[c.phone];
    await phone.act(b);
    // Barrier: committed, and the laptop has it live and as its base.
    await expect.poll(async () => phone.read(await readServer(clients.request, a.uid))).toBe(phone.want);
    await expect.poll(async () => { const p = await cache(a); return [phone.read(p), phone.read(p.base)]; }).toEqual([phone.want, phone.want]);

    await dialog.getByRole("button", { name: c.confirm, exact: true }).click();
    await expect.poll(async () => c.effect((await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === c.target))).toBe(true);
    // The phone's change is kept on the server and on both devices, payload and base.
    expect(phone.read(await readServer(clients.request, a.uid))).toBe(phone.want);
    for (const client of [a, b]) {
      await expect.poll(async () => { const p = await cache(client); return [phone.read(p), phone.read(p.base), c.effect(p.tasks.find(t => t.uuid === c.target)), c.effect((p.base.tasks || []).find(t => t.uuid === c.target))]; }).toEqual([phone.want, phone.want, true, true]);
    }
    await a.page.reload();
    await expect.poll(async () => phone.read(await cache(a))).toBe(phone.want);
    const fresh = await clients.fresh(a.email);
    await expect.poll(async () => { const p = await cache(fresh); return [phone.read(p), c.effect(p.tasks.find(t => t.uuid === c.target))]; }).toEqual([phone.want, true]);
    expect(phone.read(await readServer(clients.request, a.uid))).toBe(phone.want);
  });
}

test("#680: Coach \"Park\" confirmed after the phone deleted that task: it stays deleted, nothing is written", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  const dialog = await openChip(a, "Park");
  const b = await clients.open(a.email, { phone: true });
  await b.page.getByTestId("today-tasks-list").getByTestId("task-row").filter({ hasText: "Water sample plants" }).locator(".task-title-text").click();
  await b.page.getByTestId("task-detail").getByRole("button", { name: "Delete" }).click();
  await expect.poll(async () => (await cache(a)).tasks.find(t => t.uuid === "seed-b")?.isDeleted).toBe(true);
  const before = (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-b");
  await dialog.getByRole("button", { name: "Park it", exact: true }).click();
  await new Promise(r => setTimeout(r, 2500)); // a write would be queued within the save debounce
  const after = (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-b");
  expect(after).toEqual(before);
});

test("#680: Coach \"Make it your now task\" confirmed after the phone completed that task: it is not made the now task", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  const dialog = await openChip(a, "Make it your now task");
  const b = await clients.open(a.email, { phone: true });
  await b.page.getByRole("button", { name: "Mark done: Water sample plants" }).click();
  await expect.poll(async () => (await cache(a)).tasks.find(t => t.uuid === "seed-b")?.isCompleted).toBe(true);
  const before = (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-b");
  await dialog.getByRole("button", { name: "Yes", exact: true }).click();
  await new Promise(r => setTimeout(r, 2500));
  const after = (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-b");
  expect(after).toEqual(before);
});

// Another device's committed write where the phone has no UI for it (chat,
// deferral): an emulator admin commit, then the same barrier.
const commit = async (clients, a, data) => {
  const r = await clients.request.patch(databaseUrl(`sync/${a.uid}`), { headers: OWNER_AUTH, data: { ...data, timestamp: Date.now() } });
  expect(r.ok()).toBe(true);
};
async function eventsFor(clients, a, taskId) {
  const res = await clients.request.get(databaseUrl(`activityLogs/${a.uid}/events`), { headers: OWNER_AUTH });
  const days = (await res.json()) || {};
  return Object.values(days).flatMap(d => Object.values(d || {})).filter(e => e?.taskId === taskId).map(e => e.type).sort();
}

test("#680: Coach \"Park\" confirmed after another device added to the Coach chat: the chat is kept, one task_parked event", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  const dialog = await openChip(a, "Park");
  const chat = (await readServer(clients.request, a.uid)).chatHistory;
  const extended = [...chat, { text: "Sample message from the other device", isUser: true, at: Date.now() }];
  await commit(clients, a, { chatHistory: extended });
  await expect.poll(async () => { const p = await cache(a); return [p.chatHistory?.length, p.base.chatHistory?.length]; }).toEqual([3, 3]);
  await dialog.getByRole("button", { name: "Park it", exact: true }).click();
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-b")?.isParked).toBe(true);
  expect((await readServer(clients.request, a.uid)).chatHistory.map(m => m.text)).toEqual(extended.map(m => m.text));
  await expect.poll(() => eventsFor(clients, a, "seed-b")).toEqual(["task_parked"]);
});

test("#680: Coach \"Make it your now task\" after the task was deferred elsewhere: not widened into a move, nothing written", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  const dialog = await openChip(a, "Make it your now task");
  await commit(clients, a, { "tasks/1/deferredUntil": "2099-01-01", "tasks/1/lastUpdated": Date.now() });
  await expect.poll(async () => (await cache(a)).base.tasks?.find(t => t.uuid === "seed-b")?.deferredUntil).toBe("2099-01-01");
  const before = (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-b");
  await dialog.getByRole("button", { name: "Yes", exact: true }).click();
  await new Promise(r => setTimeout(r, 2500)); // settling wait: a write would be queued within the save debounce
  expect((await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-b")).toEqual(before);
  expect(await eventsFor(clients, a, "seed-b")).toEqual([]);
});

test("#680: Coach \"Park\" after the task was parked elsewhere: already done, nothing written or logged", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  const dialog = await openChip(a, "Park");
  await commit(clients, a, { "tasks/1/isParked": true, "tasks/1/parkedAt": Date.now(), "tasks/1/lastUpdated": Date.now() });
  await expect.poll(async () => (await cache(a)).base.tasks?.find(t => t.uuid === "seed-b")?.isParked).toBe(true);
  const before = await readServer(clients.request, a.uid);
  await dialog.getByRole("button", { name: "Park it", exact: true }).click();
  await new Promise(r => setTimeout(r, 2500)); // settling wait
  const after = await readServer(clients.request, a.uid);
  expect(after.tasks.find(t => t.uuid === "seed-b")).toEqual(before.tasks.find(t => t.uuid === "seed-b"));
  expect(after.timestamp).toBe(before.timestamp);
  expect(await eventsFor(clients, a, "seed-b")).toEqual([]);
});

test("#680: Coach chip dialog cancelled after the phone changed a setting: the laptop writes nothing, the setting stays", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  const dialog = await openChip(a, "Park");
  const b = await clients.open(a.email, { phone: true });
  await PHONE.setting.act(b);
  await expect.poll(async () => { const p = await cache(a); return [p.config?.userName, p.base.config?.userName]; }).toEqual(["Sample Renamed", "Sample Renamed"]);
  const before = await readServer(clients.request, a.uid);
  await dialog.getByRole("button", { name: /^(Cancel|Not now|No)$/ }).first().click();
  await new Promise(r => setTimeout(r, 2500)); // settling wait
  const after = await readServer(clients.request, a.uid);
  expect(after.config.userName).toBe("Sample Renamed");
  expect(after.tasks.find(t => t.uuid === "seed-b")).toEqual(before.tasks.find(t => t.uuid === "seed-b"));
  expect(await eventsFor(clients, a, "seed-b")).toEqual([]);
});

// The focus session: a chip that takes the pin from a task whose session is
// running ends that session (one terminal event), only once the save is
// applied, and never a session twice.
async function startFocusThenLeave(clients, a) {
  const { row } = await import("./helpers");
  await row(a.page, "Sort sample notes").locator(".task-title-text").click();
  const detail = a.page.getByTestId("task-detail");
  await detail.getByRole("button", { name: /Do this now/ }).click();
  if (await detail.isVisible()) await detail.getByRole("button", { name: "Close", exact: true }).click();
  await a.page.locator(".today-wall .wall-primary").click();
  await expect(a.page.locator(".focus-mode-overlay")).toBeVisible();
  await a.page.getByRole("button", { name: "Leave focus" }).click();
  await expect(a.page.locator(".focus-mode-overlay")).toHaveCount(0);
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a").isNowFocus).toBe(true);
}
const terminal = (types) => types.filter(t => t === "focus_abandoned" || t === "focus_completed");

test("#680: Coach \"Make it your now task\" on another task while a session runs: that session ends once, the new task is pinned", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  await startFocusThenLeave(clients, a);
  const dialog = await openChip(a, "Make it your now task");
  await dialog.getByRole("button", { name: "Yes", exact: true }).click();
  await expect.poll(async () => { const s = await readServer(clients.request, a.uid); return [s.tasks.find(t => t.uuid === "seed-a").isNowFocus, s.tasks.find(t => t.uuid === "seed-b").isNowFocus]; }).toEqual([false, true]);
  await expect.poll(async () => terminal(await eventsFor(clients, a, "seed-a"))).toEqual(["focus_abandoned"]);
});

test("#680: the session's task completed on the phone while a chip's dialog is open: confirming ends nothing twice", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  const b = await clients.open(a.email, { phone: true }); // before the pin, as the helper checks the list
  await startFocusThenLeave(clients, a);
  const dialog = await openChip(a, "Make it your now task");
  await expect(b.page.locator(".today-wall h2")).toHaveText("Sort sample notes");
  await b.page.locator(".today-list-head").getByRole("button", { name: "Hide list", exact: true }).click();
  await b.page.locator(".today-wall").getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(async () => (await cache(a)).base.tasks?.find(t => t.uuid === "seed-a")?.isCompleted).toBe(true);
  await dialog.getByRole("button", { name: "Yes", exact: true }).click();
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-b").isNowFocus).toBe(true);
  await new Promise(r => setTimeout(r, 2500)); // settling wait for any late ledger write
  // The phone's completion already stopped the laptop's session (observed:
  // focus_started then task_completed, with no terminal event: existing
  // behaviour, outside #680). The chip must not end it a second time.
  expect(await eventsFor(clients, a, "seed-a")).toEqual(["focus_started", "task_completed"]);
  expect((await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a").isCompleted).toBe(true);
});

test("#680: a chip that turns out to do nothing leaves a session running on another task alone", async ({ clients }) => {
  const a = await clients.open();
  await seed(clients, a, "seed-b");
  await startFocusThenLeave(clients, a);
  const dialog = await openChip(a, "Park");
  await commit(clients, a, { "tasks/1/isParked": true, "tasks/1/parkedAt": Date.now(), "tasks/1/lastUpdated": Date.now() });
  await expect.poll(async () => (await cache(a)).base.tasks?.find(t => t.uuid === "seed-b")?.isParked).toBe(true);
  await dialog.getByRole("button", { name: "Park it", exact: true }).click();
  await new Promise(r => setTimeout(r, 2500)); // settling wait: a write or ledger event would follow within the debounce
  expect(await eventsFor(clients, a, "seed-a")).toEqual(["focus_started"]); // no terminal event: the session was not ended
  expect((await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a").isNowFocus).toBe(true);
});
