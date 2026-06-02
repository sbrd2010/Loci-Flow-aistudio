import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "loci-flow";
const DB_NAMESPACE = process.env.FIREBASE_DATABASE_NAMESPACE || "loci-flow-default-rtdb";
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function authUrl(endpoint) {
  return `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/${endpoint}?key=fake-api-key`;
}

function dbUrl(path, idToken) {
  const params = new URLSearchParams({ ns: DB_NAMESPACE });
  if (idToken) params.set("auth", idToken);
  return `http://${DB_HOST}/${path.replace(/^\/+/, "")}.json?${params.toString()}`;
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = null;
  }
  return { res, body };
}

async function createAuthUser(label) {
  const email = `${label}-${randomUUID()}@example.test`;
  const { res, body } = await jsonFetch(authUrl("accounts:signUp"), {
    method: "POST",
    body: JSON.stringify({
      email,
      password: "CorrectHorseBatteryStaple42!",
      returnSecureToken: true
    })
  });

  assert.equal(res.ok, true, `Auth emulator should create ${label}: ${JSON.stringify(body)}`);
  assert.equal(typeof body.localId, "string");
  assert.equal(typeof body.idToken, "string");

  return {
    uid: body.localId,
    email: body.email,
    idToken: body.idToken
  };
}

function validSyncPayload(user) {
  return {
    userId: user.email,
    tasks: [
      {
        id: `task-${randomUUID()}`,
        title: "Rules test task",
        userId: user.email,
        concreteStep: "Verify Firebase rules",
        horizonLevel: "today"
      }
    ],
    config: {
      userId: user.email,
      userName: "Rules Test User"
    },
    timestamp: Date.now()
  };
}

async function putJson(path, data, idToken) {
  return jsonFetch(dbUrl(path, idToken), {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

async function getJson(path, idToken) {
  return jsonFetch(dbUrl(path, idToken), { method: "GET" });
}

async function assertAllowed(result, message) {
  assert.equal(result.res.ok, true, `${message}; got ${result.res.status}: ${JSON.stringify(result.body)}`);
}

async function assertDenied(result, message) {
  assert.equal(result.res.ok, false, `${message}; request was unexpectedly allowed`);
  assert.ok([401, 403].includes(result.res.status), `${message}; expected 401/403, got ${result.res.status}`);
}

test("authenticated users can read/write only their own sync path", async () => {
  const userA = await createAuthUser("user-a");
  const userB = await createAuthUser("user-b");

  await assertAllowed(
    await putJson(`sync/${userA.uid}`, validSyncPayload(userA), userA.idToken),
    "user A should write sync/userA"
  );
  await assertAllowed(
    await getJson(`sync/${userA.uid}`, userA.idToken),
    "user A should read sync/userA"
  );

  await assertAllowed(
    await putJson(`sync/${userB.uid}`, validSyncPayload(userB), userB.idToken),
    "user B should write sync/userB"
  );
  await assertAllowed(
    await getJson(`sync/${userB.uid}`, userB.idToken),
    "user B should read sync/userB"
  );

  await assertDenied(
    await putJson(`sync/${userB.uid}`, validSyncPayload(userA), userA.idToken),
    "user A must not write sync/userB"
  );
  await assertDenied(
    await getJson(`sync/${userB.uid}`, userA.idToken),
    "user A must not read sync/userB"
  );
});

test("unauthenticated users cannot read or write protected sync paths", async () => {
  const userA = await createAuthUser("anonymous-target");

  await assertDenied(
    await putJson(`sync/${userA.uid}`, validSyncPayload(userA)),
    "unauthenticated request must not write sync path"
  );
  await assertDenied(
    await getJson(`sync/${userA.uid}`),
    "unauthenticated request must not read sync path"
  );
});

test("bug reports are write-only, authenticated, email-bound, and create-only", async () => {
  const userA = await createAuthUser("bug-user-a");
  const userB = await createAuthUser("bug-user-b");
  const reportId = `rules-test-${randomUUID()}`;
  const report = {
    what: "Rules test bug report",
    steps: "Run Firebase emulator rule tests",
    device: "CI Firebase emulator",
    userId: userA.email,
    appVersion: "rules-test",
    submittedAt: Date.now()
  };

  await assertAllowed(
    await putJson(`bugReports/${reportId}`, report, userA.idToken),
    "authenticated matching email should create bug report"
  );
  await assertDenied(
    await getJson(`bugReports/${reportId}`, userA.idToken),
    "bug reports must not be readable"
  );
  await assertDenied(
    await putJson(`bugReports/${reportId}`, { ...report, what: "Overwrite attempt" }, userA.idToken),
    "bug reports must be create-only"
  );
  await assertDenied(
    await putJson(`bugReports/rules-test-${randomUUID()}`, { ...report, userId: userA.email }, userB.idToken),
    "authenticated user must not submit report for a different email"
  );
  await assertDenied(
    await putJson(`bugReports/rules-test-${randomUUID()}`, report),
    "unauthenticated user must not create bug report"
  );
});

console.log(`Firebase rules tests ran against project ${PROJECT_ID}, database namespace ${DB_NAMESPACE}.`);
