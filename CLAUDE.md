
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

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. PR Loophole Check ("loopcheck")

When the user types `loopcheck` (optionally with a PR number, e.g. "loopcheck PR 280"), run a single independent bug hunt on that PR before merge:

1. If no PR number is given, use the most recently pushed/open PR in this repo.
2. Fetch that PR's full diff (GitHub MCP tools, e.g. `pull_request_read` with `get_diff`).
3. Spawn exactly **one** `general-purpose` Agent call. Hand it the diff verbatim plus enough surrounding context to understand scope (file paths, what the PR claims to do). Ask it to independently hunt for P0/P1/P2 bugs/loopholes/future risks — fresh eyes, no memory of how or why the code was written — and report back ranked findings with file/line, concrete failure scenario, and severity, plus an overall merge verdict.
4. For each finding: fix it now if it's small and you're confident, otherwise surface it to the user and ask before changing anything.

This is intentionally **one agent spawn only** — not the heavier multi-agent `code-review` skill — to keep cost low for routine per-PR use on a metered plan. Recommended cadence: once per PR, right before merge.
