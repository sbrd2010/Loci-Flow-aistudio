# Loci connector for ChatGPT and Claude (read-only)

A small Cloudflare Worker in `mcp/` that lets ChatGPT and Claude read your live Loci plan: fronts and deadlines, Today's list, overdue work, the last seven days. It cannot change anything. Design and plan: issue #537.

```
ChatGPT / Claude ──MCP──▶ Worker (mcp/) ──read-only──▶ Firebase sync/{your uid}
                           └─ sign-in with Google, only your email
```

Only one person can use it: the Google account in `ALLOWED_EMAIL`, mapped to the one uid in `LOCI_UID`.

## What it returns, and what it never does

`get_overview` returns: today's date in your zone, fronts with days left, open tasks per horizon, Today's list with estimates, task deadlines (overdue / today / next 14 days; a task with no date of its own takes its front's), completed per day for 7 days.

It never reads chat history or Mind Box thoughts (it fetches only your tasks, settings and daily counts), and it never writes. Task and front titles go to the AI as you wrote them, so a name in a title goes with them. The Firebase account it uses should hold only the Viewer role, so even a bug could not write.

## One-time setup (about 30 minutes)

You need: a free Cloudflare account, Node 22, and your Firebase project. Personal ChatGPT / Claude accounts: workspace admins can turn custom connectors off.

**1. A read-only Firebase account**
Google Cloud console → IAM → Service accounts → create `loci-mcp-reader` and give it only the role **Firebase Realtime Database Viewer**. Keys → Add key → JSON. Keep the file out of the repo.

Check it cannot write: get an access token for this account with the scopes `firebase.database` and `userinfo.email` (the Worker asks for the same two), then `PUT` a small value to `<FIREBASE_DB_URL>/connector-write-check.json`. It must be refused. If it succeeds, the role is wrong: delete that key, and fix the role before going on. That the account *can* read is proved later, in step 5, when the AI answers from your plan.

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
| `EXTRA_REDIRECT_URIS` | optional, see below |

Only Claude's and ChatGPT's own sign-in return addresses may receive access: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, `https://chatgpt.com/connector/oauth/…` and `https://chatgpt.com/connector_platform_oauth_redirect`. Anyone can register an app with this connector, so without the list a stranger could send you a link that looks like "Claude wants access" and be handed your plan when you sign in. If an app is refused (the Worker log shows "Refused a sign-in that would send access to …"), check that address is really the app's, then add it to `EXTRA_REDIRECT_URIS` (comma-separated; an entry ending in `/` matches everything under it).

The free Workers plan allows 10 ms of CPU per request. Signing in and reading your plan may or may not fit; I could not measure it. If requests fail with "exceeded CPU", the paid plan ($5/month) lifts that.
**5. Connect the apps** with the address `https://<your-worker-url>/mcp`
- Claude: Settings → Connectors → add a custom connector.
- ChatGPT: Settings → Apps / Connectors → turn on developer mode → create a connector (needs a paid plan).

Menu names change; look for "custom connector" and "developer mode". Sign in with Google when asked. Then try: *"Using Loci, review my plan for this week and tell me what is at risk."*

## Turning it off

- Removing the connector in the app does **not** cancel what was issued: the sign-in stays valid for up to 30 days (access tokens last 1 hour and renew from it).
- To cancel every issued token for good, delete the `OAUTH_KV` namespace and create a new one (then update `wrangler.jsonc` and redeploy).
- Changing `LOCI_UID` blocks issued tokens only while it is changed: set it back and they work again. Changing `ALLOWED_EMAIL` only stops *new* sign-ins.

## If someone hammers it

Each sign-in page and each app registration writes to KV, and the free plan allows 1,000 writes a day. A stranger could use that up and stop *you* connecting until it resets (nothing is exposed). If that ever happens, add a Cloudflare rate-limiting rule for `/authorize` and `/oauth/register`.

## Working on it

`cd mcp && npm test`. The tests run with a UTC clock on purpose (see `mcp/src/time.js`). For a local run, copy the table above into `mcp/.dev.vars` (git-ignored) and run `npx wrangler dev`.

## Privacy

What you ask about goes to OpenAI or Anthropic, under the terms of your own account there. Before offering this to other Loci users, `PrivacyPolicy.jsx` must say so.
