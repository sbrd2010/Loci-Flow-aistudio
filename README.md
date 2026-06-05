# Loci

A personal productivity web app for managing your day — task lists, deep focus sessions, and a visual Day Map to schedule where each task fits in your week.

## Tech stack

- **Frontend** — React 18 + Vite
- **Backend / sync** — Firebase Realtime Database
- **Testing** — Vitest (unit), Playwright (E2E)

## Run locally

**Prerequisites:** Node.js 18+, npm

```bash
# 1. Install dependencies
cd web
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — see comments inside for which keys are optional

# 3. Start dev server
npm run dev
```

The app opens at `http://localhost:5173`. A **Try Demo** button on the landing page lets you explore without signing in or configuring Firebase.

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start local dev server with hot reload |
| `npm run build` | Production build into `web/dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run unit tests with Vitest |
| `npm run test:e2e` | Run Playwright E2E tests (requires dev server running) |

## Environment variables

Copy `web/.env.example` to `web/.env`. All variables are optional for local development — the app runs in demo mode without them.

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_APP_ID` | Firebase web app ID (enables cloud sync) |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics (optional) |
| `VITE_GROQ_KEY` | Groq API key for AI features (optional) |
| `VITE_GEMINI_KEY` | Gemini API key for AI features (optional) |

Firebase config beyond the app ID (API key, project ID, etc.) is baked into the app for the hosted version. For your own Firebase project, update `web/src/firebase.js`.
