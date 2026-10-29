import { test, expect } from "@playwright/test";
import { user, seed, isolate, login } from "./local-fixture.js";

test("a delayed callback from A cannot overwrite the active B account's local state", async ({ page, context }) => {
  const a = await user(), b = await user();
  await seed(a); await seed(b);
  await isolate(context); await login(page, a);
  await page.evaluate(() => {
    window.staleSaves = window.review;
    window.oldPayload = window.review.payload;
  });
  await page.evaluate(async email => {
    const firebase = await import("/src/firebase.js");
    await firebase.reviewSignOut(); await firebase.reviewSignIn(email);
  }, b.email);
  await expect.poll(() => page.evaluate(() => window.review?.uid)).toBe(b.uid);
  await expect.poll(() => page.evaluate(() => window.review?.payload?.config?.userId)).toBe(b.email);
  const calls = ["savePayload", "savePayloadAsync", "saveSubPath", "saveSubPathAsync", "saveSubPaths", "saveSubPathsAsync", "saveConfigPatch"];
  for (const method of calls) {
    await page.evaluate(async method => {
      const old = window.staleSaves;
      if (method.startsWith("savePayload")) await Promise.resolve(old[method](window.oldPayload)).catch(() => {});
      else if (method.startsWith("saveSubPaths")) await Promise.resolve(old[method]({ chatHistory: [{ text: "A's delayed response", isUser: false }] })).catch(() => {});
      else if (method.startsWith("saveSubPath")) await Promise.resolve(old[method]("chatHistory", [{ text: "A's delayed response", isUser: false }])).catch(() => {});
      else old[method]({ mentorName: "A's delayed response" });
    }, method);
    expect(await page.evaluate(() => window.review?.payload?.config?.userId), method).toBe(b.email);
    expect(await page.evaluate(() => window.review.payload.chatHistory), method).toBeUndefined();
    expect(await page.evaluate(() => window.review.payload.config.mentorName), method).toBeUndefined();
  }
});

