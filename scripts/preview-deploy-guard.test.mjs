import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("a preview-only deployment cannot fall back to live when its channel is missing", () => {
  for (const channel of ["", "live"]) {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./deploy-hosting-rest.mjs", import.meta.url))], {
      encoding: "utf8", env: { ...process.env, HOSTING_PREVIEW_ONLY: "true", HOSTING_CHANNEL_ID: channel, FIREBASE_ACCESS_TOKEN: "synthetic-never-used" }, timeout: 3000,
    });
    assert.ifError(run.error);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /refusing a live release|not a preview channel/);
  }
});
