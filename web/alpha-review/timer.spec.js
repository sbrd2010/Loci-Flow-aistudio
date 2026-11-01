import { test, expect } from "@playwright/test";
import { user, seed, database, isolate, login } from "./local-fixture.js";

test("finishing an older save must not prevent flushing a newer pending edit", async ({ page, context }) => {
  const u = await user(); await seed(u);
  await isolate(context);
  await context.route("**/src/useSync.js*", async route => {
    const source = await (await route.fetch()).text();
    const instrumented = source.replace("update, runTransaction, get", "update, runTransaction as nativeTransaction, get");
    expect(instrumented).not.toBe(source);
    await route.fulfill({ contentType: "text/javascript", body: `${instrumented}\nconst runTransaction = (...args) => window.reviewTransaction ? window.reviewTransaction(nativeTransaction, ...args) : nativeTransaction(...args);` });
  });
  await login(page, u);
  await page.evaluate(() => {
    let first = true;
    window.transactionStarts = 0;
    window.reviewTransaction = async (native, ...args) => {
      window.transactionStarts++;
      const result = await native(...args);
      if (first) {
        first = false;
        window.firstCommitted = true;
        await new Promise(resolve => { window.finishFirst = resolve; });
      }
      return result;
    };
    const p = window.review.payload;
    window.firstSave = window.review.savePayloadAsync({ ...p, tasks: p.tasks.map(t => ({ ...t, title: "First edit", lastUpdated: Date.now() })) });
  });
  await expect.poll(() => page.evaluate(() => window.firstCommitted)).toBe(true);
  await page.evaluate(async () => {
    const p = window.review.payload;
    window.review.savePayload({ ...p, tasks: p.tasks.map(t => ({ ...t, title: "Newest edit", lastUpdated: Date.now() + 1 })) });
    window.finishFirst(); await window.firstSave;
    // Let the older transaction's finally run before the explicit flush.
    await new Promise(resolve => setTimeout(resolve, 0));
    window.review.flushNow();
  });
  expect(await page.evaluate(() => window.transactionStarts)).toBe(2);
  await expect.poll(async () => (await (await database(u, `sync/${u.uid}`)).json()).tasks[0].title).toBe("Newest edit");
});

