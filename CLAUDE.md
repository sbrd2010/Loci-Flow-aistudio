
# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

Before writing new code, check whether the codebase, the platform or an installed dependency already does it. New logic with branches (dates, horizons, sync/merge, parsing, AI fallback) ships with at least one small unit test; UI/CSS-only changes don't need one. End each change summary with what you did not verify. For bugs and red CI, use the `debug` skill.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. PR Loophole Check ("loopcheck")

When the user types `loopcheck` (optionally with a PR number, e.g. "loopcheck PR 280"), run a single independent bug hunt on that PR while it is still a draft (before it's marked ready):

1. If no PR number is given, use the most recently pushed/open PR in this repo.
2. Fetch that PR's full diff (GitHub MCP tools, e.g. `pull_request_read` with `get_diff`).
3. Spawn exactly **one** `general-purpose` Agent call. Hand it the diff verbatim plus enough surrounding context to understand scope (file paths, what the PR claims to do). Ask it to independently hunt for P0/P1/P2 bugs/loopholes/future risks — fresh eyes, no memory of how or why the code was written — and report back ranked findings with file/line, concrete failure scenario, and severity, plus an overall merge verdict.
4. For each finding: fix it now if it's small and you're confident, otherwise surface it to the user and ask before changing anything.

This is intentionally **one agent spawn only** — not the heavier multi-agent `code-review` skill — to keep cost low for routine per-PR use on a metered plan. Recommended cadence: once per PR, in draft, before the owner marks it ready.

## 6. Codex review rounds — ask from round 2

Codex (`chatgpt-codex-connector[bot]`) re-reviews every push, so fixing its findings can loop indefinitely and burn a limited budget.
- Round 1 of Codex review on a PR: fix and reply as usual.
- Round 2 and later: do NOT fix, reply to, or push for any Codex finding (P1 included) until Rohan explicitly approves. Instead, list the findings and, for each one, say:
  - whether it is necessary to fix (a real bug, data loss or a broken core flow) or can be accepted as is, and why;
  - whether it can be grouped with other round-2+ findings into one follow-up PR, rather than fixed on this PR.
- Count rounds per PR by Codex review submissions (each "Codex Review" on a new commit is one round).
- Never post `@codex review` yourself — not after opening a PR, not after a push. The owner triggers Codex by hand. When a PR goes up, say in one line how big it is and whether a review is worth it:
  - **Small** (copy, CSS, a one-function fix, tests only): no Codex needed.
  - **Medium** (one feature or flow, a few files): Codex recommended.
  - **Large / risky** (sync, data model, many files, anything that could lose data): Codex recommended, plus a `loopcheck`, both while the PR is a draft.

## 7. Budget: the owner is on a Claude Pro plan

This repo is past 500 PRs and building it uses most of the plan's message quota. Work so each message and token counts, without lowering the bar on correctness.

**Tests.** GitHub CI runs lint, unit tests and the full Playwright e2e suite (about 18 minutes) when the owner marks a PR **ready for review**, on every push after that, and on every merge to main. That is the full check — don't duplicate it.
- **Robot-minute budget:** the repo is private on GitHub Free (2,000 Actions minutes and 500 MB storage a month), and the owner won't pay for more; going public is the fallback. So CI skips e2e on **draft** pushes, a newer push cancels a PR's running e2e, changes that only touch Markdown, docs, other workflows, `ai-proxy/` or `mcp/` skip e2e, and the Android build runs only on demand (Actions → Android Build → Run workflow). Don't add CI jobs that run on every push without asking.
- So while a PR is a **draft**, the checks are yours: before pushing, run `npm run lint` and `npx vitest run` (in `web/`), plus the e2e specs that cover what you changed (and any you edited). The `loopcheck` and Codex reviews also happen in draft (the owner triggers Codex). The owner marks the PR ready once they're clean, and that runs the full e2e.
- Don't run the full e2e suite locally. Run single e2e specs only when needed: the ones covering your change in draft, to see a UI change actually work, or to reproduce a CI failure before fixing it (read the failing test's name and error in the CI log first, then run just that spec).
- When a change breaks an existing e2e expectation on purpose, update that test in the same push.
- After pushing, don't poll CI. Wait for the PR's events; fix any CI failure on a PR you opened without being asked.

**Reviews.** Codex rounds as in section 6 (never trigger Codex yourself). `loopcheck` (section 5) when the owner asks, or recommend it for large/risky PRs before merge. Don't spawn other subagents unless the owner asks.

**Messages.** Keep replies short: what changed, what was verified, what the owner must decide. Don't narrate routine events (bot summaries, your own replies echoed back). Prefer grep and reading the needed lines over reading whole large files. Take screenshots only to check a visual change.

**Continuity across chats.** Parked or follow-up work lives in GitHub issues (e.g. #505 breaks and mini window, #511 finishing `redesign-75`), not in chat. When asked "what's pending", read the open issues first.

**Personal data.** Never put the owner's real data (task titles, names, companies, goals) in commits, PRs, issues, test fixtures or screenshots that get committed. Use made-up titles. Delete any copy of real data once the work that needed it is done.

## 8. AI Provider Rate Limits (for live Coach verification)

When live-verifying Coach changes against the real API (not mocked `fetch`), the configured keys are low-tier/free and rate-limit fast under rapid successive test calls:

| Provider | Model | RPM | RPD | TPM | TPD/TPH |
|---|---|---|---|---|---|
| Groq | `openai/gpt-oss-120b` | 30 | 1,000 | 8,000 | 200,000 TPD |
| Cerebras | `gpt-oss-120b` | 5 | — | 30,000 | 1M TPH / 1M TPD |

Cerebras's 5 RPM is the binding constraint — `callAI`'s auto-fallback chain tries Cerebras on every Groq failure too, so a burst of retries exhausts both quickly. When live-testing:
- Space out real API calls (roughly 15-20s apart minimum) rather than firing several in quick succession.
- Prefer one live call per scenario over loops of many small calls.
- A `429`/`403` from the provider during testing is very likely this rate limit, not a real bug — wait it out (the error's `retryAfterMs` tells you how long) rather than treating it as a regression.

## 9. Known bug hotspots — check before pushing

From the repo's history (Aug–Oct 2026): about a third of Coach/AI commits were fixes, and half of all Codex-driven fixes landed there. Day-boundary and sync bugs kept reaching users. If a change touches one of these areas, check the listed cases yourself before pushing, and add a unit test for any that applies:
- **Coach / AI (`web/src/utils/aiCall.js`, Coach prompts):** every provider in the chain, not just the first; a 429 or a cooldown vs a request that is too large; Z.ai's small size limit; Stop/abort mid-reply; history trimming. Any new free-text path to an AI provider must run the crisis check (`crisisSafety.js`).
- **Day boundaries:** a Loci day can end after midnight. Use the existing helpers (`getLociDayStr`, `lociDaysBack`, `lociDayEndsAt` in `focusWindows.js`); don't do new date maths. Check 00:30 inside a late window, a DST change, and "today" vs "this week" vs "last week".
- **Saved state and sync:** a page refresh mid-action, offline then reconnect, and two devices editing the same thing. Never let an older save overwrite a newer one (`resendPolicy.js`).
- **UI/CSS-only changes** rarely needed fixes. A quick check on a phone-width and a desktop screenshot is enough.

## 10. Dual review (Claude Code × ChatGPT) for large/risky changes — before any code

Use it for **large/risky** work only (§6: sync, saved state, data model, anything that could lose data), never for small PRs. It runs **before the solution is written**. Trialled on #643 → PR #644: it caught two design flaws before code, and the spike and `loopcheck` caught three more bugs before merge.

1. **Issue first.** The GitHub issue is the shared space. Claude investigates and posts an assessment:
   - root cause and proposed design;
   - alternatives considered;
   - test plan;
   - risks.

   Claims are labelled FACT — CODE / INFERENCE / OPINION / CANNOT VERIFY. No code yet.
2. **ChatGPT reviews on the issue.** The owner prompts it, and it posts there itself. Claude answers point by point with evidence (code lines, tests), agreeing or pushing back. **Max 3 rounds.** Don't change the design just because both AIs agree; change it when the evidence says so.
3. **Spike when the design hinges on how a library or Firebase behaves.** With the owner's OK, run a small test-only experiment (emulator, two clients, real rules), post the results, and stop.
4. **Final comment:** "DUAL REVIEW — FINAL RECOMMENDATION", with:
   - the agreed cause;
   - the approach;
   - the rejected alternatives;
   - the files involved;
   - the tests;
   - the risks;
   - Claude's recommendation;
   - ChatGPT's position;
   - and, last, "Awaiting owner approval".
5. **Code only after the owner approves**, in one focused draft PR:
   - permanent tests for the agreed scenarios;
   - a `loopcheck` and Codex while it is a draft;
   - ChatGPT may review the PR once more.
   - The PR states what was not verified, and the owner's manual device check comes after merge.

Boundaries:
- No user data, tokens or secrets on GitHub.
- No production change during the discussion.
- No scope growth or new infrastructure without the owner's approval.
- Stop at the round limit and hand the decision to the owner.
