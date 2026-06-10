# Handoff — Loci-Flow-aistudio (Focus Timer work, PR #204 & #205)

`main` is currently at `aa8a32f` (PR #205 `0c59627` merged on top of `587285a` PR #204, and PR #206 `aa8a32f` merged on top of that — see note below).

> **Note — concurrent session activity:** while this handoff was being written, a *separate* Claude Code session merged **PR #206** ("fix: refresh todayStr on midnight rollover for long-lived tabs"). This is the fix for the item the original planning list below calls **"#207 logical-day / midnight `todayStr` staleness"** — it's now **done**. See §5 for details. PR numbering for the remaining items will likely be offset by +1 from what's listed below.

---

## 1. PRs completed in this thread

### PR #204 — *fix(focus): auto-start timer, persist session across tabs, floating timer + Keep Going extension*
- **Status:** Merged (`587285a`).
- **This thread's contribution:** the "account-switch safety" addendum — final commits `063707b`/`f3396df` (PR head). The bulk of PR #204 (auto-start, App-level timer lift, floating timer, Keep Going picker, cross-tab completion) was implemented by Gemini/Antigravity; this thread reviewed it and added the account-switch reset as a fix for a review gap.
- **Key files:** `web/src/hooks/useFocusTimer.js` (new), `web/src/utils/focusSession.js` + `focusSession.test.js` (new, 30 tests), `web/src/components/FloatingFocusTimer.jsx` + `web/src/styles/floatingFocusTimer.css` (new), `web/src/App.jsx`, `web/src/components/TodayTab.jsx`.
- **Behavior changed:** Focus timer state moved from `TodayTab` to an App-level hook (survives tab switches); all 3 "Start Focus" entry points now auto-start the countdown; a floating timer appears on Today/Roadmap/MindBox/Coach/Settings while a session is active; timer reaching 0:00 triggers a global "Session complete" prompt regardless of active tab; "Keep going" reopens a 5–120min picker and restarts the timer on the same task; **on login/logout/account switch, all Focus state (timer, session, completion prompt, PiP) is hard-reset via `buildResetFocusState`** so one user's session can never leak into another's.

### PR #205 — *fix(focus): persist pop-out timer and polish completion clarity*
- **Status:** Merged (`0c59627`), `mergeable_state: clean`, both CI checks (`e2e`, `rules`) green, 273/273 unit tests pass, build clean.
- **This thread's contribution:** full code review (found a stale-closure bug, dead code, duplicated thresholds), then a small final-readiness commit (`0416f39`, eslint-disable comments + blank-line cleanup — later dropped by Gemini's branch rewrite, see §3), then final verification + merge-ready verdict.
- **Key files (9 changed, +309/-125):** `web/src/hooks/useFocusTimer.js`, `web/src/components/FloatingFocusTimer.jsx`, `web/src/utils/focusSession.js` (+test), `web/src/App.jsx`, plus CSS for the floating-timer/timer-state colors.
- **Behavior changed:** the Document PiP pop-out timer is now lifted to the App level (`useFocusTimer`) so it **survives exiting the dark Focus overlay**; fixed a stale-closure bug where the PiP "reset" button always reset to the *original* duration instead of the task's *current* duration (`timerMaxSecondsRef`); added a "Pop out" button (inline SVG, replacing a `⧉` glyph) to the floating timer; floating timer is hidden while the completion modal is open (no stuck `0:00`); timer visual states recolored — normal (>30%, green), near-end (15–30%, amber), almost-done/complete (≤15%, coral/red); removed dead code (`buildPiPContent`, `pipIntervalRef`, `window.__lociTimer`); ConfirmDialog completion message had its `⏱️` emoji removed (cross-platform rendering polish).

---

## 2. Current architecture after the merged PRs

### Sync / data safety (`web/src/useSync.js`, `web/src/utils/normalizePayload.js`)
- localStorage cache (`loci_payload_v1_{uid}`) loads instantly (`isSyncingFromCache=true`); RTDB connection tracked via `.info/connected` with `connPhase` (connecting/connected/offline/error), 10s transport/data timeouts, and a 15s "stale cache" warning (`syncWarning="offline"`, e.g. for Brave Shields).
- One-time legacy email-path → uid-path migration; default seed payload for brand-new users.

### `savePayload`
- Debounced 1500ms write to RTDB, 3x exponential-backoff retry. Runs `prepareBrainDumpForSave` (caps brainDump at 50, manages `brainDumpUpdatedAt`) + `normalizePayload` first.
- **Task-count drop guard** (`isTaskCountDropSuspicious`, threshold=3): blocks any write that would drop active (non-deleted) task count by ≥3 vs. the held payload (skipped if current active count <3). On trigger: logs dropped UUIDs/titles, sets `syncWarning="drop-guard"`, write is dropped entirely.
- Tracks `localWriteBeforeFirstRtdbRef` — if a save fires before the first RTDB response, the resulting "fake-fresh" timestamp is not trusted later (see merge logic below). Refreshes cached ID token for the pagehide keepalive PUT.

### `saveSubPath`
Single-field writes (e.g. `config.visitStreakCount`, deadline rollover) that update only `{path}/{subPath}` + `{path}/timestamp` via multi-path `update()` — avoids clobbering a concurrent full-payload write.

### `mergeRemotePayload` / `mergeRemotePayloadWithMeta`
Per-uuid task merge — newer `lastUpdated` wins (remote wins ties); local-only non-deleted tasks appended; soft-deleted local tasks not resurrected. BrainDump preserved/cleared based on `brainDumpUpdatedAt` metadata. Returns `hasLocalContribution` to trigger write-back for cross-device convergence.

### `onValue` timestamp logic (the sync-rollback fix)
If `data.timestamp < local.timestamp`, the local-newer write-back is now **conditional** — only pushed if no `savePayload` fired during the cache-only window; if one did, RTDB is trusted/merged instead (prevents a premature mount-effect write from overwriting RTDB with stale cache).

### Task-count drop guard
See `savePayload` above — last-resort net against any path silently dropping ≥3 active tasks.

### UID/account-switch payload gating
`gatePayloadToUid(payload, payloadUid, currentUid)` returns `null` unless they match; `payloadUidRef` + `effectivePayload`/`effectiveLoading` ensure App-level effects never see a previous user's data during the uid-change render gap. `clearCache(uid)` runs on logout. `useFocusTimer`'s own `[uid]`-keyed reset is the Focus-side complement.

### Focus timer architecture (post #204/#205)
`web/src/hooks/useFocusTimer.js`, `web/src/utils/focusSession.js`:
- All state (`isTimerRunning`, `timerSecondsLeft/MaxSeconds`, `isFocusMode`, `focusSessionActive`, `sessionCompletePending`, `showExtendPicker`, `pipOpen`) lives at App level.
- Wall-clock-anchored countdown (`deadlineRef`) with visibilitychange catch-up.
- `shouldTriggerSessionComplete` (0:00 while running) → global `ConfirmDialog` ("Done! +120 XP" → `buildFocusCompletionPayload`, reuses `buildToggleCompletedTasks`; or "+50 XP, keep going" → `showExtendPicker` → `extendTimer`/`buildExtendedTimerState`).
- `shouldShowFloatingTimer`: hidden on Day Map, when completion pending, when no active session/task, and on Today while the dark overlay is open.
- `getTimerState(secondsLeft, maxSeconds)`: normal(>30%)/near-end(15–30%)/almost-done(≤15%)/complete(0) → drives `timer-state-*` CSS classes.
- `[uid]`-keyed effect → `buildResetFocusState(config)` zero-resets everything (incl. closing PiP) on login/logout/switch.
- Auto-stop guards if `activeTask` is deleted/completed/removed.

### Pop-out/PiP timer behavior
Document PiP API, feature-detected (`"documentPictureInPicture" in window` — Chromium desktop only). Lifted to App level so it persists across overlay exit. PiP content is **hand-built DOM/CSS** (not React) inside `handleOpenPiP` — separate from `FloatingFocusTimer.jsx` styling, must be kept in sync manually. Reset button uses `timerMaxSecondsRef` (fixes stale-closure bug). Auto-closes when `focusSessionActive` is false or `activeTask` is null. Floating timer shows a "Pop out" SVG button when supported and not already open. **Not covered by e2e tests.**

### Backup/export behavior
`web/src/utils/exportTasks.js`, Settings → "💾 Data Backup":
- JSON: tasks-only (`exportTasksAsJson`) or full-payload (`exportPayloadAsJson`, includes config/contributions/brainDump) — no BOM (parser-safe).
- CSV (`exportTasksAsCsv`): UTF-8 **with BOM** (Excel-safe), CRLF, RFC4180 quoting, fixed column order incl. `isMVD` and all `dayMap*` fields, unknown fields auto-appended.
- Read-only — no import/restore UI exists.

### AI rewrite / AI organize behavior
`web/src/utils/aiCall.js`, `lociAIContext.js`, `aiUsageLimits.js`:
- Provider: Groq `llama-3.3-70b-versatile` primary, Gemini `2.5-flash-lite` fallback; JSON-only system prompt (no "ADHD" terminology).
- Limits: 40/hr, 120/day per user (localStorage-tracked, 50/80/95% warnings).
- **AI Rewrite** (AddTaskDialog "Ask AI", edit mode): only mutates `title`, `concreteStep`, `subSteps`, `lastUpdated` via `applyAiRewriteToTask()` — horizonLevel, priority, category, timeEstimate, uuid/id, dayMap fields, focus/parked/deleted flags, orderIndex are explicitly preserved.
- **AI Organize** (MindBoxTab): converts brain-dump → tasks with horizonLevel ∈ {today, week, month, quarter, halfyear, office}, priority ∈ {P1-P4}; dedup via stable `sourceId` (not title-matching).

---

## 3. Important decisions made

- PR #204's account-switch reset is keyed on `[uid]` *only* — deliberately so same-user navigation/edits never re-trigger it. Assumption: Firebase's `onAuthStateChanged` doesn't flicker `uid` to `null` transiently (true today).
- PR #205's PiP reset-button fix used a ref (`timerMaxSecondsRef`) rather than re-attaching the PiP listener on every duration change — avoids tearing down/flickering the PiP DOM.
- `⧉` glyph → inline SVG, and `⏱️` emoji removed from the completion dialog: both pure cross-platform font-rendering polish, not functional changes.
- This thread stayed strictly in scope: no AI, MindBox ritual, Firebase rules, backup/export, task schema, or dark-Focus-page redesign work — per PR #204's explicit "out of scope" list.
- The two cosmetic `eslint-disable-line`/blank-line edits (`0416f39`) pushed directly to PR #205's branch were dropped by Gemini's subsequent "reapply clean changes on top of main" rewrite. **Deliberately not re-fought** — there's no ESLint config/script in this repo, so it's a pure no-op with zero CI/build/test impact.

### Assumptions for the next thread
- **Gemini/Antigravity branch-rewrite behavior**: it tends to force-push/rewrite its PR branches wholesale rather than adding incremental commits. A commit pushed directly to one of its active branches by anyone else risks being silently dropped on its next push. Either coordinate timing or wait for merge before adding small fixes.
- `window.documentPictureInPicture` is Chromium-desktop-only by design — invisible on Firefox/Safari/mobile, not a bug.
- Repo root has stale `.claude/worktrees/agent-*/` directories (with duplicate `web/e2e/*.spec.js` copies) left over from prior agent runs — not part of the real `web/` tree, flagged but not cleaned up (out of scope).
- **Multiple Claude Code sessions are working this repo concurrently.** PR #206 (the `todayStr` fix below) was authored and merged by a different session while this handoff doc was being written. Expect PR numbers to drift from the plan in §5 — check actual GitHub PR numbers/state before assuming an item is still pending.

---

## 4. Known risks / watch-outs

- **Floating timer, PiP pop-out, cross-tab completion, and Keep Going are not covered by e2e tests.** `web/e2e/deep-focus.spec.js` only covers: pin task → start focus (full-screen overlay) → pause/resume → brain-dump capture → exit → verify in MindBox. The newer App-level features were verified via unit tests (`focusSession.test.js`, pure functions) + manual/code review only.
- **PiP mini-window UI is hand-built DOM/CSS**, separate from `FloatingFocusTimer.jsx` — any future timer-UI styling change needs to be applied in both places.
- **Document PiP = Chromium desktop only** — no fallback for Firefox/Safari/iOS/Android.
- **Brave Shields / aggressive ad-blockers** can block the RTDB long-poll entirely; surfaced via a 15s "may be stale" warning, but no extra retry beyond Firebase's own reconnect.
- **Sync race-condition defenses are heuristic, not transactional** (timestamp comparison + `localWriteBeforeFirstRtdbRef` + drop guard). The drop guard (threshold=3) is a last-resort net, not a root fix for races between multiple devices/tabs.
- **AI usage limits are client-side localStorage only** — trivially bypassable, it's a cost-control nudge, not a security boundary.
- **PR #206 (todayStr midnight rollover, see §5) has one unchecked manual test item**: leaving the Today tab open across an actual midnight rollover and confirming "Mark deadline done" records the new date. Automated tests (273/273) and build passed, but this specific scenario wasn't manually verified.

---

## 5. Remaining planned PRs

Original plan list (as given), with status updates from this session:

- #206 Swipe-to-delete undo on mobile — *(still pending; actual GitHub PR number may differ — see note above)*
- ~~#207 logical-day / midnight `todayStr` staleness~~ — **✅ DONE.** Merged as actual **PR #206** (`aa8a32f`, "fix: refresh todayStr on midnight rollover for long-lived tabs") by a concurrent session during this handoff. New `web/src/hooks/useTodayStr.js` (60s re-check, only re-renders on actual date change) is now used in `TodayTabWithDeadlineHistory.jsx`, `DayMapPage.jsx`, and App.jsx's visit-streak effect. 273/273 tests pass, build clean. One manual test item left unchecked (see §4).
- #208 Low Energy / MVD inconsistency
- #209 task card compactness
- #210 long task headline editing UX
- #211 settings profile dropdown closes after save
- #212 AI Coach brief rewrite
- #213 MindBox simplification redesign
- #214 edit deep focus page / timer / task
- #215 Reflection section parked

---

## 6. Recommended next step

1. `git pull origin main` to sync to `aa8a32f` (includes PR #205 *and* the just-merged PR #206 todayStr fix).
2. The original top recommendation (triage the midnight/`todayStr` staleness issue) is now **done** — no longer needs prioritizing.
3. Given proximity to the just-completed Focus Timer work, **#214 (edit deep focus page/timer/task)** is a natural next pick — `useFocusTimer`/`focusSession`/`FloatingFocusTimer` context is freshest. Otherwise, pick whichever of #208–#213/#215 the user prioritizes.
4. Before starting: check actual open/recent PRs on GitHub (numbering has drifted from this plan, and other sessions are working concurrently) to avoid duplicating in-flight work.
5. For whichever PR is picked: branch off fresh `main`, and check whether Gemini/Antigravity is concurrently touching the same files (branch-rewrite collision risk noted in §3).
