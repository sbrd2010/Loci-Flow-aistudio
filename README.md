# Loci

**A day planner that helps you choose the one thing to do now, and gets you started on it.**

Most to-do apps help you collect tasks. Loci helps with the harder step: picking one when everything feels urgent, and starting.

> Copyright (c) 2026 sbrd2010. All rights reserved. This is not open source: see [LICENSE](LICENSE).
> Loci is in private testing at [loci-flow.web.app](https://loci-flow.web.app).

## What it does

- **One thing at a time.** Today is built around a single task you've chosen. With nothing chosen, Loci offers three, its own pick first with the reason, and **Choose for me** if you can't decide.
- **Honest reasons.** When Loci narrows your list down, it shows its working (what's due, what won't fit in the time you have left) and states only what is true. No pep talk, no guesses.
- **Horizons and deadlines.** Work sits at the horizon it belongs to: today, this week, month, quarter or half-year. Fronts group related work under one deadline, and your Key Deadline always shows.
- **Day Map.** Lays today's tasks over the hours you actually have, and says plainly what won't fit.
- **A day that fits your hours.** If you work late, your Loci day can end after midnight.
- **Focus sessions** for the task in front of you, with gentle help when it isn't moving ("I'm stuck").
- **Mind Box.** Somewhere to drop a stray thought so it stops pulling at you.
- **Coach.** An AI coach that knows your plan: ask it what to do next, how to plan the week or how to get unstuck. AI can also split a big task into steps. It runs on free AI providers.
- **Works across devices.** Sign in and your plan syncs. An Android app is on its way.

## Built with

React and Vite, Firebase (sign-in and sync), and a small Cloudflare Worker that relays AI requests. Tests run with Vitest and Playwright.

## Running it locally

For the owner and invited collaborators. Needs Node.js 22+.

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173` and use **Try Demo** to look around without signing in. Optional settings are described in `web/.env.example`.

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build into `web/dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |

The Android app wraps the same web code. See [`web/android/README_ANDROID.md`](web/android/README_ANDROID.md).
