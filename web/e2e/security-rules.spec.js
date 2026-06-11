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

test("reliability: bug reports are write-only and tied to the signed-in uid", () => {
  const rules = loadDatabaseRules();
  const bugReportRules = rules.bugReports;
  const createRule = bugReportRules.$reportId[".write"];

  expect(bugReportRules[".read"]).toBe(false);
  expect(createRule).toContain("auth != null");
  expect(createRule).toContain("!data.exists()");
  expect(createRule).toContain("auth.uid === newData.child('userId').val()");
});
