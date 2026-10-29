# Signed-in authentication and sync checks (#109)

These tests mount the real React app against Firebase Auth and Realtime
Database emulators. They use the app's Google sign-in button and the Auth
Emulator's fake Google identity screen. Test actions use the normal UI,
`useSync`, Firebase transactions, and repository database rules. They do not
use demo mode or mock the sync SDK.

## Run

Prerequisites: Node 22+, Java 21, dependencies installed in `web/`, and Chromium
installed by Playwright. Ports 9099, 9000, 4400, 4500, and 5175 must be free.

```bash
cd web
npm ci --legacy-peer-deps
npx playwright install --with-deps chromium
npm run test:auth-sync
```

The command starts both emulators with the fixed demo project
`demo-loci-flow-e2e`, starts Vite on port 5175, runs Playwright, and stops the
processes it started. The separate `Signed-in auth and sync` CI job runs the
same command. The usual demo E2E configuration remains separate.

For an existing system Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`. In the Codex cloud
environment, source `/workspace/.loci-tools/activate.sh` and use
`/usr/bin/chromium`. If Firebase CLI 15.22.1 is already cached but npm network
access is unavailable, `npm_config_offline=true` uses that cache. Neither
case disables package integrity or TLS verification.

For a targeted case, start the emulators separately from the repo root:

```bash
npx --yes firebase-tools@15.22.1 emulators:start --only auth,database --project demo-loci-flow-e2e
# In another terminal, from web/:
npx playwright test --config playwright.auth-sync.config.js --grep 'concurrent additions'
```

Firebase's popup resolver still loads the public Google script from
`apis.google.com`, even when Auth is emulated. The browser needs access to
that host. Authentication tokens and user data remain in the emulators.
No real Google password, service account, AI key, or production task data is
needed. Production builds ignore `VITE_USE_FIREBASE_EMULATORS`; unit tests
cover that boundary.

## What is checked

- New Google-emulator account creation, onboarding, and persistence after refresh.
- Repeated sign-out/sign-in without refreshing the page, including the sign-in
  busy-state regression found by this suite.
- A task saved in one client appearing in another and in a fresh context
  without the first client's auth, localStorage, IndexedDB, or cache.
- Concurrent additions and edits to different tasks in both reconnection orders.
- Offline edits surviving an online client's unrelated addition.
- A newer deletion staying deleted when an older client reconnects.
- Independent settings keys surviving two stale clients.
- Same-task conflicts with controlled clock skew and equal timestamps.
- An earlier write response arriving after a newer local edit and another
  client's addition.
- Remote completion stopping the other client's active focus UI.
- A delayed old-account response arriving after account switching on the
  same page, without becoming the new account's data.
- Separate-account UI isolation and denied cross-account REST reads/writes
  using actual emulator ID tokens. An unauthenticated-read check fails setup
  immediately if the namespace has permissive rather than repository rules.

## How the race tests work

Two isolated contexts represent a laptop and a phone viewport. Both sign into
the same fake Google identity; the suite verifies that the resolved Firebase
UID is identical. Each context has independent auth persistence, local cache,
pending saves, and network controls. Matching email labels alone would not
establish that they share an account.

Both clients load the same confirmed starting tasks. Their network connections
are then disabled while each queues a different UI edit. The server is checked
independently, and the connections are restored in a prescribed order, waiting
for the first client's server write before restoring the second. The tests
repeat the opposite order. This forces the stale-client merge and queued-save
path rather than relying on two clicks happening close together.

The delayed-response tests forward real database HTTP requests but temporarily
hold responses containing a particular changed payload. They confirm that
the server committed the first edit while the browser is still awaiting that
response, then perform another edit or account switch before releasing it.
The barrier does not replace the server response or the merge implementation.

Assertions cover the rendered UI, emulator database, and a fresh client. The
emulator-only administrative credential is used for fixture reset, seed, and
independent reads; tested user edits go through the app. The suite is serial
because it resets its dedicated emulator project between scenarios. Do not
point another test runner at those emulator ports concurrently.

## Current conflict contract and limits

Tasks are whole-record merges keyed by UUID (or legacy ID), largely ordered by
the client's `lastUpdated`. Different fields of the same task are not merged
independently. An ahead-of-time client's task can win despite a later-arriving
edit from another device. A timestamp tie prefers remote on incoming delivery
and local on a transaction write; the equal-time test permits either candidate
but requires both clients and the server to converge to that complete record.
These are documented existing policies, not a promise to retain both competing
versions or a new conflict-resolution UI. Config uses a separate per-key,
base-aware merge.

Network recovery tests assert that the offline/write-failure message is absent
after successful convergence. They do not establish every mobile operating
system's connection detection, tab suspension, browser kill, or focus-ledger
accounting behaviour. The delayed account-switch case covers an unacknowledged
write already committed by the server; it does not establish safe offline
logout with unsent changes.

## Remaining release checks

Before inviting the full 20–25 testers, use a dedicated test Google account
on a real laptop and phone:

1. Complete real Google sign-in, cancel a popup, sign out, and sign back in.
2. Create/edit/complete a task on each device and confirm it on the other.
3. Disconnect one device, make unrelated changes on both, reconnect, and refresh.
4. Check account switching, including pending/failed saves and offline logout.
5. Background/lock the phone during focus and reopen it.

Use a second dedicated account to check separation. The automated emulator
identities do not prove real Google OAuth, Safari/PWA storage behaviour,
Android native authentication, OS suspension, or every conflict combination.
Offline app-shell caching (issue #109 item 8) and activity-ledger redesign
remain separate. Passing this suite alone does not close all of #109 or
establish public-launch readiness.
