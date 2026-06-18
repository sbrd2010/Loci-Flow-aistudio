# Loci Alpha Stability Map

Version: v0.1 Personal Alpha
Owner: Rohan
Last updated: YYYY-MM-DD
Current users: Personal alpha only

## Purpose

This document tracks which parts of Loci are stable, shaky, risky, or future backlog.

The goal is to protect the working app while improving it safely.

Status labels:

* 🟢 Solid — tested recently and reliable
* 🟡 Essential but shaky — core feature, but known/recent instability
* 🔴 Risky / broken — unpredictable or dangerous
* ⚪ Future backlog — not urgent for current stability
* ❓ Unknown — not tested recently

## Stability Principles

1. Stability before scale.
2. One bug = one PR = one test cycle.
3. No feature work while P0/P1 issues exist.
4. No unrelated refactors in bug-fix PRs.
5. No merge without manual test notes.
6. Protect user data above all else.

## Severity Rules

### P0 — Stop everything

Examples:

* Data loss
* Cannot log in
* Wrong user data visible
* Sync corruption
* App crash on launch

### P1 — Fix before features

Examples:

* Sync unreliable
* Completion not saving
* Timer/core flow broken
* AI breaks core Coach flow
* Onboarding blocks user

### P2 — Fix soon

Examples:

* One-device UI bug
* Confusing copy
* Non-core feature issue

### P3 — Polish

Examples:

* Spacing
* Icon alignment
* Minor visual issue

### P4 — Future idea

Examples:

* New integrations
* New providers
* New features
* Advanced automation

## Feature Stability Table

| Area     | Feature / Flow                                         | Status | Severity if broken | Last tested | Device(s) tested | Notes / Known issues | Next action                            |
| -------- | ------------------------------------------------------ | -----: | -----------------: | ----------- | ---------------- | -------------------- | -------------------------------------- |
| Auth     | Sign up                                                |      ❓ |                 P0 |             |                  |                      | Test on laptop + Pixel + iPhone        |
| Auth     | Login                                                  |      ❓ |                 P0 |             |                  |                      | Test repeated login/logout             |
| Auth     | Logout                                                 |      ❓ |                 P0 |             |                  |                      | Verify old user data clears            |
| Auth     | Session persistence                                    |      ❓ |                 P1 |             |                  |                      | Close/reopen app and verify            |
| Sync     | Create task syncs across devices                       |      ❓ |              P0/P1 |             |                  |                      | Test laptop → phone and phone → laptop |
| Sync     | Edit task syncs across devices                         |      ❓ |                 P1 |             |                  |                      | Test title, horizon, priority          |
| Sync     | Complete task syncs across devices                     |      ❓ |                 P1 |             |                  |                      | Complete on one device, verify other   |
| Sync     | Delete / undo sync                                     |      ❓ |              P0/P1 |             |                  |                      | Verify no task loss or ghost task      |
| Sync     | Cloud sync failure warning                             |      ❓ |                 P1 |             |                  |                      | Confirm user sees failure clearly      |
| Today    | Add task                                               |      ❓ |                 P1 |             |                  |                      |                                        |
| Today    | Edit task                                              |      ❓ |                 P1 |             |                  |                      |                                        |
| Today    | Complete task                                          |      ❓ |                 P1 |             |                  |                      |                                        |
| Today    | Delete / undo task                                     |      ❓ |              P0/P1 |             |                  |                      |                                        |
| Today    | Now Focus pinning                                      |      ❓ |                 P1 |             |                  |                      |                                        |
| Today    | Focus timer start/pause/complete                       |      ❓ |                 P1 |             |                  |                      |                                        |
| Today    | Low-Energy Mode                                        |      ❓ |                 P2 |             |                  |                      |                                        |
| Roadmap  | Move task across horizons                              |      ❓ |                 P1 |             |                  |                      |                                        |
| Roadmap  | Brain dump triage                                      |      ❓ |                 P1 |             |                  |                      |                                        |
| Roadmap  | Today / Week / Month / Quarter / 6 Months / Work views |      ❓ |                 P1 |             |                  |                      |                                        |
| Mind Box | Brain Dump                                             |      ❓ |                 P1 |             |                  |                      |                                        |
| Mind Box | Rescue Mode                                            |      ❓ |                 P2 |             |                  |                      |                                        |
| Mind Box | Bad Day Reset                                          |      ❓ |                 P1 |             |                  |                      |                                        |
| Mind Box | Morning Ritual                                         |      ❓ |                 P2 |             |                  |                      |                                        |
| Coach    | Normal chat response                                   |      ❓ |                 P1 |             |                  |                      |                                        |
| Coach    | Task-aware response                                    |      ❓ |                 P1 |             |                  |                      |                                        |
| Coach    | Focus Briefing                                         |      ❓ |                 P1 |             |                  |                      |                                        |
| Coach    | AI provider fallback                                   |      ❓ |                 P1 |             |                  |                      |                                        |
| Coach    | Rate-limit / error handling                            |      ❓ |                 P1 |             |                  |                      |                                        |
| Settings | User name persists                                     |      ❓ |                 P2 |             |                  |                      |                                        |
| Settings | Coach name persists                                    |      ❓ |                 P2 |             |                  |                      |                                        |
| Settings | Challenge type persists                                |      ❓ |                 P2 |             |                  |                      |                                        |
| Settings | AI key/settings behaviour                              |      ❓ |                 P1 |             |                  |                      |                                        |
| Mobile   | Pixel 6a browser/PWA behaviour                         |      ❓ |                 P1 |             |                  |                      |                                        |
| Mobile   | iPhone 11 Pro Safari/PWA behaviour                     |      ❓ |                 P1 |             |                  |                      |                                        |
| Desktop  | Laptop browser behaviour                               |      ❓ |                 P1 |             |                  |                      |                                        |

## Current Stability Focus

Current phase: v0.1 Personal Alpha

Priority order:

1. No data loss
2. Login/logout reliable
3. Cross-device sync reliable
4. Core task flows reliable
5. Focus/timer reliable
6. AI coach graceful failure
7. Mobile/iPhone behaviour stable

## Frozen Until Stable

Do not add these until P0/P1 issues are resolved:

* New AI providers
* New calendar/email integrations
* New major UI screens
* New gamification systems
* New dashboards
* Public launch features
* Play Store work
* Reddit/public beta growth

## PR Merge Rule

Before merging any PR, answer:

* What changed?
* What could this break?
* Which stability-map rows are affected?
* Which tests were run?
* Which devices were tested?
* Is rollback easy?

If the answer is unclear, do not merge.
