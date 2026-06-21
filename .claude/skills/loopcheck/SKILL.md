---
name: loopcheck
description: Run a single, cost-efficient independent bug hunt on a pull request before merging — looks for P0/P1/P2 loopholes the PR author may have missed. Use when the user types "loopcheck" or "/loopcheck", optionally with a PR number.
argument-hint: "[pr-number]"
---

# loopcheck

When invoked (e.g. "loopcheck", "/loopcheck 280"):

1. If no PR number is given as an argument, use the most recently pushed/open PR in the current repo.
2. Fetch that PR's full diff (GitHub MCP tools, e.g. `pull_request_read` with `get_diff`, or `gh pr diff` if no MCP server is available).
3. Spawn exactly **one** `general-purpose` Agent call. Hand it the diff verbatim, plus enough surrounding context (file paths, what the PR claims to do) for it to understand scope. Ask it to independently hunt for P0/P1/P2-severity bugs, loopholes, or future risks — fresh eyes, no memory of how or why the code was written — and report back ranked findings (file/line, concrete failure scenario, severity) plus an overall merge verdict.
4. For each finding: fix it now if it's small and you're confident in the fix; otherwise surface it to the user and ask before changing anything.

This is intentionally **one agent spawn only** — not a multi-agent deep-audit fan-out — to keep cost low for routine per-PR use on a metered plan. Recommended cadence: once per PR, right before merge.
