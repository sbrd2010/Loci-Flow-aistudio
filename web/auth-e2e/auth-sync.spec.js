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
    await signOut(a.page);
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
  for (const method of ["GET", "PUT"]) {
    const status = await b.page.evaluate(async ({ url, method }) => {
      const { auth } = await import("/src/firebase.js");
      const token = await auth.currentUser.getIdToken();
      // ID tokens use RTDB's auth parameter; Bearer is the separate OAuth /
      // administrative API and is not an authenticated client-rules probe.
      const target = new URL(url);
      target.searchParams.set("auth", token);
      const response = await fetch(target, { method, ...(method === "PUT" ? { body: JSON.stringify({ stolen: true }) } : {}) });
      return response.status;
    }, { url: databaseUrl(`sync/${a.uid}`), method });
    expect(status).toBe(401);
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
