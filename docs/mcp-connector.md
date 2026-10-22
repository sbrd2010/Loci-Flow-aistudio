# Loci connector for ChatGPT and Claude (read-only)

A small Cloudflare Worker in `mcp/` that lets ChatGPT and Claude read your live Loci plan: fronts and deadlines, Today's list, overdue work, the last seven days. It cannot change anything. Design and plan: issue #537.

```
ChatGPT / Claude ──MCP──▶ Worker (mcp/) ──read-only──▶ Firebase sync/{your uid}
                           └─ sign-in with Google, only your email
```

Only one person can use it: the Google account in `ALLOWED_EMAIL`, mapped to the one uid in `LOCI_UID`.

## What it returns, and what it never does

`get_overview` returns: today's date in your zone, fronts with days left, open tasks per horizon, Today's list with estimates, task deadlines (overdue / today / next 14 days), completed per day for 7 days.

It never returns chat history, Mind Box thoughts, names or anchors, and it never writes. The Firebase account it uses should hold only the Viewer role, so even a bug could not write.

## One-time setup (about 30 minutes)

You need: a free Cloudflare account, Node 22, and your Firebase project. Personal ChatGPT / Claude accounts: workspace admins can turn custom connectors off.

**1. A read-only Firebase account**
Google Cloud console → IAM → Service accounts → create `loci-mcp-reader` and give it only the role **Firebase Realtime Database Viewer**. Keys → Add key → JSON. Keep the file out of the repo.

Check it cannot write (an access token from `gcloud auth print-access-token --impersonate-service-account=...` works, or use the key with any JWT tool): a `PUT` to `<FIREBASE_DB_URL>/sync/test.json` must be refused. If it succeeds, the role is wrong; stop and fix that before going on.

**2. A Google sign-in client**
Google Cloud console → APIs & Services → OAuth consent screen (External, add your own email as a test user) → Credentials → Create OAuth client ID → Web application. Add the authorized redirect URI `https://<your-worker-url>/callback` once you know the URL (step 3).

**3. Deploy the Worker**
```
cd mcp
npm ci
npx wrangler login
npx wrangler kv namespace create OAUTH_KV     # paste the id into mcp/wrangler.jsonc
npx wrangler deploy                           # prints https://loci-mcp.<you>.workers.dev
```
It answers `503` until step 4 is done. That is expected.

**4. Settings** (set each with `npx wrangler secret put NAME`; none are committed)

| Name | Value |
|---|---|
| `PUBLIC_URL` | the Worker URL from step 3, no trailing slash |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from step 2 |
| `ALLOWED_EMAIL` | the Google account that may connect |
| `LOCI_UID` | your Firebase uid (console → Authentication → Users) |
| `LOCI_TIMEZONE` | an IANA zone, e.g. `Asia/Kolkata` (Loci stores none, and a Worker runs in UTC) |
| `FIREBASE_DB_URL` | your Realtime Database URL |
| `FIREBASE_SERVICE_ACCOUNT` | the whole JSON key file from step 1 |

**5. Connect the apps** with the address `https://<your-worker-url>/mcp`
- Claude: Settings → Connectors → add a custom connector.
- ChatGPT: Settings → Apps / Connectors → turn on developer mode → create a connector (needs a paid plan).

Menu names change; look for "custom connector" and "developer mode". Sign in with Google when asked. Then try: *"Using Loci, review my plan for this week and tell me what is at risk."*

## Turning it off

- Remove the connector in the app. Access tokens last 1 hour and the sign-in lasts 30 days unless renewed.
- To cut off every issued token at once, change `LOCI_UID` (the uid is re-checked on every call), or delete the `OAUTH_KV` namespace and create a new one.
- Changing `ALLOWED_EMAIL` only stops *new* sign-ins; tokens already issued keep working until they expire.

## Working on it

`cd mcp && npm test`. The tests run with a UTC clock on purpose (see `mcp/src/time.js`). For a local run, copy the table above into `mcp/.dev.vars` (git-ignored) and run `npx wrangler dev`.

## Privacy

What you ask about goes to OpenAI or Anthropic, under the terms of your own account there. Before offering this to other Loci users, `PrivacyPolicy.jsx` must say so.
