#!/usr/bin/env node
// Deploys Firebase Hosting and Realtime Database rules using the Firebase
// REST APIs directly, instead of the firebase-tools CLI.
//
// Why: gcloud/ADC auth against this service account works (confirmed via
// gcloud auth print-access-token and via google-github-actions/auth), and
// the same access token is accepted by the Firebase Management API and the
// Firebase Hosting API (HTTP 200 on both, confirmed in CI). firebase-tools
// itself fails to authenticate with the identical token across both major
// versions tested (14.x and 15.x), with no further diagnostic detail. This
// script removes the firebase-tools auth path from production deploys
// entirely, replacing it with direct REST calls authenticated by the same
// access token that is already proven to work.
//
// Required env var: FIREBASE_ACCESS_TOKEN (a Google OAuth2 access token for
// the deploying service account; never logged).

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const PROJECT_ID = "loci-flow";
const SITE_ID = "loci-flow";
const DATABASE_URL = "https://loci-flow-default-rtdb.firebaseio.com";
const HOSTING_API = "https://firebasehosting.googleapis.com/v1beta1";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(repoRoot, "web", "dist");
const firebaseJsonPath = path.join(repoRoot, "firebase.json");
const databaseRulesPath = path.join(repoRoot, "database.rules.json");

function fail(message) {
  console.error(`Deploy FAILED: ${message}`);
  process.exit(1);
}

function getAccessToken() {
  const token = process.env.FIREBASE_ACCESS_TOKEN;
  if (!token || token.trim().length === 0) {
    fail("FIREBASE_ACCESS_TOKEN is not set or empty (could not obtain an access token).");
  }
  return token;
}

async function readSanitizedBody(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return "(could not read response body)";
  }
  // Defensive only: Firebase/GCP error bodies don't contain credentials, but
  // strip anything that looks like a token/JWT/key just in case, and cap length.
  const sanitized = text.replace(/(ya29\.[\w.\-]+|eyJ[\w.\-]+|-----BEGIN[\s\S]*?-----END[^\n]*-----)/g, "[redacted]");
  return sanitized.slice(0, 2000);
}

async function fetchJson(url, options, accessToken) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await readSanitizedBody(response);
    return { ok: false, status: response.status, body };
  }
  const data = await response.json().catch(() => ({}));
  return { ok: true, status: response.status, data };
}

async function deployDatabaseRules(accessToken) {
  console.log("Deploying Realtime Database rules...");
  let rulesContent;
  try {
    rulesContent = await readFile(databaseRulesPath, "utf8");
  } catch {
    fail(`Could not read database rules source file at ${databaseRulesPath}`);
  }
  if (rulesContent.trim().length === 0) {
    fail("database.rules.json is empty.");
  }

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
  console.log("Database rules deployed OK.");
}

function buildHostingConfig(firebaseJson) {
  const hosting = firebaseJson.hosting ?? {};
  const config = {};

  if (typeof hosting.cleanUrls === "boolean") {
    config.cleanUrls = hosting.cleanUrls;
  }

  if (Array.isArray(hosting.headers)) {
    config.headers = hosting.headers.map((entry) => {
      const headerMap = {};
      for (const h of entry.headers ?? []) {
        headerMap[h.key] = h.value;
      }
      return { glob: entry.source, headers: headerMap };
    });
  }

  if (Array.isArray(hosting.rewrites)) {
    config.rewrites = hosting.rewrites.map((entry) => ({
      glob: entry.source,
      path: entry.destination,
    }));
  }

  return config;
}

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function deployHosting(accessToken) {
  console.log("Deploying Firebase Hosting...");

  let distStat;
  try {
    distStat = await stat(distDir);
  } catch {
    fail(`Build output directory not found at ${distDir}. Did "npm run build" run first?`);
  }
  if (!distStat.isDirectory()) {
    fail(`${distDir} exists but is not a directory.`);
  }

  let firebaseJson;
  try {
    firebaseJson = JSON.parse(await readFile(firebaseJsonPath, "utf8"));
  } catch (err) {
    fail(`Could not read/parse firebase.json: ${err.message}`);
  }
  const hostingConfig = buildHostingConfig(firebaseJson);

  const filePaths = await listFilesRecursive(distDir);
  if (filePaths.length === 0) {
    fail(`No files found in ${distDir} to deploy.`);
  }
  console.log(`Found ${filePaths.length} file(s) in web/dist.`);

  const gzipByHostingPath = new Map();
  const hashByHostingPath = new Map();
  const files = {};

  for (const filePath of filePaths) {
    const relativePath = "/" + path.relative(distDir, filePath).split(path.sep).join("/");
    const content = await readFile(filePath);
    const gzipped = gzipSync(content);
    const hash = createHash("sha256").update(gzipped).digest("hex");
    gzipByHostingPath.set(relativePath, gzipped);
    hashByHostingPath.set(relativePath, hash);
    files[relativePath] = hash;
  }

  const createVersionResult = await fetchJson(
    `${HOSTING_API}/sites/${SITE_ID}/versions`,
    { method: "POST", body: JSON.stringify({ config: hostingConfig }) },
    accessToken,
  );
  if (!createVersionResult.ok) {
    fail(`Hosting create version failed with HTTP ${createVersionResult.status}. Response: ${createVersionResult.body}`);
  }
  const versionName = createVersionResult.data.name;
  console.log(`Created hosting version: ${versionName}`);

  const populateResult = await fetchJson(
    `${HOSTING_API}/${versionName}:populateFiles`,
    { method: "POST", body: JSON.stringify({ files }) },
    accessToken,
  );
  if (!populateResult.ok) {
    fail(`Hosting populateFiles failed with HTTP ${populateResult.status}. Response: ${populateResult.body}`);
  }
  const { uploadUrl, uploadRequiredHashes = [] } = populateResult.data;
  console.log(`Hosting API requires ${uploadRequiredHashes.length} file upload(s) out of ${filePaths.length} total.`);

  const hashToPath = new Map();
  for (const [hostingPath, hash] of hashByHostingPath) {
    hashToPath.set(hash, hostingPath);
  }

  for (const hash of uploadRequiredHashes) {
    const hostingPath = hashToPath.get(hash);
    if (!hostingPath) {
      fail(`Hosting API requested upload of unknown hash ${hash} (no matching local file).`);
    }
    const gzipped = gzipByHostingPath.get(hostingPath);
    const uploadResponse = await fetch(`${uploadUrl}/${hash}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: gzipped,
    });
    if (!uploadResponse.ok) {
      const body = await readSanitizedBody(uploadResponse);
      fail(`Hosting file upload failed for ${hostingPath} with HTTP ${uploadResponse.status}. Response: ${body}`);
    }
  }
  console.log("All required hosting files uploaded OK.");

  const finalizeResult = await fetchJson(
    `${HOSTING_API}/${versionName}?update_mask=status`,
    { method: "PATCH", body: JSON.stringify({ status: "FINALIZED" }) },
    accessToken,
  );
  if (!finalizeResult.ok) {
    fail(`Hosting finalize version failed with HTTP ${finalizeResult.status}. Response: ${finalizeResult.body}`);
  }
  console.log(`Finalized hosting version: ${versionName}`);

  const releaseResult = await fetchJson(
    `${HOSTING_API}/sites/${SITE_ID}/releases?versionName=${encodeURIComponent(versionName)}`,
    { method: "POST", body: JSON.stringify({}) },
    accessToken,
  );
  if (!releaseResult.ok) {
    fail(`Hosting release creation failed with HTTP ${releaseResult.status}. Response: ${releaseResult.body}`);
  }
  console.log(`Created hosting release: ${releaseResult.data.name}`);
}

async function main() {
  const accessToken = getAccessToken();
  console.log(`Deploying project "${PROJECT_ID}" (hosting site "${SITE_ID}") via Firebase REST APIs.`);
  await deployDatabaseRules(accessToken);
  await deployHosting(accessToken);
  console.log("Deploy completed OK.");
}

main().catch((err) => {
  fail(err?.stack ?? String(err));
});
