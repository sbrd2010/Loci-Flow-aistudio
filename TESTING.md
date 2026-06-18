# Loci Manual Testing Checklist

Version: v0.1 Personal Alpha
Owner: Rohan
Last updated: YYYY-MM-DD

## Purpose

This checklist must be run before merging important PRs, especially anything touching:

* Auth
* Sync
* Task data
* Firebase/database logic
* AI coach
* Timer/focus state
* Mobile/PWA behaviour

Automated tests are useful, but manual testing is still required for real-device confidence.

## Test Devices

Record test results for:

| Device                          | Platform             | Tested? | Notes |
| ------------------------------- | -------------------- | ------: | ----- |
| Pixel 6a                        | Android Chrome / PWA |       ☐ |       |
| iPhone 11 Pro                   | Safari / PWA         |       ☐ |       |
| Laptop/Desktop                  | Chrome/Edge          |       ☐ |       |
| Same account across two devices | Cross-device sync    |       ☐ |       |
| Separate accounts               | User separation      |       ☐ |       |

## 1. Auth Tests

* [ ] Fresh open app
* [ ] Google sign-in opens correctly
* [ ] User cancellation is handled gracefully
* [ ] Popup blocked or redirect fallback is handled gracefully
* [ ] Failed Google sign-in shows a friendly error
* [ ] Logout clears current user state
* [ ] Closing and reopening app preserves expected session
* [ ] Logging in as another user does not show previous user’s tasks

Result:

```txt
Auth result:
Pass / Fail:
Device(s):
Notes:
```

## 2. Core Task Tests

* [ ] Add a new task
* [ ] Edit task title
* [ ] Edit task priority/category/horizon if available
* [ ] Add or edit concrete first step
* [ ] Complete task
* [ ] Undo completion if available
* [ ] Delete task
* [ ] Undo delete if available
* [ ] Refresh page and verify task state remains correct
* [ ] Logout/login and verify task state remains correct

Result:

```txt
Core task result:
Pass / Fail:
Device(s):
Notes:
```

## 3. Cross-Device Sync Tests

Use the same account on two devices.

* [ ] Create task on laptop → appears on phone
* [ ] Create task on phone → appears on laptop
* [ ] Edit task on laptop → update appears on phone
* [ ] Edit task on phone → update appears on laptop
* [ ] Complete task on one device → completion appears on other
* [ ] Delete task on one device → deletion appears on other
* [ ] Undo delete if available → restored task appears on other
* [ ] Refresh both devices → same final state remains

Result:

```txt
Sync result:
Pass / Fail:
Device(s):
Notes:
```

## 4. Account Separation Tests

Use two different accounts.

* [ ] Login as User A
* [ ] Create a clearly named test task
* [ ] Logout
* [ ] Login as User B
* [ ] Verify User A’s task is not visible
* [ ] Create User B test task
* [ ] Logout
* [ ] Login as User A
* [ ] Verify only User A data appears

Result:

```txt
Account separation result:
Pass / Fail:
Device(s):
Notes:
```

## 5. Today / Now Focus / Timer Tests

* [ ] Add a Today task
* [ ] Pin task as Now Focus
* [ ] Start timer
* [ ] Pause timer if available
* [ ] Resume timer if available
* [ ] Complete focused task
* [ ] Verify timer does not ghost-run after completion
* [ ] Refresh during timer and verify app recovers gracefully
* [ ] Close/reopen app during timer and verify no broken state

Result:

```txt
Focus/timer result:
Pass / Fail:
Device(s):
Notes:
```

## 6. Roadmap / Horizon Tests

* [ ] Add task to Today
* [ ] Move task to This Week
* [ ] Move task to Month
* [ ] Move task to Quarter
* [ ] Move task to 6 Months
* [ ] Move task to Work
* [ ] Refresh and verify task remains in correct horizon
* [ ] Check sync after horizon move

Result:

```txt
Roadmap result:
Pass / Fail:
Device(s):
Notes:
```

## 7. Brain Dump / Triage Tests

* [ ] Add brain dump item
* [ ] Convert or move item into a task
* [ ] Move item/task to correct horizon
* [ ] Refresh and verify state persists
* [ ] Check cross-device sync
* [ ] Verify triage UI still appears after recent changes

Result:

```txt
Brain dump result:
Pass / Fail:
Device(s):
Notes:
```

## 8. Mind Box / Recovery Tests

* [ ] Open Mind Box
* [ ] Test Morning Ritual if available
* [ ] Test Rescue Mode
* [ ] Test Bad Day Reset:
  * [ ] Create active tasks
  * [ ] Run Bad Day Reset
  * [ ] Confirm tasks are parked, not lost
  * [ ] Go to Coach → Parked Tasks
  * [ ] Restore one parked task
  * [ ] Confirm it returns correctly to the active list
  * [ ] Refresh and verify state persists
* [ ] Refresh and verify recovery state is consistent
* [ ] Check sync if recovery action changes tasks

Result:

```txt
Mind Box result:
Pass / Fail:
Device(s):
Notes:
```

## 9. Coach / AI Tests

* [ ] Send normal message to Coach
* [ ] Ask Coach for help choosing a task
* [ ] Ask Coach to respond when no task is selected
* [ ] Ask Coach about current task context
* [ ] Trigger Focus Briefing if available
* [ ] Verify AI failure shows friendly message, not crash
* [ ] Verify provider fallback if implemented
* [ ] Verify response does not expose internal/private prompt language

Result:

```txt
Coach result:
Pass / Fail:
Provider tested:
Device(s):
Notes:
```

## 10. Settings Tests

* Synced/Account Settings:
  * [ ] Change user name
  * [ ] Change coach name
  * [ ] Change challenge type
  * [ ] Verify settings persist after refresh
  * [ ] Verify settings persist after logout/login
  * [ ] Check settings sync correctly across devices
* Device-Local/Browser-Local Settings:
  * [ ] Change AI provider preference and API keys
  * [ ] Verify AI provider preference and API keys persist on the local device/browser after refresh
  * [ ] Confirm that AI provider preference and API keys do NOT sync across different devices (they are stored locally for security and device-local flexibility, and should not be expected to sync unless intentionally changed in a future feature)
  * [ ] Change timer setting if available (if device-local)

Result:

```txt
Settings result:
Pass / Fail:
Device(s):
Notes:
```

## 11. Weak Network / Recovery Tests

* [ ] Turn off internet
* [ ] Try adding a task
* [ ] Turn internet back on
* [ ] Verify app syncs or gives clear warning
* [ ] Simulate refresh after failed sync
* [ ] Verify no silent data loss
* [ ] Verify sync warning clears after successful sync

Result:

```txt
Weak network result:
Pass / Fail:
Device(s):
Notes:
```

## 12. Pre-Merge Checklist

Before merging a PR:

* [ ] I know what changed
* [ ] I know which feature area could break
* [ ] I ran relevant manual tests
* [ ] I tested at least one real device
* [ ] I checked for console errors if possible
* [ ] I checked that task data was not lost
* [ ] I checked that sync still works if the PR touched task state
* [ ] I checked that login/logout still works if the PR touched auth or app state
* [ ] I have a rollback path
* [ ] I wrote test notes in the PR

## PR Test Notes Template

```txt
## What changed
-

## Why
-

## Risk level
Low / Medium / High

## Areas affected
-

## Manual tests run
-

## Devices tested
-

## Known issues
-

## Rollback plan
-
```

## Golden Rule

If a PR touches auth, sync, task persistence, AI provider logic, or timer state, do not merge based only on automated tests.

Run manual tests first.
