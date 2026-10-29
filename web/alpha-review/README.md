# Alpha account-safety regressions

These focused Chromium checks use synthetic accounts on local Auth/RTDB
emulators for `demo-loci-review`. The fixture replaces Firebase initialization
before app code runs and blocks external requests. No production credentials or
provider calls are needed. CI runs this suite on each relevant PR, including
stacked branches, along with lint and unit tests.

From the repository root, with Java 21 and web dependencies installed:

```sh
npx --yes --package=firebase-tools@15.22.1 firebase emulators:exec --project demo-loci-review --only auth,database "cd web && npx playwright test --config alpha-review/playwright.config.js"
```

Use `LOCI_REVIEW_CHROMIUM=/path/to/chromium` for an existing Chromium binary.
The suite starts Vite on port 5173 or reuses an existing server on that port.
Tests may instrument promise timing or expose the real hook to create precise
unsaved states; production source and merge results are not replaced.

The complete review adds Coach/account/content/time invariants to the focused
save regressions: 17 Chromium checks, plus two bundled Node logic checks.
The separate relay replay at `ai-proxy/alpha-review/relay.test.mjs` requires the
server-budget implementation in PR 632; its core accounting coverage runs in
that PR's Worker unit suite. Run that replay manually after integrating 632.
See `docs/ALPHA_SECURITY_REVIEW.md` for original reproductions and limits.
