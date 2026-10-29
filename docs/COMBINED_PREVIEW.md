# Combined alpha preview — do not merge to publish it

Branch: `codex/alpha-combined-preview`. This combines frozen versions of draft
PRs 622–633 on main `8f50be6`. Original branches remain untouched. See
`combined-preview-sources.json` for exact inputs. This is a testing branch;
publishing its preview does not require merging any PR or deploying main.

The old preview's last recorded deployment was 19 October 2026 at 23:25 UTC.
It used the production Firebase backend. The combined staging build instead
uses `gen-lang-client-0903100727` and a separate Worker/SQLite ledger named
`loci-ai-alpha-staging`. It displays “Test version · Separate test data”.
Live account data is not copied into staging. Shared provider keys remain
server-side; staging still consumes the same providers' free allowances.

## One-time owner setup

Use the unused Firebase project only if it is okay to repurpose its empty
default RTDB. Deployment refuses unrelated rules or an existing locked database
with data. If the earlier project still matters, stop and use a fresh project;
the checked project ID must then be changed explicitly in code.

1. In [Firebase Authentication](https://console.firebase.google.com/project/gen-lang-client-0903100727/authentication/providers),
   enable Google sign-in, choosing the support email when prompted.
2. In Authentication → Settings → Authorized domains, add
   `loci-flow--redesign-75-5837bxye.web.app`.
3. In [Realtime Database](https://console.firebase.google.com/project/gen-lang-client-0903100727/database),
   create the default database in **locked/production mode**. This means deny-all
   rules initially, not using the live Loci project. Do not enable public writes.
4. In Project settings → Service accounts, generate a private key for a service
   account in this **test project**. In Google Cloud IAM for this project, give
   that account the **Firebase Admin** role. Save the downloaded JSON directly
   as GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT_LOCI_STAGING` in
   [repository Actions secrets](https://github.com/sbrd2010/Loci-Flow-aistudio/settings/secrets/actions).
   Do not paste it in chat or commit it. Keep its local copy private.
5. Add Actions secret `AI_STAGING_ALLOWED_EMAILS` containing the Google email(s)
   allowed to try the staging AI, separated by commas. Start with your own.

Existing `FIREBASE_SERVICE_ACCOUNT_LOCI_FLOW`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and shared provider secrets are reused only by the
existing trusted CI deployment steps. No new paid provider is selected.
Repository credentials cannot be inspected or configured from this chat.

## Publish the combined preview

In Actions → **Deploy redesign preview** → Run workflow, select branch
`codex/alpha-combined-preview`. Do not choose main or the old redesign branch.
The equivalent command is:

```sh
gh workflow run firebase-preview.yml --ref codex/alpha-combined-preview
```

This job:

- checks required settings, unit tests and staging isolation guards;
- discovers or registers the dedicated “Loci Alpha Staging” Firebase web app;
- deploys rules only to the checked test database, preserving unrelated data;
- deploys only `loci-ai-alpha-staging` and its separate token ledger;
- builds with explicit staging settings and disables analytics;
- updates only Hosting channel `redesign-75`, never its live release.

The workflow summary prints the preview URL. It should retain the existing URL
while that channel exists. If Firebase recreates it with another hostname, add
the new hostname to test Auth's authorized domains and update `PREVIEW_HOST`.
Missing settings stop before changing the preview. No workflow merges PRs.

## Integration checks and differences

Both task logical-clock and thought/highlight overlays are retained in
`applyEditsSince`, with a regression checking both in the same acknowledgement.
The delayed-account-response test now uses an external SDK sign-out: the new
normal sign-out correctly waits for held saves, so the old test could no longer
use UI sign-out to force an account switch while holding that response.
Isolation assertions remain intact. Other source changes are copied from the
frozen drafts rather than reimplemented.

Use invented tasks and two ordinary test sign-ins. Check onboarding, saved
tasks after refresh, two devices editing different tasks/thoughts, offline
recovery, refused sign-out, changing accounts, Coach/14-day Review, notebook
editing, JSON backup/restore and the AI limit message. Real iPhone Safari and
Android device checks remain necessary. This web staging configuration does
not register an Android Firebase app or replace Android's production config.

The original PRs can later be reviewed/merged individually, preserving the
integration-only test/config changes, or the combined branch can be reviewed
as one release. Neither path has been executed here. Do not merge both blindly.
