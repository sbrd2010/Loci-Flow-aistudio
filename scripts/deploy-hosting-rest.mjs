#!/usr/bin/env node
// Deploys Firebase Hosting using the Firebase Hosting REST API directly,
// instead of firebase-tools (CLI or FirebaseExtended/action-hosting-deploy).
//
// Why: across PR #298-#304, firebase-tools (both 14.x/15.x CLI, and the
// Hosting Action's internal firebase-tools) has repeatedly failed to
// authenticate with this service account - sometimes during the release
// creation call, sometimes during its own OAuth token fetch - even though
// the identical gcloud-issued access token is accepted (HTTP 200) by the
// Firebase Hosting REST API directly. This script removes firebase-tools
// from the Hosting deploy path entirely.
//
// Required env var: FIREBASE_ACCESS_TOKEN (a Google OAuth2 access token for
// the deploying service account; never logged).

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const SITE_ID = "loci-flow";
const HOSTING_API = "https://firebasehosting.googleapis.com/v1beta1";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(repoRoot, "web", "dist");
const firebaseJsonPath = path.join(repoRoot, "firebase.json");

function fail(message) {
  console.error(`Hosting deploy FAILED: ${message}`);
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

async function main() {
  const accessToken = process.env.FIREBASE_ACCESS_TOKEN;
  if (!accessToken || accessToken.trim().length === 0) {
    fail("FIREBASE_ACCESS_TOKEN is not set or empty (could not obtain an access token).");
  }

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

  console.log("Creating hosting version...");
  const createVersionResult = await fetchJson(
    `${HOSTING_API}/sites/${SITE_ID}/versions`,
    { method: "POST", body: JSON.stringify({ config: hostingConfig }) },
    accessToken,
  );
  if (!createVersionResult.ok) {
    fail(`Create version failed with HTTP ${createVersionResult.status}. Response: ${createVersionResult.body}`);
  }
  const versionName = createVersionResult.data.name;
  console.log(`Created hosting version: ${versionName} (HTTP ${createVersionResult.status})`);

  console.log(`Populating ${filePaths.length} file digest(s)...`);
  const populateResult = await fetchJson(
    `${HOSTING_API}/${versionName}:populateFiles`,
    { method: "POST", body: JSON.stringify({ files }) },
    accessToken,
  );
  if (!populateResult.ok) {
    fail(`populateFiles failed with HTTP ${populateResult.status}. Response: ${populateResult.body}`);
  }
  const { uploadUrl, uploadRequiredHashes = [] } = populateResult.data;
  console.log(`Hosting API requires ${uploadRequiredHashes.length} upload(s) out of ${filePaths.length} total file(s) (HTTP ${populateResult.status}).`);

  const hashToPath = new Map();
  for (const [hostingPath, hash] of hashByHostingPath) {
    hashToPath.set(hash, hostingPath);
  }

  let uploadedCount = 0;
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
      fail(`File upload failed for ${hostingPath} with HTTP ${uploadResponse.status}. Response: ${body}`);
    }
    uploadedCount += 1;
  }
  console.log(`Uploaded ${uploadedCount}/${uploadRequiredHashes.length} required file(s) OK.`);

  const finalizeResult = await fetchJson(
    `${HOSTING_API}/${versionName}?update_mask=status`,
    { method: "PATCH", body: JSON.stringify({ status: "FINALIZED" }) },
    accessToken,
  );
  if (!finalizeResult.ok) {
    fail(`Finalize version failed with HTTP ${finalizeResult.status}. Response: ${finalizeResult.body}`);
  }
  console.log(`Finalized hosting version: ${versionName} (HTTP ${finalizeResult.status})`);

  const releaseResult = await fetchJson(
    `${HOSTING_API}/sites/${SITE_ID}/releases?versionName=${encodeURIComponent(versionName)}`,
    { method: "POST", body: JSON.stringify({}) },
    accessToken,
  );
  if (!releaseResult.ok) {
    fail(`Release creation failed with HTTP ${releaseResult.status}. Response: ${releaseResult.body}`);
  }
  console.log(`Created hosting release: ${releaseResult.data.name} (HTTP ${releaseResult.status})`);
  console.log("Hosting deploy completed OK.");
}

main().catch((err) => {
  fail(err?.stack ?? String(err));
});
