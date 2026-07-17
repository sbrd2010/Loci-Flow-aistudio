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
| `web/src/utils/nativeAuth.js` | **New** bridge module — native Google Sign-In on Android (see Google Sign-In setup below), no-ops on web |
| `web/src/utils/reminders.js` | Tiny bridge hooks (gated by `isNativeApp()`) — web path unchanged |
| `web/src/utils/focusNotifications.js` | Same — bridge hooks, web path unchanged |
| `web/src/components/AddTaskDialog.jsx` | Permission request uses bridge; web path unchanged |
| `web/src/components/SettingsTab.jsx` | Permission UI uses bridge; web path unchanged |
| `web/src/App.jsx` | Registers native notification taps, branches sign-in to the native bridge; web path unchanged |
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

### Google Sign-In setup (required — sign-in does not work without this)

The web app's only sign-in method (`signInWithPopup`/`signInWithRedirect` in
`App.jsx`) cannot work inside this app's WebView — Google actively blocks
OAuth sign-in for any embedded WebView user agent. Android instead uses
`web/src/utils/nativeAuth.js`, which signs in via Android's native Credential
Manager (`@capacitor-firebase/authentication`) and bridges the resulting ID
token into this app's existing Firebase Auth (`signInWithCredential`) — so
the rest of the app (`auth.currentUser`, `onAuthStateChanged`, RTDB security
rules) works completely unchanged once signed in this way.

**This requires manual, one-time setup in the Firebase console that no CI
step or code change can substitute for:**

1. In the [Firebase console](https://console.firebase.google.com/) → Project settings →
   your `loci-flow` project → **Add app → Android**.
2. Package name: `com.loci.app` (must match `applicationId` in
   `web/android/app/build.gradle` exactly).
3. Add **every** signing certificate's SHA-1 fingerprint under that Android
   app's settings (Google Sign-In checks the calling app's actual signature,
   not just the package name — sign-in fails for a fingerprint that isn't
   registered). That's not just two — it's three once you release to Play,
   because Play App Signing (step 4 under "Releasing to Google Play" below)
   makes Google re-sign your AAB with **its own** certificate before
   installing it on users' devices, different from your upload key entirely:
   - Debug: `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`. Only the alias/password are universal constants — the actual certificate is generated the first time a debug build runs on a given machine (or CI runner) if `~/.android/debug.keystore` doesn't already exist there, so its SHA-1 differs per machine. This repo doesn't check in a shared debug keystore (deliberately, to avoid re-committing a signing key), so a GitHub Actions run generates and discards a fresh one every time — meaning **the CI-built debug APK's SHA-1 changes on every run** and can't be usefully registered here at all; native Google Sign-In will only work on debug builds run locally from a machine whose debug SHA-1 you've registered (repeat this step per developer machine you need it on).
   - Upload key: `keytool -list -v -keystore loci-upload.jks -alias upload` (the same upload key from the signing setup above) — covers a directly-installed/sideloaded signed release APK/AAB, not a Play-distributed install.
   - **Play App Signing key — required before any Play-distributed install can sign in**: Play Console → your app → Setup → App integrity → App signing → copy the "App signing key certificate" SHA-1 (only available *after* the first upload where you opted into Play App Signing). Registering only the upload key's SHA-1 lets the AAB upload successfully but leaves Google Sign-In broken for every real Play Store user, since their installed app presents this certificate instead.
4. Download the resulting `google-services.json` and place it at
   `web/android/app/google-services.json` (gitignored — do not commit it;
   each environment building a *signed* release needs its own copy, matching
   how `keystore.properties` is handled above). Without this file present,
   the app still builds (the Gradle plugin only applies when the file
   exists — see `app/build.gradle`), but native sign-in fails immediately
   with a Firebase configuration error at runtime.
   - **For CI-built artifacts** (debug APK and signed release AAB uploaded as
     workflow artifacts): add a fifth repository secret,
     `ANDROID_GOOGLE_SERVICES_JSON_BASE64` (`base64 -w0 google-services.json`),
     alongside the four signing secrets above. Without it, CI builds succeed
     but ship with no native Google Sign-In config at all — same failure mode
     as a local build missing the file.
5. Firebase console → Authentication → Sign-in method → confirm **Google**
   is enabled (it already is for the web app, since this reuses the same
   Firebase project — nothing to change here, just confirm).

**Known compromise, not yet fully clean:** `@capacitor-firebase/authentication`
requires either `firebase@^11` or `^12` on every version compatible with this
project's Capacitor 8, or a `firebase@^10`-compatible version (`6.3.1`, what
this project uses) whose own peer dependency asks for `@capacitor/core@^6`.
Upgrading `firebase` is out of scope here — it's a major-version bump
touching this app's entire sync/auth/analytics stack for every user, web
included, not something to do as a side effect of an Android-only fix. So
`web/package.json` pins `@capacitor-firebase/authentication@6.3.1` and every
CI workflow's `npm ci` step passes `--legacy-peer-deps` to accept the
mismatch. The plugin's native Android module has not been verified against
Capacitor 8 beyond "the project compiles in CI" — if Google Sign-In doesn't
work end-to-end on a real device, revisit whether a firebase major upgrade
(clean install, no flags) is worth doing at that point.

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
   - **Immediately after this**, go back and register this new certificate's
     SHA-1 in Firebase — see the "Google Sign-In setup" section above. Until
     you do, Google Sign-In is broken for every user who installs from Play
     (it still worked in every build/test before this point, since none of
     that used the Play App Signing certificate).
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
