# Restoring a deleted account (owner only)

"Delete all my data" (#612) keeps a copy for 30 days in `deletedAccounts/{oldUid}`. No app can read it; only you can, in the Firebase console. A daily GitHub Action (`purge-deleted-accounts.yml`) erases each copy once it is 30 days old.

## When someone asks to restore

1. **Find the copy.** Firebase console → Realtime Database → `deletedAccounts`. Each entry has `deletedAt` (milliseconds) and `email`. Match the email the person writes from.
2. **They sign in again.** A new sign-in creates a new account with a **new uid**. The old uid stays blocked by its tombstone, so restore into the new one. Ask them to sign in once, then close the app.
3. **Find the new uid.** Firebase console → Authentication → their email → User UID.
4. **Copy the data.** In `deletedAccounts/{oldUid}`, use ⋮ → Export JSON on `sync`. Then go to `sync/{newUid}`, use ⋮ → Import JSON, and choose that file. Do the same for `activityLogs` → `activityLogs/{newUid}` if they want their focus history back.
5. **Tell them to reopen the app.** Their tasks come back on the next load.
6. **Delete the copy:** `deletedAccounts/{oldUid}` → delete. It has been restored, so it shouldn't wait for the 30-day purge.

Don't edit `activityLogs/{oldUid}/accountDeletedAt`. That tombstone is what stops old devices from writing the deleted data back.
