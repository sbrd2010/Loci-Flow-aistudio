# Loci private alpha security and data-integrity review

Review date: 29 October 2026. Source baseline: `8f50be6`.

This is a local, evidence-led review for expansion from one user to 5–20 users.
Findings distinguish reproduced defects, confirmed design limitations, and
unverified hypotheses. Passing a test establishes its specific assertion, not
the absence of other vulnerabilities.

## Scope and safeguards

- Review web authentication, account transitions, sync, Coach actions, AI relay,
  owner-only MCP connector, deletion/recovery, time accounting, and exports.
- Use synthetic users and content. Never copy the owner's live data into tests.
- Use the `demo-loci-review` Firebase project on local emulators only. Browser
  tests replace Firebase configuration before initialization and block external
  requests. AI tests use generated signing keys and fake upstream providers.
- No production attacks, load tests, paid AI calls, deployment, or IAM changes.
- Follow the supplied `root-cause-debug` skill: evidence, smallest reproduction,
  one root-cause hypothesis, failing test before a fix, focused verification.

## Guarantees and trust boundaries

| Guarantee | Enforcement to inspect | Adversarial check |
| --- | --- | --- |
| A accesses only A's data | Firebase UID path rules; browser UID gate | Nested reads/writes, mixed-account PATCH, in-flight save during switch |
| Saved work survives reconnects | Cache/base pair; transaction merge; retry/debounce | Two clients, interrupted save, stale offline edit, delete/undo |
| Sign-out separates users | Auth state, cache, keys, drafts, timers, notifications | A to B in the same browser; delayed AI reply |
| Shared AI use is bounded | Relay authorization and server-side metering | Direct calls exceeding browser allowance; concurrent calls |
| Coach changes require intended action | Intent checks, action chips, current task identity | Similar titles, replay, stale/deleted task, injected tags |
| Deleted data cannot return | Atomic deletion and immutable tombstone | Offline client reconnect; stale token; copy retention |
| Connector remains owner-only | OAuth email check, fixed UID, read scope, service-account IAM | Wrong account/scope/UID, redirect tricks, forbidden data parts |
| Time accounting is consistent | Loci-day helpers, focus-session IDs, recovery | Midnight, DST, clock shifts, two tabs |
| Untrusted content stays content | React/Markdown sanitation, export encoding | Script URLs/HTML/images; spreadsheet formulas |

## Baseline

- Web unit tests: 2,775 passed across 116 files.
- AI relay unit tests: 61 passed across 2 files.
- MCP connector unit tests: 117 passed across 8 files.
- Firebase Auth/RTDB REST emulator suite: 5 passed, including account deletion.
- Retention/purge unit checks: 4 passed.

## Release assessment

**All seven reproduced findings now have proposed fixes; release gates remain.**
The most serious reproduced case was loss of a new task through ordinary
offline use and sign-out. Its fix requires confirmed persistence or an explicit
discard choice. The fixes are in draft PRs and must pass CI, review and staging checks before
invitations. F06 fixes the reproduced sequential-edit case; genuinely concurrent
same-task edits retain the existing timestamp policy. There is no claim that the entire app is vulnerability-free.

The owner confirmed that shared Groq, Ollama, Gemini, OpenRouter, NVIDIA,
Cloudflare Workers AI and Z.ai accounts are free, with no credit card. Cerebras
is optional and uses a person's own key. Shared-AI abuse is therefore assessed
as availability/allowance exhaustion under that setup, not unexpected charges.

## Findings

| ID | Priority | Finding | Status |
| --- | --- | --- | --- |
| F01 | P1 | Offline sign-out can erase an unsynced task | Proposed in #629; local regressions pass |
| F02 | P1 | A previous account's delayed save callback can invalidate the next account's local payload | Proposed in #628; local regression passes |
| F03 | P1 | An older save's completion clears a newer debounce timer reference | Proposed in #627; local regression passes |
| F04 | P2 | Personal AI keys survive normal sign-out | Proposed in #626; local regressions pass |
| F05 | P2 | Browser AI allowances do not constrain direct relay calls | Proposed in #631/#632; local SQLite/runtime checks pass |
| F06 | P2 | A device clock five minutes ahead silently defeats later task edits | Proposed in #630; two-client/reload regressions pass |
| F07 | P2 | Exported task text can become a spreadsheet formula | Proposed in #625; exported-file regression passes |

### F01 — Unsynced work is lost on offline sign-out

Sources: `web/src/App.jsx`, `handleSwitchUser`; `web/src/useSync.js`,
`flushNow` and `clearCache`. The connection-error screen has another sign-out
handler with the same ordering.

Original reproduction (before the sign-out fix):

1. Sign in to the local emulator and load the existing plan.
2. Disconnect the Firebase SDK and create a second task through `savePayload`.
3. Execute the exact ordering used by the app: `flushNow()`, `clearCache()`,
   then sign out. The flush starts a transaction but returns before confirmation.
4. Reload and sign back in. The second task is absent both locally and on the
   server. The pending SDK write did not survive the page reload, and its only
   durable recovery copy was removed by `clearCache()`.

The original reproduction drove the real sync hook and SDK with the app's
sign-out sequence. The final regression drives the full App's real Settings
sign-out button, with test-only hook instrumentation to create the exact unsaved
state. It does not drive the task-creation UI.

Fix: `flushNow({ confirm: true })` confirms the whole latest payload, including
previously failed child-path writes. Sign-out waits up to five seconds before
removing the cache. If saving cannot be confirmed, the app and recovery copy
remain available, with reconnect/backup guidance. A separate confirmation lets
the user deliberately discard unsaved changes. A local edit sequence prevents a
save acknowledgement from declaring edits made during the wait already saved.
An account check prevents a pending sign-out from acting on a different account.
The connection-error sign-out route uses the same save-before-sign-out handler.

Browser regressions verify offline refusal without cache loss, successful save
after reconnect/retry, explicit discard, and refusal to confirm newer local edits
that were not part of the acknowledged write. The connection-error route is
wired to the shared handler but was not independently driven through its UI.

### F02 — Stale account callbacks mutate current refs

Sources: `web/src/useSync.js`, all local mutation entry points.

A save function captured under A still closed over A's UID while reading refs
that had moved to B. Calling it after the account switch could change B's local
state and mark that payload as A's. The existing return-value UID gate then
hid the payload, making B's app unusable. Existing database rules still refused
cross-account writes; the reproduced failure is local-state corruption, not a
demonstrated database authorization bypass.

Fix: ignore/reject stale-account mutations before touching local state or
sending a write; gate stale deliveries and explicit flushes as well.
The browser test captures all seven full/sub-path/config save APIs under A,
switches to B, invokes them, and checks B remains intact. A separate test
holds a fake Groq reply across a real account switch and verifies that B's
chat remains separate and usable after the reply arrives.

### F03 — Overlapping saves lose flush bookkeeping

Source: `web/src/useSync.js`, `scheduleFlush`.

The first transaction's `finally` unconditionally set `timeoutRef.current` to
null. If a second edit had installed a new debounce timer in the meantime, the
first completion removed the reference to that timer. `flushNow()` then did
nothing for the new edit. Its ordinary delayed timer could still fire, so this
alone does not prove permanent loss unless the page exits before it fires.

The browser reproduction delays resolution of the first *real* transaction,
makes a second edit, releases the first promise, and calls `flushNow`. Before
the fix the server retained the first edit at that point. After the fix it
starts the second transaction immediately and the server holds the new edit.
The test instruments transaction-promise timing, not the merge result.

Fix: each completion clears only its own timer and only for the same account.

### F04 — Personal keys leak across sign-out

Sources: `web/src/App.jsx`, `web/src/utils/aiCall.js`.

Personal keys use browser-wide `loci_<provider>_key` names. Normal sign-out
removed the plan cache but retained these keys. The failing browser assertion
observed the synthetic personal Groq key after signing out through Settings.

Fix: remove personal provider keys on explicit sign-out and observed account
transitions, including cross-tab auth changes. Preserve harmless device
preferences. `aiKeyStorage.test.js` covers all supported key names, unrelated
storage, and unavailable storage. The browser reproduction now passes.

This concerns optional personal keys; shared relay secrets remain on the Worker.

### F05 — Shared free allowances are not enforced per person

Sources: `ai-proxy/src/index.js`, `handle`;
`web/src/utils/aiUsageLimits.js`, `checkAndRecordAIUsage`.

The original relay reproduction generated a synthetic signing key, supplied
a fake Google key response and a fake Workers AI binding, then sent 121 direct
requests with one valid test token. Before the fix all 121 reached the fake binding. No live
provider is called. This exceeds both advertised browser counters (40/hour,
120/day), because the original relay never checked them.

Impact: a user can exhaust shared free allowances. No billing claim is made
under the owner's confirmed no-card setup. Browser refreshes, multiple devices,
and scripts are not a reliable accounting boundary. The original relay accepted valid
Google sign-ins for the Firebase project without an invitation list in this handler. Whether another admission control exists in deployed Firebase
configuration was not verified.

Proposed fix (#631/#632): require a verified email on a private alpha allowlist,
then atomically reserve tokens across all seven provider routes in one
SQLite-backed Durable Object. Defaults: 60,000 per person and 200,000 shared per
UTC day, resetting at 00:00 UTC. Successful calls settle to actual usage; missing
usage retains the estimate, failures refund, duplicate settlement is idempotent,
and an unavailable ledger refuses new shared calls. Personal provider keys stay
usable. The app distinguishes personal exhaustion, shared exhaustion and outage,
and stops trying other shared providers for that request.

A UID-only budget was separately reproduced as bypassable by changing the
Firebase UID while keeping the same verified email. The fix meters against a
project-scoped verified-email hash. The ledger never stores raw emails, prompts
or replies; it prunes accounting metadata older than seven days.

The 78 Worker unit tests use actual SQLite and fake signed tokens/providers.
Cloudflare's local workerd runtime also passed concurrent-reservation,
exact-once settlement and shared-pool checks. The audit regression now sends
121 direct requests against a synthetic 100-token budget and verifies only five
20-token responses reach the fake provider. Model/URL/output-cap guards still
hold. No live AI allowance was consumed.

Limits: estimates are not exact tokenization. An in-flight reply can take a
counter above its cap, and a crashed/stopped request can retain a reservation
until UTC reset. A provider's free call/rate limits may run out first. The
allowlist limits admission; it does not stop all request flooding. Real
Cloudflare migration, account plan and live provider usage formats need staging.

### F06 — Clock skew can silently discard an acknowledged edit

Source: `web/src/utils/normalizePayload.js`, `mergeTasksForWrite`.

Reproduction: two signed-in emulator clients share a task. Advance B's clock
five minutes using Playwright, save an edit from B, then save a later edit from
A's correct clock. A's save promise resolves, but the committed task still has
B's earlier text. The larger client-supplied `lastUpdated` wins.

This is distinct from ordinary simultaneous-edit conflict resolution: even a
later edit made after receiving the remote version is discarded. It can affect
users with an incorrectly set clock. No unrelated-task loss was demonstrated
by this case.

Proposed fix (#630): persist each task's last observed server version in the
existing merge baseline. Compare task content against that version, ignoring
clock-only changes. A genuine edit to the observed version wins and advances
its task clock beyond the known version; an unchanged cached row stays the
server's. Reapply edits made during the save even when the commit advanced its
clock. Transaction retries and server echoes remain idempotent.

Five new unit assertions failed before the fix; all six new unit tests pass.
Two signed-in Chromium clients now retain the later edit with a five-minute
clock difference, with and without reloading the cache. Unchanged cached rows
cannot defeat the tested remote edit/delete. Genuinely concurrent same-task
edits and legacy caches without task baselines retain the existing timestamp
conflict rule. Older running clients should be refreshed before wider testing.

### F07 — Spreadsheet formula injection in CSV

Source: `web/src/utils/exportTasks.js`, `escapeCsvCell`.

The downloaded CSV contained a raw `=1+1` task title as a cell. CSV quoting
does not prevent spreadsheet formula interpretation. This is an export risk,
not a demonstrated script-execution or account-access bug in Loci itself.

Fix: prefix formula-like string cells with an apostrophe, including whitespace
before `=`, `+`, `-`, or `@`. Preserve numeric values and ordinary CSV quoting.
The regression captures the actual Blob produced by the export and checks
these cases. Excel/Sheets were not run, so their UI/import behavior remains
a manual check. The JSON backup format is unchanged.

## Checks that held

- Other-account nested reads and mixed-owner atomic PATCH requests were refused;
  the rejected mixed batch did not partially modify the caller's own data.
- Unrelated settings edits survived an offline client's reconnect.
- A stale, unedited task copy did not undo a normal remote deletion.
- An offline queued edit could not restore an account after its deletion marker
  was committed; stale-token writes were refused by the rules.
- A saved Coach action for a deleted task did not act on a different task with
  the same title. The UI marked the proposal as gone.
- Unsent Coach drafts were cleared across account switches.
- Coach Markdown did not execute HTML/script links or request a tracking image.
- Two real browser tabs could not both acquire the focus-session Web Lock.
- Loci-day sequences stayed consecutive across tested DST dates in Amsterdam,
  New York, and Kolkata; 00:30 stayed in the previous Loci day for a 02:00 end.
- 100 deterministic merge cases retained unrelated local/server work and reached
  a stable state after the server echo. These are 100 timestamp variations of
  one scenario, not 100 distinct workflows or exhaustive fuzzing.
- A direct relay caller could not select a paid OpenRouter model, inject an
  upstream URL, or exceed the server's 4,000 output-token cap.
- The existing connector tests passed for owner-only identity/scope checks,
  redirect restrictions, excluded fields, and read-only requests. Real Google
  OAuth and the deployed service-account permissions were not exercised.

## Verification record

| Check | Result |
| --- | --- |
| Web unit tests after the fixes | 2,788 passed / 118 files |
| AI relay unit tests including server budget | 78 passed / 4 files |
| MCP existing unit tests | 117 passed / 8 files |
| Existing Auth/RTDB REST emulator suite | 5 passed |
| Retention/purge unit checks | 4 passed |
| Added browser review suite | 17 passed; all assert intended protections |
| Added relay audit checks | 2 passed: server-budget enforcement and request restrictions |
| Added bundled logic checks | 2 passed: DST and merge scenarios |
| Web lint | 0 errors; 8 pre-existing warnings |
| Production web build | Passed; existing large-bundle warning |

The original F05/F06 evidence tests have been converted into assertions of the
corrected guarantees. Passing now means their regression assertions held.

CI correction: the first Alpha account safety runs on #627–#630 failed during
`npm ci`, before tests started, because the new workflow omitted the
`--legacy-peer-deps` flag used by the existing E2E/deploy jobs for Loci's
Capacitor dependency combination. The corrected install command passes locally;
the workflow fix is pushed through all four branches. New CI results still need
to complete. The separate reported E2E job was still running when inspected;
no E2E assertion failure was available at that point. Local results do not
substitute for green GitHub checks.

The separate existing `security-rules.emulator.test.js` suite did not reach its
nine assertions: its `beforeEach` calls to `testEnv.clearDatabase()` timed out
locally. This is an unresolved test-harness/environment limitation, not evidence
that nine product protections failed. Its normal CI run still needs checking.
The REST suite and new signed-in browser tests used the running local emulators
successfully. No transport-policy workaround or production test was attempted.

## Re-running the review

Use Node 22+, Java 21, installed project dependencies, and a Playwright browser.
Start the Vite server on **5173** (the Vite default is different).

From the repository root, start only local services:

```bash
npm exec --yes --package=firebase-tools@15.22.1 -- firebase emulators:start --project demo-loci-review --only auth,database
```

In another terminal, from `web/`:

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Then from `web/`:

```bash
npm exec -- playwright test --config alpha-review/playwright.config.js --reporter=list
node_modules/.bin/esbuild alpha-review/logic.test.mjs --bundle --platform=node --format=esm --outfile=/tmp/loci-review-logic.test.mjs
node --test /tmp/loci-review-logic.test.mjs
```

Set `LOCI_REVIEW_CHROMIUM=/usr/bin/chromium` when using this workspace's system
Chromium. Otherwise the installed Playwright browser is used. The review config
is separate from ordinary E2E discovery and does not alter the production app's
Firebase configuration. The hook HTML is not an entry point of the Vite build.

From the repository root:

```bash
GCLOUD_PROJECT=demo-loci-review FIREBASE_DATABASE_NAMESPACE=demo-loci-review-default-rtdb node web/tests/firebase-rules-user-isolation.test.mjs
node --test ai-proxy/alpha-review/relay.test.mjs
node --test scripts/purge-deleted-accounts.test.mjs
```

## Proposed changes and remaining release gates

See [ALPHA_RELEASE_CHECKLIST.md](ALPHA_RELEASE_CHECKLIST.md) for exact review
order and staging setup. PRs are drafts; no merge or production deployment has
been performed. Main automatically deploys Firebase Hosting/rules, so merging
is a production action.

- Independent PR #625 protects CSV exports. Independent #631 adds app quota
  feedback; #632 adds the server budget. Deploy the app feedback before the
  Worker budget. The Worker requires a private AI_ALLOWED_EMAILS secret.
- The account-safety stack is #627 → #628 → #629 → #630 → #626. Each PR contains
  one focused fix. Retarget a dependent PR to main after its base lands.
- Review #627–#630 and #632 carefully; Codex and a user-invoked loopcheck are
  recommended before merge. No Codex review or subagent was triggered.
- PR #624 independently changes brain-dump merge/overlay code; preserve both
  sets of semantics and rerun the relevant tests when integrating it. PR #622
  supplies real Google-emulator UI tests; this review's fixture uses emulator
  password sign-in and does not replace that coverage.
- Stage real OAuth, deployed rules, relay configuration, read-only connector
  IAM, restore into a new UID, and scheduled purge execution. Source and mocked
  tests cannot prove deployed settings. Check offline sign-out on a real phone,
  the connection-error sign-out route, iPhone Safari/PWA and Android.

No staging project or usable Firebase/Cloudflare deployment credentials were
available. The current web Firebase configuration is fixed to production in
`web/src/firebase.js`; a preview URL alone is not staging. Staging configuration
support and separate resources are required before a real staging deployment.
The full existing E2E suite was left to CI. No live AI allowances or production
data were used. This review does not establish that the entire app is free of
vulnerabilities or ready to release without the remaining gates.
