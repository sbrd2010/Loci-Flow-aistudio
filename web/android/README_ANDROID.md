# Loci Focus — Android app (Capacitor)

This folder contains the **native Android app** for Loci Focus. It wraps the
existing JavaScript web app (in `web/src/`) with [Capacitor](https://capacitorjs.com),
so every feature built in the web app — all 360+ PRs of React/CSS work — runs
unchanged inside a native Android shell.

> **Scope boundary for Claude Code (lead JS/CSS coder):**
> The Android app is **entirely contained in this `web/android/` folder** plus a
> thin, web-safe notification bridge (see [Notification bridge](#notification-bridge)
> below). None of the native files here affect the web app's behavior. You can
> keep developing the JavaScript/CSS in `web/src/` exactly as before — the
> Android app simply re-bundles your latest web build on each `cap sync`.

---

## What was added (separate from the JS/CSS work)

| Path | Purpose |
|---|---|
| `web/android/` (this folder) | Full Capacitor Android project (Gradle, manifest, resources) |
| `web/capacitor.config.json` | Capacitor config: app id, name, splash/status-bar/notification settings |
| `web/package.json` (deps only) | Adds `@capacitor/*` packages; no change to web scripts |
| `web/src/utils/nativeNotifs.js` | **New** bridge module — routes notifications to the OS on Android, no-ops on web |
| `web/src/utils/reminders.js` | Tiny bridge hooks (gated by `isNativeApp()`) — web path unchanged |
| `web/src/utils/focusNotifications.js` | Same — bridge hooks, web path unchanged |
| `web/src/components/AddTaskDialog.jsx` | Permission request uses bridge; web path unchanged |
| `web/src/components/SettingsTab.jsx` | Permission UI uses bridge; web path unchanged |
| `web/src/App.jsx` | One effect registers native notification taps; web path unchanged |
| `.github/workflows/android-build.yml` | CI: builds debug APK + signed release AAB on push |

The **old, stale native Kotlin app** (`app/`, root `build.gradle.kts`, etc.) was
removed — it was a separate, abandoned Compose rewrite that had fallen far behind
the JavaScript app.

## Notification bridge

The web app shows notifications via the browser Notification API + a service
worker (`web/public/sw.js`). Android's WebView has no Web Notification API, so
`web/src/utils/nativeNotifs.js` routes the same calls through
`@capacitor/local-notifications` when running natively. **Every bridge call is
guarded by `isNativeApp()`**, so in a normal browser (and in all unit tests) the
original web code runs untouched. All 1410 web tests still pass.

Bonus: because native local notifications are scheduled by the OS, **task
reminders now fire even when the app is closed** — something the web
`setTimeout` approach cannot do.

---

## Build it locally

**Prerequisites:** Node.js 22+, JDK 21 (with `javac`), Android SDK
(platform 36 + build-tools).

```bash
# from the repo root
cd web
npm install
npm run build          # builds the web app into web/dist
npx cap sync android   # copies web/dist into the Android project

cd android
./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
./gradlew bundleRelease      # → app/build/outputs/bundle/release/app-release.aab
```

The debug APK is signed with the Android debug key and can be installed on a
phone immediately for testing (no Play Store needed).

## Build it in CI (recommended)

The `.github/workflows/android-build.yml` workflow runs on every push to
`main`/`master` and on version tags. It builds the web app, syncs Capacitor,
and produces both a debug APK and a release AAB as downloadable artifacts.

### One-time signing setup (for Play Store release builds)

The release AAB must be signed with your own upload key. Generate it once:

```bash
keytool -genkey -v -keystore loci-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload
```

Then add four repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64` of your `loci-upload.jks` (`base64 -w0 loci-upload.jks`) |
| `ANDROID_STORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | e.g. `upload` |
| `ANDROID_KEY_PASSWORD` | key password |

Until ALL four are set, the release AAB is built unsigned and is **not**
uploaded as an artifact (so an unsigned bundle can't be mistaken for a
Play-ready one). The debug APK is always built and installable. Once set,
`bundleRelease` produces a signed AAB ready for the Play Console.

---

## Releasing to Google Play

1. **Bump the version** — the workflow auto-sets `versionCode` to
   `github.run_number` (increments every run, so Play uploads never collide).
   Set the user-visible `versionName` (e.g. `1.0.1`) via the workflow's manual
   trigger input, or change the default in `.github/workflows/android-build.yml`.
2. **Get the signed AAB** — download `loci-focus-release-aab` from the workflow
   run artifacts.
3. **Upload to Play Console** — create the app once, then upload the AAB under
   Production → Create new release.
4. **Play App Signing** — on first upload, Google asks you to "Opt in" to Play
   App Signing. Accept it: Google re-signs your AAB with its own key for
   distribution, and your upload key stays yours for future uploads. This is
   standard and recommended.
5. Complete the store listing (icon, screenshots, privacy policy, content
   rating) and submit for review.

## Updating the Android app with new web changes

Because the Android app is just a wrapper around the web build, new JavaScript
PRs flow in automatically:

```
merge JS PRs → CI runs `npm run build` + `cap sync` → new APK/AAB built
```

Each Play Store upload needs a new `versionCode`, but the web app itself updates
as often as you like. See the repo root README for the daily workflow.

---

## App identity

- **App ID / package:** `com.loci.app`
- **App name:** Loci Focus
- **Min Android:** 8.0 (API 24) · **Target:** Android 16 (API 36)
- **Icon & splash:** generated brain mark on the app's dark "glassy" theme
  (generator script: `web/android/scripts/gen-icons.py`)

## Test on a real device before Play launch

Some things only surface on a real Android phone — test the debug APK for:

- app opens and the splash/icon look right
- **Try Demo** mode works (no sign-in needed)
- **Google / Firebase sign-in works inside the WebView** — this is the main
  risk: Google OAuth sometimes blocks embedded WebViews. If sign-in fails, the
  fix is to switch Firebase Auth to `signInWithRedirect` (already imported in
  `App.jsx`) or add a Capacitor Browser/custom-tab auth flow. Demo mode and all
  other features work regardless.
- Firebase sync works after sign-in
- the notification permission prompt appears when you set a task reminder
- a task reminder fires after the app is fully killed
- tapping a notification opens the app

Note: exact-alarm permissions (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`) are
intentionally **not** declared — Google restricts them on Play, and Capacitor's
inexact scheduling is sufficient for reminders.
