# Loci private alpha: review and release gates

Prepared 29 October 2026. The proposed fixes are reviewable; invitations should
wait for CI, review and an isolated cloud check. No production deployment has
been performed by this review. Merging main deploys Firebase Hosting and rules.

## Review the proposed fixes

| PR | Change | Review order |
| --- | --- | --- |
| [625](https://github.com/sbrd2010/Loci-Flow-aistudio/pull/625) | Spreadsheet-safe task CSV | Independent; small |
| [627](https://github.com/sbrd2010/Loci-Flow-aistudio/pull/627) | Preserve newer save timers; introduce local regression CI | First in account stack |
| [628](https://github.com/sbrd2010/Loci-Flow-aistudio/pull/628) | Reject stale account callbacks | After 627 |
| [629](https://github.com/sbrd2010/Loci-Flow-aistudio/pull/629) | Save before sign-out; explicit offline discard | After 628 |
| [630](https://github.com/sbrd2010/Loci-Flow-aistudio/pull/630) | Preserve later edits after observing an ahead-clock task | After 629 |
| [626](https://github.com/sbrd2010/Loci-Flow-aistudio/pull/626) | Remove personal AI keys when leaving an account | After 630; small |
| [631](https://github.com/sbrd2010/Loci-Flow-aistudio/pull/631) | Clear AI budget messages; stop shared fallback attempts | Independent; deploy before 632 |
| [632](https://github.com/sbrd2010/Loci-Flow-aistudio/pull/632) | Allowlist and atomic server token budgets | Independent; stage before enabling |

Retarget each dependent PR to main after its base lands, then let main-targeted
CI check the resulting integration. Keep all checks enabled. The first alpha
jobs failed at dependency installation; the missing existing install-policy
flag has been corrected on all four branches. Their new runs must complete.

The sync/account changes and persisted AI accounting warrant Codex review and a
user-invoked loopcheck before merge. Neither was triggered automatically.
Existing PRs 622 and 624 overlap auth/sync code: integrate their Google-emulator
coverage and brain-dump overlay carefully, keeping both sets of regressions.

## Make a real staging environment

Use the existing Google/Firebase and Cloudflare owner accounts. No additional
owner accounts, payment card or passwords shared in chat are needed. A test
account means an ordinary sign-in used only for invented test content.

1. In Firebase Console, add a separate project with a clear staging name, such
   as `loci-flow-alpha-staging` (the ID must be globally available). Keep the
   intended free plan. Enable Google sign-in and a locked Realtime Database.
   Register a staging web app. Keep its settings separate from production.
2. Before building, add explicit staging configuration support. The current
   `web/src/firebase.js` is fixed to `loci-flow`: setting environment values or
   using a preview Hosting URL alone will not switch it. The staging build
   must reject missing/mixed production settings before Firebase initializes.
   PR 622's development emulator option is separate from real cloud staging.
3. Give the staging Worker a different name and Firebase project ID, with its
   own SQLite ledger and provider configuration. Do not point it at the
   production project, Worker or ledger. Set its private AI_ALLOWED_EMAILS to
   the staging users. Do not copy owner/task data into staging.
4. Deploy database rules and the staging app only to the explicit staging
   project. Review target IDs and URLs before each deploy. The current main
   deploy buttons target production; do not use them as staging buttons.
5. Two separate ordinary Google sign-ins can represent A and B. Use browser
   profiles and invented tasks. Project ID, app URL and Worker URL are enough
   to identify the setup in chat; do not share credentials/provider keys.

## Verify in staging

- A cannot read/write B's task, settings, chat, ledger or deleted-account data.
- Offline task creation survives a refused sign-out, reconnect/save and reload.
  Discard requires its own confirmation. Test the connection-error sign-out.
- Two devices retain unrelated edits; a later edit after observing the other
  device's future-clock task saves correctly. Refresh older app clients.
- A delayed Coach reply and a cross-tab sign-out cannot expose A's data/keys to B.
- Uninvited/unverified accounts never reach AI. Concurrent direct requests stop
  at the configured personal/pool budget; failures refund; midnight resets.
  Use tiny staging limits and fake prompts, not a production load test.
- Real provider usage metadata settles correctly; BYOK still works after the
  shared pool ends. Confirm the Cloudflare account remains on its intended plan.
- Connector OAuth remains owner-only and its service account can only read the
  intended data. Verify restore into a new UID and the scheduled purge job.
- Check a real Android device and iPhone Safari/PWA, including offline recovery.
  Confirm JSON backup/restore and spreadsheet CSV import using invented tasks.

Start with five invited people after these gates, then expand toward twenty
once ordinary use shows reliable saving and usable shared AI availability.
The tested budgets are 60,000 tokens/person/day and 200,000 shared/day at UTC
reset; providers may exhaust their free allowances sooner.
