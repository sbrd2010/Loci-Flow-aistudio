import { test, expect, addTask, appReady, cachedTasks, currentUid, databaseUrl, readServer, renameTask, responseBarrier, row, signIn, signOut } from "./helpers";

test("a new Google-emulator account completes onboarding and keeps it after refresh", async ({ clients }) => {
  const a = await clients.open("alpha-new@example.test", { onboarding: true });
  await a.page.getByLabel("What should Loci call you?").fill("Sample Alex");
  for (let step = 0; step < 3; step++) await a.page.getByRole("button", { name: "Continue", exact: true }).click();
  await a.page.getByRole("button", { name: "Skip tour, start now", exact: true }).click();
  await appReady(a.page);
  await expect.poll(async () => (await readServer(clients.request, a.uid)).config.isOnboardingCompleted).toBe(true);
  await a.page.reload();
  await appReady(a.page);
  expect(await currentUid(a.page)).toBe(a.uid);
  const fresh = await clients.fresh(a.email);
  await expect(fresh.page.getByRole("heading", { name: "Welcome to Loci Focus" })).toHaveCount(0);
  expect((await readServer(clients.request, a.uid)).config.userName).toBe("Sample Alex");
});

test("Google popup, saved task, refresh, and fresh-client persistence", async ({ clients }) => {
  const a = await clients.open();
  await addTask(a.page, "Pack the sample parcel");
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Pack the sample parcel")).toBe(true);
  await a.page.reload();
  await appReady(a.page);
  expect(await currentUid(a.page)).toBe(a.uid);
  await expect(row(a.page, "Pack the sample parcel")).toBeVisible();
  const fresh = await clients.fresh(a.email);
  await expect(row(fresh.page, "Pack the sample parcel")).toBeVisible();
});

test("successful sign-in leaves the Google button usable after later sign-outs", async ({ clients }) => {
  const a = await clients.open();
  await signOut(a.page);
  expect(await signIn(a.page, a.email, { navigate: false })).toBe(a.uid);
  await appReady(a.page);
  await signOut(a.page);
  expect(await signIn(a.page, a.email, { navigate: false })).toBe(a.uid);
  await appReady(a.page);
});

test("Google-emulator sign-in waits for the popup's UI initialization", async ({ clients }) => {
  let delayedScripts = 0;
  const a = await clients.open("alpha-slow-popup@example.test", {
    setupContext: async context => {
      // The emulator attaches its click handlers after this blocking optional
      // styling script. Slow delivery exposes clicks made before initialization.
      await context.route("https://unpkg.com/**/material-components-web.min.js", async route => {
        delayedScripts += 1;
        await new Promise(resolve => setTimeout(resolve, 1_000));
        await route.fulfill({ contentType: "application/javascript", body: "" });
      });
    },
  });
  expect(delayedScripts).toBe(1);
  expect(await currentUid(a.page)).toBe(a.uid);
  await expect(row(a.page, "Sort sample notes")).toBeVisible();
});

// Both clients edit the same confirmed starting state with their network
// disconnected. Ordered reconnection makes the stale-writer race repeatable.
for (const order of [[0, 1], [1, 0]]) {
  test(`concurrent additions survive reconnect order ${order.join("→")}`, async ({ clients }) => {
    const devices = [await clients.open(), await clients.open("alpha-a@example.test", { phone: true })];
    expect(devices[0].uid).toBe(devices[1].uid);
    await Promise.all(devices.map(d => d.context.setOffline(true)));
    for (const d of devices) expect(await d.page.evaluate(() => navigator.onLine)).toBe(false);
    const titles = ["File the blue sample", "File the green sample"];
    await Promise.all(devices.map((d, i) => addTask(d.page, titles[i])));
    expect((await readServer(clients.request, devices[0].uid)).tasks.map(t => t.title)).not.toContain(titles[0]);
    for (const i of order) {
      await devices[i].context.setOffline(false);
      await expect.poll(async () => (await readServer(clients.request, devices[i].uid)).tasks.some(t => t.title === titles[i])).toBe(true);
    }
    for (const d of devices) for (const title of titles) await expect(row(d.page, title)).toBeVisible();
    const saved = await readServer(clients.request, devices[0].uid);
    for (const title of titles) expect(saved.tasks.filter(t => t.title === title)).toHaveLength(1);
    const fresh = await clients.fresh(devices[0].email);
    for (const title of titles) await expect(row(fresh.page, title)).toBeVisible();
  });

  test(`edits to different tasks survive reconnect order ${order.join("→")}`, async ({ clients }) => {
    const devices = [await clients.open(), await clients.open("alpha-a@example.test", { phone: true })];
    await Promise.all(devices.map(d => d.context.setOffline(true)));
    await Promise.all([
      renameTask(devices[0].page, "Sort sample notes", "Sort the blue notes"),
      renameTask(devices[1].page, "Water sample plants", "Water the green plants"),
    ]);
    const titles = ["Sort the blue notes", "Water the green plants"];
    for (const i of order) {
      await devices[i].context.setOffline(false);
      await expect.poll(async () => (await readServer(clients.request, devices[i].uid)).tasks.some(t => t.title === titles[i])).toBe(true);
    }
    for (const d of devices) for (const title of titles) await expect(row(d.page, title)).toBeVisible();
    const fresh = await clients.fresh(devices[0].email);
    for (const title of titles) await expect(row(fresh.page, title)).toBeVisible();
  });
}

test("offline edit survives while the other device adds a task online", async ({ clients }) => {
  const a = await clients.open();
  const b = await clients.open(a.email, { phone: true });
  await a.context.setOffline(true);
  await renameTask(a.page, "Sort sample notes", "Sort notes offline");
  await addTask(b.page, "Collect the sample folder");
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Collect the sample folder")).toBe(true);
  expect((await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Sort notes offline")).toBe(false);
  await expect.poll(async () => (await cachedTasks(a)).some(t => t.title === "Sort notes offline")).toBe(true);
  await a.context.setOffline(false);
  for (const d of [a, b]) {
    await expect(row(d.page, "Sort notes offline")).toBeVisible();
    await expect(row(d.page, "Collect the sample folder")).toBeVisible();
    await expect(d.page.locator(".offline-banner")).toHaveCount(0);
    await expect(d.page.getByText(/Changes saved on this device/)).toHaveCount(0);
  }
  const fresh = await clients.fresh(a.email);
  await expect(row(fresh.page, "Sort notes offline")).toBeVisible();
  await expect(row(fresh.page, "Collect the sample folder")).toBeVisible();
});

test("a stale client cannot resurrect a newer deletion", async ({ clients }) => {
  const a = await clients.open();
  const b = await clients.open(a.email, { phone: true });
  await a.context.setOffline(true);
  await row(b.page, "Sort sample notes").locator(".task-title-text").click();
  await b.page.getByTestId("task-detail").getByRole("button", { name: /^Delete/ }).click();
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a")?.isDeleted).toBe(true);
  await renameTask(a.page, "Water sample plants", "Water plants offline");
  await a.context.setOffline(false);
  await expect(row(a.page, "Sort sample notes")).toHaveCount(0);
  await expect(row(b.page, "Water plants offline")).toBeVisible();
  expect((await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a").isDeleted).toBe(true);
  const fresh = await clients.fresh(a.email);
  await expect(row(fresh.page, "Sort sample notes")).toHaveCount(0);
  await expect(row(fresh.page, "Water plants offline")).toBeVisible();
});

test("independent settings changes survive two stale clients", async ({ clients }) => {
  const a = await clients.open();
  const b = await clients.open(a.email);
  for (const d of [a, b]) await d.page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
  await b.page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Coach", exact: true }).click();
  await Promise.all([a.context.setOffline(true), b.context.setOffline(true)]);
  await a.page.locator("#settings-name").fill("Sample Alex");
  await a.page.locator("#settings-name").press("Tab");
  await b.page.locator("#settings-mentor").fill("Sample Guide");
  await b.page.locator("#settings-mentor").press("Tab");
  await a.context.setOffline(false);
  await expect.poll(async () => (await readServer(clients.request, a.uid)).config.userName).toBe("Sample Alex");
  await b.context.setOffline(false);
  await expect.poll(async () => (await readServer(clients.request, a.uid)).config.mentorName).toBe("Sample Guide");
  const fresh = await clients.fresh(a.email);
  await fresh.page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(fresh.page.locator("#settings-name")).toHaveValue("Sample Alex");
  await fresh.page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Coach", exact: true }).click();
  await expect(fresh.page.locator("#settings-mentor")).toHaveValue("Sample Guide");
});

for (const order of [[0, 1], [1, 0]]) {
  test(`same-task conflicts honor task timestamps with clock skew, order ${order.join("→")}`, async ({ clients }) => {
    const devices = [await clients.open(), await clients.open("alpha-a@example.test", { phone: true })];
    await Promise.all(devices.map(d => d.context.setOffline(true)));
    // Current policy uses the client task timestamp, not server arrival time.
    // The ahead-of-time client's whole record wins even if it reconnects first.
    await devices[0].page.clock.setFixedTime(Date.now() + 60_000);
    await devices[1].page.clock.setFixedTime(Date.now());
    await Promise.all([
      renameTask(devices[0].page, "Sort sample notes", "Ahead-clock title"),
      renameTask(devices[1].page, "Sort sample notes", "Normal-clock title"),
    ]);
    await devices[order[0]].context.setOffline(false);
    const firstTitle = order[0] === 0 ? "Ahead-clock title" : "Normal-clock title";
    await expect.poll(async () => (await readServer(clients.request, devices[0].uid)).tasks.find(t => t.uuid === "seed-a").title).toBe(firstTitle);
    await devices[order[1]].context.setOffline(false);
    for (const d of devices) await expect(row(d.page, "Ahead-clock title")).toBeVisible();
    const fresh = await clients.fresh(devices[0].email);
    await expect(row(fresh.page, "Ahead-clock title")).toBeVisible();
  });
}

test("equal-timestamp competing task edits converge to one complete record", async ({ clients }) => {
  const devices = [await clients.open(), await clients.open("alpha-a@example.test", { phone: true })];
  const fixed = Date.now() + 10_000;
  await Promise.all(devices.map(async d => { await d.context.setOffline(true); await d.page.clock.setFixedTime(fixed); }));
  await Promise.all([
    renameTask(devices[0].page, "Sort sample notes", "Equal-clock blue title"),
    renameTask(devices[1].page, "Sort sample notes", "Equal-clock green title"),
  ]);
  for (const d of devices) expect((await cachedTasks(d)).find(t => t.uuid === "seed-a").lastUpdated).toBe(fixed);
  await devices[0].context.setOffline(false);
  await expect.poll(async () => (await readServer(clients.request, devices[0].uid)).tasks.find(t => t.uuid === "seed-a").title).toBe("Equal-clock blue title");
  await devices[1].context.setOffline(false);
  // Incoming delivery and transaction-write tie breaks intentionally differ;
  // scheduling may pick either candidate. It must never leave split clients.
  await expect.poll(async () => {
    const saved = (await readServer(clients.request, devices[0].uid)).tasks.find(t => t.uuid === "seed-a");
    const copies = await Promise.all(devices.map(async d => (await cachedTasks(d)).find(t => t.uuid === "seed-a")));
    return copies.every(t => t.title === saved.title && t.lastUpdated === saved.lastUpdated);
  }).toBe(true);
  const saved = (await readServer(clients.request, devices[0].uid)).tasks.find(t => t.uuid === "seed-a");
  expect(["Equal-clock blue title", "Equal-clock green title"]).toContain(saved.title);
  for (const d of devices) await expect(row(d.page, saved.title)).toBeVisible();
  const fresh = await clients.fresh(devices[0].email);
  await expect(row(fresh.page, saved.title)).toBeVisible();
});

test("an old in-flight acknowledgement preserves a later edit and the other client's task", async ({ clients }) => {
  let barrier;
  const a = await clients.open("alpha-a@example.test", { setupContext: async context => { barrier = await responseBarrier(context); } });
  const b = await clients.open(a.email, { phone: true });
  barrier.hold("First in-flight title");
  try {
    await renameTask(a.page, "Sort sample notes", "First in-flight title");
    await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a").title).toBe("First in-flight title");
    await expect.poll(() => barrier.count()).toBeGreaterThan(0);
    await renameTask(a.page, "First in-flight title", "Later local title");
    await addTask(b.page, "Other device sample");
    await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Other device sample")).toBe(true);
  } finally { barrier.release(); }
  for (const d of [a, b]) {
    await expect(row(d.page, "Later local title")).toBeVisible();
    await expect(row(d.page, "Other device sample")).toBeVisible();
  }
  const fresh = await clients.fresh(a.email);
  await expect(row(fresh.page, "Later local title")).toBeVisible();
  await expect(row(fresh.page, "Other device sample")).toBeVisible();
});

test("completion on the phone stops the laptop's active focus UI", async ({ clients }) => {
  const a = await clients.open();
  const b = await clients.open(a.email, { phone: true });
  await row(a.page, "Sort sample notes").locator(".task-title-text").click();
  const detail = a.page.getByTestId("task-detail");
  await detail.getByRole("button", { name: /Do this now/ }).click();
  if (await detail.isVisible()) await detail.getByRole("button", { name: "Close", exact: true }).click();
  await a.page.locator(".today-wall .wall-primary").click();
  await expect(a.page.locator(".focus-mode-overlay")).toBeVisible();
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a").isNowFocus).toBe(true);
  // Pinning makes this task the phone's hero, rather than an Up next row.
  await expect(b.page.locator(".today-wall h2")).toHaveText("Sort sample notes");
  await b.page.locator(".today-list-head").getByRole("button", { name: "Hide list", exact: true }).click();
  await b.page.locator(".today-wall").getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a").isCompleted).toBe(true);
  await expect(a.page.locator(".focus-mode-overlay")).toHaveCount(0);
  const fresh = await clients.fresh(a.email);
  await expect(row(fresh.page, "Sort sample notes")).toHaveCount(0);
  expect((await readServer(clients.request, a.uid)).tasks.find(t => t.uuid === "seed-a").isCompleted).toBe(true);
});

test("an old account's delayed write response cannot leak into a newly signed-in account", async ({ clients }) => {
  const b = await clients.open("alpha-b@example.test");
  await addTask(b.page, "B private sample");
  await expect.poll(async () => (await readServer(clients.request, b.uid)).tasks.some(t => t.title === "B private sample")).toBe(true);
  let barrier;
  const a = await clients.open("alpha-a@example.test", { setupContext: async context => { barrier = await responseBarrier(context); } });
  barrier.hold("A pending response sample");
  try {
    await addTask(a.page, "A pending response sample");
    await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "A pending response sample")).toBe(true);
    await expect.poll(() => barrier.count()).toBeGreaterThan(0);
    // The held response means the save is never confirmed, so sign-out
    // refuses to drop it silently (#626); the user discards on purpose.
    await signOut(a.page, { discardUnsaved: true });
    expect(await signIn(a.page, b.email, { navigate: false })).toBe(b.uid);
  } finally { barrier.release(); }
  await appReady(a.page);
  await expect(row(a.page, "B private sample")).toBeVisible();
  await expect(a.page.getByText("A pending response sample", { exact: true })).toHaveCount(0);
  expect((await readServer(clients.request, b.uid)).tasks.some(t => t.title === "A pending response sample")).toBe(false);
  await signOut(a.page);
  expect(await signIn(a.page, a.email, { navigate: false })).toBe(a.uid);
  await appReady(a.page);
  await expect(row(a.page, "A pending response sample")).toBeVisible();
  await expect(a.page.getByText("B private sample", { exact: true })).toHaveCount(0);
});

test("separate accounts are isolated in the app and by the database rules", async ({ clients }) => {
  const a = await clients.open();
  const b = await clients.open("alpha-b@example.test");
  expect(a.uid).not.toBe(b.uid);
  await addTask(a.page, "Only account A owns this sample");
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Only account A owns this sample")).toBe(true);
  // Invalid data could be denied by validation even with broken ownership.
  // Prove that the identical schema-valid payload succeeds for its owner.
  const payload = await readServer(clients.request, b.uid);
  for (const [method, uid, expected] of [["PUT", b.uid, 200], ["GET", a.uid, 401], ["PUT", a.uid, 401]]) {
    const status = await b.page.evaluate(async ({ url, method, payload }) => {
      const { auth } = await import("/src/firebase.js");
      const token = await auth.currentUser.getIdToken();
      // ID tokens use RTDB's auth parameter; Bearer is the separate OAuth /
      // administrative API and is not an authenticated client-rules probe.
      const target = new URL(url);
      target.searchParams.set("auth", token);
      const response = await fetch(target, { method, ...(method === "PUT" ? { body: JSON.stringify(payload) } : {}) });
      return response.status;
    }, { url: databaseUrl(`sync/${uid}`), method, payload });
    expect(status).toBe(expected);
  }
  await expect(row(b.page, "Only account A owns this sample")).toHaveCount(0);
  await signOut(a.page);
  expect(await signIn(a.page, b.email, { navigate: false })).toBe(b.uid);
  await appReady(a.page);
  await expect(row(a.page, "Only account A owns this sample")).toHaveCount(0);
});

test("separate laptop and phone sessions receive a task through Firebase", async ({ clients }) => {
  const a = await clients.open();
  const b = await clients.open(a.email, { phone: true });
  expect(a.context).not.toBe(b.context);
  expect(a.uid).toBe(b.uid);
  await addTask(a.page, "Check the sample timetable");
  await expect(row(b.page, "Check the sample timetable")).toBeVisible();
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.filter(t => t.title === "Check the sample timetable").length).toBe(1);
  await signOut(a.page);
  await expect(row(b.page, "Check the sample timetable")).toBeVisible();
  expect(await currentUid(b.page)).toBe(a.uid);
});

// #643: horizon reviews change only through commands decided on the server's
// copy. Two weekly leftovers are seeded with the week's review last dealt with
// three weeks ago, so the open devices detect it (at the same time).
async function seedWeekReview(clients, a) {
  const now = Date.now();
  const week = (uuid, title, id) => ({
    id, uuid, title, userId: a.email, concreteStep: "Open the sample folder",
    horizonLevel: "week", priority: "P2", category: "Personal", timeEstimateMinutes: 25,
    isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false,
    orderIndex: id, lastUpdated: now - 30_000,
  });
  const through = new Date(now - 21 * 86_400_000).toISOString().slice(0, 10);
  const patched = await clients.request.patch(databaseUrl(`sync/${a.uid}`), {
    headers: { Authorization: "Bearer owner" }, // Emulator-only administrative credential.
    data: {
      "tasks/2": week("wk-a", "Return the sample books", 3),
      "tasks/3": week("wk-b", "Label the sample boxes", 4),
      "config/horizonReviews": { week: { through } },
      timestamp: now,
    },
  });
  expect(patched.ok()).toBe(true);
}
const weekReview = async (request, uid) => (await readServer(request, uid)).config.horizonReviews?.week || {};
const horizonOf = async (request, uid, uuid) => (await readServer(request, uid)).tasks.find(t => t.uuid === uuid)?.horizonLevel;

test("a horizon review done on the laptop closes on the phone and stays done after a reload", async ({ clients }) => {
  const a = await clients.open();
  await seedWeekReview(clients, a);
  const reviewA = a.page.getByRole("dialog", { name: /ended$/ });
  await expect(reviewA).toBeVisible();
  const b = await clients.open(a.email, { phone: true });
  const reviewB = b.page.getByRole("dialog", { name: /ended$/ });
  await expect(reviewB).toBeVisible();
  await expect.poll(async () => (await weekReview(clients.request, a.uid)).pending?.uuids?.slice().sort()).toEqual(["wk-a", "wk-b"]);

  await reviewA.getByRole("radiogroup", { name: "Where Label the sample boxes goes" }).getByRole("radio", { name: "Today" }).click();
  await reviewA.getByRole("button", { name: "Done" }).click();
  await expect(reviewA).toHaveCount(0);
  await expect(a.page.locator(".undo-toast")).toContainText("Reviewed:");
  // The phone's open dialog goes by itself once the laptop's Done arrives.
  await expect(reviewB).toHaveCount(0);
  const done = await weekReview(clients.request, a.uid);
  expect(done.pending ?? null).toBe(null);
  expect(done.last).toMatchObject({ today: 1, kept: 1, dropped: 0 });
  expect(done.last.op).toBeTruthy();
  expect(await horizonOf(clients.request, a.uid, "wk-b")).toBe("today");

  // The phone reloading from its cache doesn't bring the finished review back.
  await b.page.reload();
  await appReady(b.page);
  await expect(row(b.page, "Label the sample boxes")).toBeVisible();
  await expect(reviewB).toHaveCount(0);
  expect((await weekReview(clients.request, a.uid)).last.op).toBe(done.last.op);
});

test("Undo of a horizon review restores the review and the moved task on the server", async ({ clients }) => {
  const a = await clients.open();
  await seedWeekReview(clients, a);
  const review = a.page.getByRole("dialog", { name: /ended$/ });
  await expect(review).toBeVisible();
  await review.getByRole("radiogroup", { name: "Where Return the sample books goes" }).getByRole("radio", { name: "Today" }).click();
  await review.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => horizonOf(clients.request, a.uid, "wk-a")).toBe("today");
  await a.page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(a.page.locator(".undo-toast")).toContainText("Review undone.");
  await expect.poll(async () => (await weekReview(clients.request, a.uid)).pending?.uuids?.slice().sort()).toEqual(["wk-a", "wk-b"]);
  expect(await horizonOf(clients.request, a.uid, "wk-a")).toBe("week");
});

// #677: RTDB never stores an empty list. A device holding one (subSteps: []
// after the last step goes) used to see an edit the server could never take:
// every save re-stamped the task, and the device kept its stale copy for good.
const OWNER_AUTH = { Authorization: "Bearer owner" }; // Emulator-only administrative credential.
const serverTask = async (request, uid, uuid) => (await readServer(request, uid)).tasks.find(t => t.uuid === uuid);
const cacheRecord = (client, uuid) => client.page.evaluate(([u, id]) => {
  const r = JSON.parse(localStorage.getItem(`loci_payload_v1_${u}`) || "null");
  const find = l => (l || []).find(t => t.uuid === id) || null;
  return { local: find(r?.payload?.tasks), base: find(r?.base?.tasks), config: r?.payload?.config || null, root: r?.payload?.timestamp };
}, [client.uid, uuid]);
const withoutClock = ({ lastUpdated: _clock, ...rest }) => JSON.stringify(rest);

// Sampled every 500 ms over a settled window, not two end snapshots. The
// #677 signature is a task clock moving with nothing in the task changed.
// `strict`: the task may not change at all (a week task: nothing re-times
// it). Otherwise its clock may move only together with its content (Today's
// route re-times a stop as the minute turns: a real edit, stamped by design).
// This shows stable clocks and contents; it does not count writes.
async function expectStable(request, uid, uuid, { strict = false, ms = 5000 } = {}) {
  let prev = await serverTask(request, uid, uuid);
  const first = prev;
  for (let t = 0; t < ms; t += 500) {
    await new Promise(r => setTimeout(r, 500));
    const now = await serverTask(request, uid, uuid);
    if (strict) {
      expect(now.lastUpdated).toBe(first.lastUpdated);
      expect(withoutClock(now)).toBe(withoutClock(first));
    } else if (now.lastUpdated !== prev.lastUpdated) {
      expect(withoutClock(now)).not.toBe(withoutClock(prev));
    }
    prev = now;
  }
  return prev.lastUpdated;
}

test("#677: removing a task's last steps lands once, then stays quiet; the other device adds one back", async ({ clients }) => {
  const a = await clients.open();
  const b = await clients.open(a.email, { phone: true });
  await row(a.page, "Sort sample notes").locator(".task-title-text").click();
  const sheet = a.page.getByTestId("task-detail");
  // A real stored list first: adding a step also stores the old first step.
  await sheet.getByLabel("Add a step").fill("Sample step one");
  await sheet.getByLabel("Add a step").press("Enter");
  await expect.poll(async () => (await serverTask(clients.request, a.uid, "seed-a")).subSteps?.map(st => st.text))
    .toEqual(["Open the sample folder", "Sample step one"]);
  await sheet.getByRole("button", { name: "Remove step Sample step one" }).click();
  await sheet.getByRole("button", { name: "Remove step Open the sample folder" }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  // RTDB holds no steps at all, not an empty list.
  await expect.poll(async () => {
    const t = await serverTask(clients.request, a.uid, "seed-a");
    return t.concreteStep === undefined && t.subSteps === undefined;
  }).toBe(true);
  const clock = (await serverTask(clients.request, a.uid, "seed-a")).lastUpdated;
  for (const client of [a, b]) {
    await expect.poll(async () => (await cacheRecord(client, "seed-a")).local?.lastUpdated).toBe(clock);
    await expect.poll(async () => (await cacheRecord(client, "seed-a")).base?.lastUpdated).toBe(clock);
  }
  await expectStable(clients.request, a.uid, "seed-a");

  // An unrelated save and a reload don't touch it either.
  await addTask(a.page, "Sample unrelated errand");
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Sample unrelated errand")).toBe(true);
  await a.page.reload();
  await appReady(a.page);
  const settled = await expectStable(clients.request, a.uid, "seed-a");
  await expect.poll(async () => (await cacheRecord(a, "seed-a")).local?.lastUpdated).toBe(settled);

  // A step added back on the phone reaches the laptop.
  await row(b.page, "Sort sample notes").locator(".task-title-text").click();
  const phoneSheet = b.page.getByTestId("task-detail");
  await phoneSheet.getByLabel("Add a step").fill("Sample step back");
  await phoneSheet.getByLabel("Add a step").press("Enter");
  await expect.poll(async () => (await serverTask(clients.request, a.uid, "seed-a")).subSteps?.map(st => st.text)).toEqual(["Sample step back"]);
  await expect.poll(async () => (await cacheRecord(a, "seed-a")).local?.subSteps?.map(st => st.text)).toEqual(["Sample step back"]);
});

// The state the owner's laptop was in: its cached copy of a task holds
// subSteps: [] and an older clock, its base and the server the newer copy
// without steps. Both ways the first delivery can go (useSync onValue): the
// cache's root timestamp older than the server's (the delivery is merged) or
// newer (this device's copy is written back first, which is the only way the
// cache's future root timestamp can reach the server: the observable proof
// that branch ran).
for (const rootNewer of [false, true]) {
  test(`#677: a device stuck on an empty list the server dropped heals and stays quiet (cache root ${rootNewer ? "newer" : "older"})`, async ({ clients }) => {
    const a = await clients.open();
    const T = Date.now() - 10_000;
    const X = {
      id: 9001, uuid: "stuck-x", title: "Sample stuck task", userId: a.email, horizonLevel: "week", priority: "P3",
      category: "Personal", isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false, orderIndex: 6, lastUpdated: T,
    };
    const patched = await clients.request.patch(databaseUrl(`sync/${a.uid}`), { headers: OWNER_AUTH, data: { "tasks/2": X, timestamp: Date.now() } });
    expect(patched.ok()).toBe(true);
    await expect.poll(async () => (await cacheRecord(a, "stuck-x")).base?.lastUpdated).toBe(T);
    const serverRoot = (await readServer(clients.request, a.uid)).timestamp;
    const cachedRoot = rootNewer ? Date.now() + 60_000 : serverRoot - 60_000;
    await a.page.addInitScript(([u, root]) => {
      if (sessionStorage.getItem("stuck-677")) return;
      sessionStorage.setItem("stuck-677", "1");
      const key = `loci_payload_v1_${u}`;
      const rec = JSON.parse(localStorage.getItem(key));
      rec.payload.tasks = rec.payload.tasks.map(t => (t.uuid === "stuck-x" ? { ...t, subSteps: [], lastUpdated: t.lastUpdated - 3000 } : t));
      rec.payload.timestamp = root;
      localStorage.setItem(key, JSON.stringify(rec));
    }, [a.uid, cachedRoot]);
    await a.page.reload();
    await appReady(a.page);
    await expect.poll(async () => (await cacheRecord(a, "stuck-x")).local?.lastUpdated).toBe(T);
    expect((await cacheRecord(a, "stuck-x")).base.lastUpdated).toBe(T);
    expect((await serverTask(clients.request, a.uid, "stuck-x")).lastUpdated).toBe(T);
    const root = (await readServer(clients.request, a.uid)).timestamp;
    if (rootNewer) expect(root).toBe(cachedRoot); // the write-back branch ran
    else expect(root).not.toBe(cachedRoot); // the incoming-merge branch ran: nothing carried the older root up
    await expectStable(clients.request, a.uid, "stuck-x", { strict: true });

    // A second device, an unrelated save from it, and another reload: the
    // task stays exactly as the server had it throughout.
    const b = await clients.open(a.email, { phone: true });
    await expect.poll(async () => (await cacheRecord(b, "stuck-x")).local?.lastUpdated).toBe(T);
    await addTask(b.page, "Sample errand from the phone");
    await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.some(t => t.title === "Sample errand from the phone")).toBe(true);
    await a.page.reload();
    await appReady(a.page);
    await expectStable(clients.request, a.uid, "stuck-x", { strict: true });
    for (const client of [a, b]) {
      const rec = await cacheRecord(client, "stuck-x");
      expect([rec.local.lastUpdated, rec.base.lastUpdated]).toEqual([T, T]);
    }
  });
}

// saveConfigPatch with a value that holds nothing RTDB would store: Coach
// memory's "Forget everything" writes { pinnedFacts: [], recentObservations: [] }.
test("#677: Forget everything in Coach memory lands as no memory on the server, and the config stays quiet", async ({ clients }) => {
  const a = await clients.open();
  const now = Date.now();
  const patched = await clients.request.patch(databaseUrl(`sync/${a.uid}`), {
    headers: OWNER_AUTH,
    data: { "config/coachMemory": { pinnedFacts: [{ text: "Sample remembered fact", createdAt: now, updatedAt: now }] }, timestamp: now },
  });
  expect(patched.ok()).toBe(true);
  await expect.poll(async () => (await cacheRecord(a, "seed-a")).config?.coachMemory?.pinnedFacts?.length).toBe(1);
  await a.page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
  await a.page.getByText("Coach memory", { exact: true }).click();
  await a.page.getByRole("button", { name: "Forget everything", exact: true }).click();
  await a.page.getByRole("dialog").getByRole("button", { name: "Forget everything", exact: true }).click();
  await expect.poll(async () => (await readServer(clients.request, a.uid)).config.coachMemory).toBeUndefined();
  // Sampled: no further config writes (config.lastUpdated) once it landed.
  const settled = (await readServer(clients.request, a.uid)).config.lastUpdated;
  for (let t = 0; t < 5000; t += 500) {
    await new Promise(r => setTimeout(r, 500));
    const config = (await readServer(clients.request, a.uid)).config;
    expect(config.coachMemory).toBeUndefined();
    expect(config.lastUpdated).toBe(settled);
  }
});

// The config counterpart of the stuck task: this device's cached config holds
// the cleared memory, its base and the server hold none. It used to keep it
// for good and ask for a write-back on every delivery.
test("#677: a device stuck holding cleared Coach memory the server dropped lets it go", async ({ clients }) => {
  const a = await clients.open();
  await expect.poll(async () => (await cacheRecord(a, "seed-a")).base?.lastUpdated).toBeTruthy();
  await a.page.addInitScript(([u]) => {
    if (sessionStorage.getItem("stuck-config-677")) return;
    sessionStorage.setItem("stuck-config-677", "1");
    const key = `loci_payload_v1_${u}`;
    const rec = JSON.parse(localStorage.getItem(key));
    rec.payload.config = { ...rec.payload.config, coachMemory: { pinnedFacts: [], recentObservations: [] } };
    localStorage.setItem(key, JSON.stringify(rec));
  }, [a.uid]);
  await a.page.reload();
  await appReady(a.page);
  await expect.poll(async () => (await cacheRecord(a, "seed-a")).config?.coachMemory ?? null).toBeNull();
  expect((await readServer(clients.request, a.uid)).config.coachMemory).toBeUndefined();
});
