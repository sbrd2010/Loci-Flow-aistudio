import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

function loadDatabaseRules() {
  return JSON.parse(
    readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8")
  ).rules;
}

test("reliability: RTDB sync data remains scoped to the signed-in uid", () => {
  const rules = loadDatabaseRules();
  const userSyncRules = rules.sync.$userId;

  expect(userSyncRules[".read"]).toBe("auth != null && auth.uid === $userId");
  expect(userSyncRules[".write"]).toBe("auth != null && auth.uid === $userId");
  expect(rules.$other[".read"]).toBe(false);
  expect(rules.$other[".write"]).toBe(false);
});

test("reliability: chatHistory messages accept the 'actions' field CoachTab attaches to action replies", () => {
  // CoachTab.jsx attaches an `actions` field to any coach reply where a
  // visible action fired (e.g. a START_FOCUS/ADD_TASK chip). Without an
  // explicit rule for it, the message falls through to $other: false and
  // the whole chatHistory array write is rejected with PERMISSION_DENIED —
  // indistinguishable from an auth failure — breaking chat sync for the
  // rest of that conversation.
  const rules = loadDatabaseRules();
  const msgRules = rules.sync.$userId.chatHistory.$msgIdx;

  expect(msgRules.actions).toBeDefined();
  expect(msgRules.actions[".validate"]).toBe(true);
});

test("reliability: activityLogs analytics data remains scoped to the signed-in uid", () => {
  // The analytics ledger lives at activityLogs/{uid}, a root deliberately
  // separate from sync/{uid} (so the normal payload listener never
  // downloads it). The top-level $other: false catch-all denies any path
  // without its own explicit block — without this block, every analytics
  // write is silently PERMISSION_DENIED, indistinguishable from a real
  // auth failure to the fail-soft write logic that has to tell them apart.
  const rules = loadDatabaseRules();
  const activityLogRules = rules.activityLogs.$userId;

  expect(activityLogRules[".read"]).toBe("auth != null && auth.uid === $userId");
  expect(activityLogRules[".write"]).toBe("auth != null && auth.uid === $userId");
  expect(rules.$other[".read"]).toBe(false);
  expect(rules.$other[".write"]).toBe(false);
});

test("reliability: bug reports are write-only and tied to the signed-in uid", () => {
  const rules = loadDatabaseRules();
  const bugReportRules = rules.bugReports;
  const createRule = bugReportRules.$reportId[".write"];

  expect(bugReportRules[".read"]).toBe(false);
  expect(createRule).toContain("auth != null");
  expect(createRule).toContain("!data.exists()");
  expect(createRule).toContain("auth.uid === newData.child('userId').val()");
});
