import { describe, it, expect, vi, beforeEach } from "vitest";

const signInWithGoogleMock = vi.fn();
const credentialMock = vi.fn();
const signInWithCredentialMock = vi.fn();
let nativePlatform = true;

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => nativePlatform },
}));

vi.mock("@capacitor-firebase/authentication", () => ({
  FirebaseAuthentication: {
    signInWithGoogle: (...args) => signInWithGoogleMock(...args),
  },
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: {
    credential: (...args) => credentialMock(...args),
  },
  signInWithCredential: (...args) => signInWithCredentialMock(...args),
}));

import { signInWithGoogleNative } from "./nativeAuth";

// Regression coverage for the Google-Sign-In-blocked-in-WebView fix: proves
// the bridge actually extracts the native ID token and hands it to the
// Firebase JS SDK's signInWithCredential, rather than e.g. passing the
// whole native result through unchanged or dropping the token.
describe("signInWithGoogleNative", () => {
  const fakeAuth = { fake: "auth-instance" };

  beforeEach(() => {
    nativePlatform = true;
    signInWithGoogleMock.mockReset();
    credentialMock.mockReset();
    signInWithCredentialMock.mockReset();
  });

  it("bridges the native ID token into GoogleAuthProvider.credential + signInWithCredential", async () => {
    signInWithGoogleMock.mockResolvedValue({ credential: { idToken: "the-id-token" } });
    credentialMock.mockReturnValue("the-credential-object");
    signInWithCredentialMock.mockResolvedValue({ user: { uid: "u1" } });

    await signInWithGoogleNative(fakeAuth);

    expect(credentialMock).toHaveBeenCalledWith("the-id-token");
    expect(signInWithCredentialMock).toHaveBeenCalledWith(fakeAuth, "the-credential-object");
  });

  it("rejects instead of silently succeeding when the native result has no ID token", async () => {
    signInWithGoogleMock.mockResolvedValue({ credential: {} });

    await expect(signInWithGoogleNative(fakeAuth)).rejects.toThrow("no_id_token");
    expect(signInWithCredentialMock).not.toHaveBeenCalled();
  });

  it("rejects immediately on web (non-native) instead of attempting the native plugin", async () => {
    nativePlatform = false;

    await expect(signInWithGoogleNative(fakeAuth)).rejects.toThrow();
    expect(signInWithGoogleMock).not.toHaveBeenCalled();
  });
});
