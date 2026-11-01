import { test, expect } from "@playwright/test";
import { user, seed, database, isolate, login } from "./local-fixture.js";

for (const reload of [false, true]) {
test(`a later edit survives a five-minute clock difference${reload ? " after reloading the cache" : ""}`, async ({ browser }) => {
  const u = await user(); await seed(u);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const c of contexts) await isolate(c);
    const [normal, ahead] = await Promise.all(contexts.map(c => c.newPage()));
    await login(normal, u); await login(ahead, u);
    await ahead.clock.setFixedTime(new Date(Date.now() + 5 * 60_000));
    const edit = (page, title) => page.evaluate(async title => {
      const p = window.review.payload;
      await window.review.savePayloadAsync({ ...p, tasks: p.tasks.map(t => ({ ...t, title, lastUpdated: Date.now() })) });
    }, title);
    await edit(ahead, "Earlier edit from ahead clock");
    await expect.poll(() => normal.evaluate(() => window.review.payload?.tasks?.[0]?.title)).toBe("Earlier edit from ahead clock");
    if (reload) {
      await normal.reload();
      await expect.poll(() => normal.evaluate(() => window.review?.payload?.tasks?.[0]?.title)).toBe("Earlier edit from ahead clock");
      // That title can come from the local cache first; a save before the
      // database answers is cancelled by design, so wait for the answer.
      await expect.poll(() => normal.evaluate(() => window.review?.isSyncingFromCache)).toBe(false);
    }
    await edit(normal, "Later edit from correct clock");
    expect((await (await database(u, `sync/${u.uid}`)).json()).tasks[0].title).toBe("Later edit from correct clock");
    for (const page of [normal, ahead]) {
      await expect.poll(() => page.evaluate(() => window.review?.payload?.tasks?.[0]?.title)).toBe("Later edit from correct clock");
    }
  } finally { await Promise.all(contexts.map(c => c.close())); }
});

}
