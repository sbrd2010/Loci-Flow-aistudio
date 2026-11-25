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
      await expect.poll(async () => { const p = await cache(client); return [phone.read(p), phone.read(p.base), c.effect(p.tasks.find(t => t.uuid === c.target))]; }).toEqual([phone.want, phone.want, true]);
    }
    await a.page.reload();
    await expect.poll(async () => phone.read(await cache(a))).toBe(phone.want);
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
