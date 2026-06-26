#!/usr/bin/env node
// Deploys Realtime Database rules via the Firebase REST API, instead of the
// firebase-tools CLI.
//
// Why: firebase-tools fails to authenticate with this service account
// across both major versions tested (14.x and 15.x), even though the same
// gcloud-issued access token is accepted by Firebase's REST APIs directly.
// This script deploys database rules via that REST endpoint while we test
// whether FirebaseExtended/action-hosting-deploy@v0 (a different auth path)
// can still handle Hosting.
//
// Required env var: FIREBASE_ACCESS_TOKEN (a Google OAuth2 access token for
// the deploying service account; never logged).

import { readFile } from "node:fs/promises";
import path from "node:path";

const DATABASE_URL = "https://loci-flow-default-rtdb.firebaseio.com";
const repoRoot = path.resolve(import.meta.dirname, "..");
const databaseRulesPath = path.join(repoRoot, "database.rules.json");

function fail(message) {
  console.error(`Database rules deploy FAILED: ${message}`);
  process.exit(1);
}

async function readSanitizedBody(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return "(could not read response body)";
  }
  const sanitized = text.replace(/(ya29\.[\w.\-]+|eyJ[\w.\-]+|-----BEGIN[\s\S]*?-----END[^\n]*-----)/g, "[redacted]");
  return sanitized.slice(0, 2000);
}

async function main() {
  const accessToken = process.env.FIREBASE_ACCESS_TOKEN;
  if (!accessToken || accessToken.trim().length === 0) {
    fail("FIREBASE_ACCESS_TOKEN is not set or empty (could not obtain an access token).");
  }

  let rulesContent;
  try {
    rulesContent = await readFile(databaseRulesPath, "utf8");
  } catch {
    fail(`Could not read database rules source file at ${databaseRulesPath}`);
  }
  if (rulesContent.trim().length === 0) {
    fail("database.rules.json is empty.");
  }

  console.log("Deploying Realtime Database rules via REST...");
  const response = await fetch(`${DATABASE_URL}/.settings/rules.json`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: rulesContent,
  });

  if (!response.ok) {
    const body = await readSanitizedBody(response);
    fail(`Database rules PUT failed with HTTP ${response.status}. Response: ${body}`);
  }
  console.log("Database rules deployed OK via REST.");
}

main().catch((err) => {
  fail(err?.stack ?? String(err));
});
