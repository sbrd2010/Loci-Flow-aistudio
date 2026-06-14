# Loci — Project Handover

_Written 2026-06-13. Reflects `main` as of PR #236 (merged)._

## 1. What Loci Is

Loci is a personal productivity web app for managing your day: task lists organized
by horizon (Today / This Week / etc.), deep Focus sessions with ambient sound,
and a visual Day Map for scheduling tasks across the week. It's built with React 18 +
Vite, syncs via Firebase Realtime Database, and has a "Try Demo" mode that works
fully offline (no Firebase config needed). There's also a dormant Kotlin/Compose
Android client under `app/` (not actively developed — recent work is all in `web/`).

A central feature is the **AI Coach** (`web/src/components/CoachTab.jsx`) — a chat
interface backed by Groq/Gemini (`web/src/utils/aiCall.js`) that is given a rich,
structured snapshot of the user's current state ("Eyes") and, as of today, can act
on the user's task list when explicitly asked ("Hands").

## 2. Recent Development (high-level)

Besides the AI Coach work (below), recent merged PRs cover:

- **Sync/data integrity**: tombstone-safe merges, malformed-task repair before
  writes, config merge-by-`lastUpdated` safety, a "drop-guard" that blocks
  suspicious full-payload writes that would silently delete tasks (#209-214, #220, #222).
- **Morning Ritual / Daily Anchors**: popup flow, decoupling from Focus Windows,
  refreshed quotes + on/off toggle (#216, #221, #234).
- **Weekly Progress Mirror** (#217) and flexible daily Focus Windows (#215).
- **Focus Sounds**: ambient player library, shuffled variations, CDN-hosted
  variations with CSP fixes and local-track fallback, binaural redesign, honest
  category naming (#227, #228, #230-233, #237, #238).

## 3. AI Coach — Architecture

Three layers, all unit-tested:

- **`web/src/utils/lociAIContext.js`** (309 lines) — pure functions that each build
  one slice of context for the system prompt (return `""` if nothing to report, so
  the prompt stays lean). This is the "Eyes" — see Phase 2a-2c below for what's covered.
- **`web/src/utils/coachCheckin.js`** + **`dailyCoachCheckins.js`** — the
  `[[CHECKIN_IN:N]]` tag protocol: the coach can schedule a one-shot follow-up
  ("check on me in 10 minutes"), which resumes the chat and fires a notification.
- **`web/src/utils/coachActions.js`** (256 lines) — the "Hands": the
  `[[SET_NOW_FOCUS:...]]` / `[[COMPLETE_TASK:...]]` / `[[ADD_TASK:...]]` /
  `[[PARK_TASK:...]]` / `[[START_FOCUS:...]]` tag family. See Phase 2d below.
- **`web/src/components/CoachTab.jsx`** — orchestrates all of the above: builds the
  system prompt from `lociAIContext.js`, calls `callAI`, parses check-in + action
  tags out of the reply, applies actions via `applyCoachActions`, writes results
  back via `saveSubPath`/`saveSubPaths`, and narrates outcomes to the user.

`buildLociCoreInstruction()` in `lociAIContext.js` assembles the system prompt and
documents the tag protocol for the model (which tags exist, that they're
"explicit-request-only", etc.).

## 4. AI Coach — Development History

### Phase 2a (PR #225) — Live Focus Session + Key Deadline
- `buildLociFocusSessionContext` — coach knows if/when a focus session is running
  and on which task ("12 minutes into a focus session on 'Optimize resume', 13 min left").
- `buildLociDeadlineContext` — Key Deadline surfaced unconditionally (label, date,
  days-left, today's-move status, miss-streak), not just on Reflection day.

### Phase 2b (PR #226) — Day Map, Brain Dump, velocity
- `buildLociDayMapContext` — today's planned route with the Now Focus task marked.
- `buildLociBrainDumpContext` — count of unprocessed Brain Dump items.
- `buildLociVelocityContext` — recent completion velocity from `contributions`,
  for calibrating encouragement vs. gentle-restart framing.

### Phase 2c (PR #229) — subtasks, reminders, Low Energy Mode, recently-parked
- `buildLociNowFocusContext` — surfaces subtasks of the Now Focus task so the coach
  can point at the first micro-step rather than the whole task.
- `buildLociRemindersContext` — reminders due today.
- `buildLociLowEnergyContext` — one-line flag that should shift the coach's tone.
- `buildLociRecentlyParkedContext` — tasks parked in the last 24h, so the coach
  doesn't re-surface guilt about things already consciously set aside.

This completed **Tier 1 ("Eyes")** from the original roadmap — all additive prompt
context, no new write paths.

### Phase 2d / "Hands" (PR #236, merged 2026-06-13)

Originally scoped across roadmap items 2d/2e/2f (SET_NOW_FOCUS + COMPLETE_TASK,
then ADD_TASK + PARK_TASK, then START_FOCUS), this shipped as **one PR covering all
five action tags** — a clean replacement for the earlier #235 (closed, squashed
into #236):

| Tag | Effect | Mirrors |
|---|---|---|
| `[[SET_NOW_FOCUS:<title>]]` | Pins a task as Now Focus, unpinning any other | star-toggle button |
| `[[COMPLETE_TASK:<title>]]` | Marks complete, +100 XP, +1 contribution | checkbox |
| `[[ADD_TASK:<title>]]` | Creates a Today task (P3, 25min, "Do first tiny step") | + Add Task dialog |
| `[[PARK_TASK:<title>]]` | Sets `isParked: true`, unpins if it was Now Focus | Bad Day Reset per-task patch |
| `[[START_FOCUS:<title>]]` | Pins as Now Focus + extends/starts the focus timer | Now Focus + Start Focus |

**Gating (`matchesUserIntent` in `coachActions.js`)** — every tag is checked against
the user's own last message before it's allowed to mutate anything, hardened over
8 rounds of Codex review:
- Per-action-type intent regexes (`INTENT_PATTERNS`) — e.g. COMPLETE_TASK requires
  "done/finished/complete/wrapped up/knocked out" language.
- `NON_SPECIFIC_COMPLETION_RE` rejects generic "done for today" / "what have I done"
  phrasing that doesn't name a task.
- **Title corroboration** (`titleMentionedInMessage` / `TITLE_CHECK_TYPES`) — all
  5 tag types require a significant word (≥3 chars) from the tag's title to appear
  in the user's message, so the AI can't act on a task it merely hallucinated.
- **Negation handling** (`NEGATION_RE` + clause-based lookback) — "Don't mark X
  complete" is rejected; `matchesUserIntent` now scans *every* regex match in the
  message (not just the first) so a later, unnegated clause can still pass even if
  an earlier clause was negated (e.g. "I'm not done with X, but I finished Y").
- **Evening Guard** — ADD_TASK is blocked at/after 8pm when the guard window is active.
- **Narration integrity** (`CoachTab.jsx`) — if any action fails to apply, the
  model's free-text narration is replaced with deterministic per-action-type
  summaries (so the chat never claims a failed action succeeded).
- **Sync integrity** (`useSync.js`) — `saveSubPath`/`saveSubPaths` now set
  `syncWarning("write-failed")` on exhausted retries (previously only console-logged),
  matching `savePayload`'s existing behavior.

All 590 unit tests pass; CI (`e2e`, `rules`) green.

**Known residual gap → tracked as [issue #239](https://github.com/sbrd2010/Loci-Flow-aistudio/issues/239)**:
title corroboration is per-tag, in isolation — if two active tasks share a
significant word (e.g. "Write report" / "Write email"), the gate can pass for the
wrong one. Proposed fix is a *comparative* check (does the resolved task score at
least as well as every other active task against the message?) rather than stemming.
Filed as a backlog item, not blocking.

## 5. Phase 3 — Remaining AI Coach Work

This is **Tier 3** from the original roadmap — explicitly deferred, each item needs
its own design/scoping pass before implementation:

### 5.1 AI-voiced daily nudges
`web/src/utils/coachSignals.js` already exists and computes `buildExecutionCoachSignal`
— a deterministic mirror/nudge/anchor signal (e.g. deadline miss-streak detection via
`getDeadlineMissStreak`). **It is currently unused outside its own test file** —
not wired into any UI. Phase 3 options:
- Surface it as-is (fixed template strings) somewhere in the UI, or
- Route the computed signal through `callAI` (`web/src/utils/aiCall.js`) for
  personalized wording — higher caution since it changes a path that currently has
  no AI dependency and is fully deterministic/offline-safe.

### 5.2 Recurring check-ins
`coachCheckin.js`'s `[[CHECKIN_IN:N]]` is one-shot by design (`buildCoachCheckin`
returns a single `fireAt` timestamp, no recheck/reschedule). "Check on me every hour
until 5" needs a new data shape (e.g. `coachCheckin.recurring`) plus reschedule logic
each time a check-in fires.

### 5.3 Cross-session "coach memory"
No `config.coachMemory` field exists yet. Idea: a small free-text field the AI
maintains about the user's patterns ("tends to avoid admin tasks in the afternoon").
Needs design for: size-capping, what the AI is allowed/expected to write, and how/when
it's updated (likely another tag in the `coachActions.js` family, or its own protocol).

### 5.4 Notification → Coach tab deep link
`web/public/sw.js`'s `notificationclick` handler currently just focuses/opens `/` —
it doesn't route to the Coach tab specifically. Tapping a "🤖 Coach check-in"
notification should land the user directly in the Coach conversation. Small change,
but touches the service worker — separate PR, needs care around `clients.matchAll`
+ postMessage to tell the already-open app to switch tabs.

### 5.5 (Carried over from Phase 2d) Title-disambiguation
See [issue #239](https://github.com/sbrd2010/Loci-Flow-aistudio/issues/239) above —
not originally a Tier 3 item, but a known gap in the Phase 2d "Hands" gating logic
that's reasonable to fold into the next coach-focused effort. Estimated ~1-2hr,
requires threading the active task list into the gating decision (currently
`matchesUserIntent` only sees `lastUserMessage` + a single tag `title`).

## 6. Useful Entry Points

- `web/src/components/CoachTab.jsx` — Coach UI + orchestration
- `web/src/utils/lociAIContext.js` — all "Eyes" context builders + system prompt assembly
- `web/src/utils/coachActions.js` — "Hands" tag parsing, gating, and application
- `web/src/utils/coachCheckin.js`, `dailyCoachCheckins.js` — check-in scheduling
- `web/src/utils/coachSignals.js` — unused-but-ready execution signal (5.1)
- `web/src/useSync.js` — Firebase RTDB sync (`savePayload`/`saveSubPath`/`saveSubPaths`)
- `web/public/sw.js` — service worker (push notifications, click handling)
