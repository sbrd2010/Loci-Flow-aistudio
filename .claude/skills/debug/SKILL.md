---
name: debug
description: Root-cause a bug or a red CI check before changing code, and prove the fix. Use when fixing a reported bug, a failing unit/e2e test, a CI failure, or a review finding that claims a defect.
---

# debug

Adapted from obra/superpowers (`systematic-debugging`, `verification-before-completion`, MIT), trimmed for this repo. No subagents.

1. **Read the evidence first.** The exact error, failing test name, and assertion line. For CI, read the job log (`get_job_logs`) before touching code. Don't guess from the check name.
2. **Reproduce it, smallest way first.** A vitest case in `web/` (`npx vitest run <file>`) beats a single e2e spec (`npx playwright test <spec>`), which beats the full suite (never run locally). If you can't reproduce, say so. Don't patch blind.
3. **State one hypothesis** in a sentence: "X fails because Y, at file:line." Find where the bad value comes from, not just where it crashes. Check `git log -p` on that code: a recent change often is the cause.
4. **Write the failing test first** when the bug is in logic (dates, horizons, sync/merge, `aiCall.js` fallback, parsing, anything with branches). For pure visual/CSS bugs, a test is optional; a screenshot or e2e check is the proof.
5. **Fix the root cause, minimally.** No catch-all `try/catch`, no `?.` added just to silence a crash, no loosened assertion, no skipped test. If the root cause is outside this PR's scope, stop and tell the owner.
6. **Three failed fix attempts = stop.** Your model of the bug is wrong. Re-read the evidence, or ask the owner, instead of trying a fourth variation.
7. **Prove it before saying "fixed".** Show the reproduction now passing, then `npm run lint` and `npx vitest run` in `web/`. Report what you ran and its result. Never claim a fix you didn't run.
8. **Say what's unchecked.** End with one line on what you did not verify (e.g. "Android not tested", "only Chromium e2e run").
