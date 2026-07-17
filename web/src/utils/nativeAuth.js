// Native Google Sign-In bridge for the Capacitor Android app.
//
// signInWithPopup/signInWithRedirect (the web sign-in path, see App.jsx)
// both require navigating to Google's OAuth consent page inside the current
// browsing context. Google actively blocks this for any embedded WebView
// user agent — including Capacitor's default Android WebView — and returns
// a disallowed_useragent error, so neither web method can ever succeed
// inside this native app. This module routes native sign-in through
// @capacitor-firebase/authentication's Google Sign-In instead, which uses
// Android's native Credential Manager (not a WebView), and is configured
// with skipNativeAuth (capacitor.config.json) so it does no more than hand
// back an ID token — the actual sign-in against this app's existing
// Firebase project still happens via the regular Firebase JS SDK
// (signInWithCredential), so auth.currentUser/onAuthStateChanged and every
// other part of the app that already depends on the JS SDK's auth object
// keep working completely unchanged.
//
// Requires a real web/android/app/google-services.json registered for this
// app's applicationId (com.loci.app) with the release/debug signing
// certificates' SHA-1 fingerprints added in the Firebase console — see
// web/android/README_ANDROID.md's Google Sign-In setup section. Without
// that, this rejects with a clear error rather than failing silently.

import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { isNativeApp } from "./nativeNotifs";

async function FirebaseAuthentication() {
  const mod = await import("@capacitor-firebase/authentication");
  return mod.FirebaseAuthentication;
}

// Signs in on Android via the native Google Sign-In flow, then bridges the
// resulting ID token into the Firebase JS SDK's `auth` so the rest of the
// app (which only ever reads auth.currentUser / onAuthStateChanged) sees a
// normal signed-in user, same as the web signInWithPopup/signInWithRedirect
// path does. Throws on failure — callers should catch and surface an error,
// matching how the web sign-in path's .catch() already works.
export async function signInWithGoogleNative(auth) {
  if (!isNativeApp()) throw new Error("signInWithGoogleNative called outside the native app");
  const FA = await FirebaseAuthentication();
  const result = await FA.signInWithGoogle();
  const idToken = result?.credential?.idToken;
  if (!idToken) throw new Error("no_id_token");
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential);
}
