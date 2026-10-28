#!/usr/bin/env node
// #612: erases the copy of a deleted account once it is 30 days old. "Delete
// all my data" keeps that copy in deletedAccounts/{uid} so the owner can
// restore an account on request; the privacy policy promises it goes after
// 30 days, and this daily job is what keeps that promise. It also erases bug
// reports older than 12 months, the other retention the policy promises.
//
// Required env var: FIREBASE_ACCESS_TOKEN (a Google OAuth2 access token for
// the service account; never logged). The admin token bypasses the rules,
// which let no app read deletedAccounts.

import { pathToFileURL } from "node:url";

const DATABASE_URL = "https://loci-flow-default-rtdb.firebaseio.com";
export const RETENTION_DAYS = 30;
export const BUG_REPORT_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// The uids whose copy is at least RETENTION_DAYS old. A copy with no valid
// deletedAt is erased too: nothing could ever age it out otherwise.
export function expiredIds(deletedAtById, now = Date.now(), days = RETENTION_DAYS) {
  const cutoff = now - days * DAY_MS;
  return Object.entries(deletedAtById || {})
    .filter(([, at]) => typeof at !== "number" || !Number.isFinite(at) || at <= cutoff)
    .map(([id]) => id);
}

function fail(message) {
  console.error(`Purge FAILED: ${message}`);
  process.exit(1);
}

async function call(path, token, options = {}) {
  const res = await fetch(`${DATABASE_URL}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) fail(`${options.method || "GET"} ${path.split("?")[0]} returned HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const token = process.env.FIREBASE_ACCESS_TOKEN;
  if (!token || !token.trim()) fail("FIREBASE_ACCESS_TOKEN is not set.");

  await purge(token, "deletedAccounts", "deletedAt", RETENTION_DAYS, "Deleted-account copies");
  await purge(token, "bugReports", "submittedAt", BUG_REPORT_DAYS, "Bug reports");
}

async function purge(token, node, dateField, days, label) {
  const ids = Object.keys((await call(`${node}.json?shallow=true`, token)) || {});
  const dateById = {};
  for (const id of ids) {
    dateById[id] = await call(`${node}/${encodeURIComponent(id)}/${dateField}.json`, token);
  }
  const expired = expiredIds(dateById, Date.now(), days);
  if (expired.length) {
    const patch = Object.fromEntries(expired.map(id => [`${node}/${id}`, null]));
    await call(".json", token, { method: "PATCH", body: JSON.stringify(patch) });
  }
  // Counts only: no uid, email or report text in the log.
  console.log(`${label}: ${ids.length} before, ${expired.length} erased.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(err => fail(err?.message || String(err)));
}
