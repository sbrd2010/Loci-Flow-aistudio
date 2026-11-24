import { initializeApp } from "firebase/app";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";
import { getAuth, connectAuthEmulator } from "firebase/auth";

// Signed-in integration tests use an isolated demo project. This opt-in is
// development-only, so a production build always uses the normal project.
const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";
const firebaseConfig = useEmulators ? {
  apiKey: "fake-api-key",
  authDomain: "demo-loci-flow-e2e.firebaseapp.com",
  databaseURL: "https://demo-loci-flow-e2e-default-rtdb.firebaseio.com",
  projectId: "demo-loci-flow-e2e",
} : {
  apiKey: "AIzaSyDKCF2WcJk9kI1YovHBTPrWj2QSdmrjUx0",
  authDomain: "loci-flow.firebaseapp.com",
  databaseURL: "https://loci-flow-default-rtdb.firebaseio.com",
  projectId: "loci-flow",
  storageBucket: "loci-flow.appspot.com",
  messagingSenderId: "862993748883",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:862993748883:web:e78b0587e367aa1580ce66"
};

// RTDB uses the SDK's default transport: WebSocket first, falling back to
// long-polling by itself where WebSocket is blocked (and remembering that).
// Forcing long-polling (#650) sent every full save as ~1.8 KB requests one
// round trip apart: a 225 KB account took 20-40 s to save, so sign-out's
// confirmed save timed out. Don't force a transport without measuring it.

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
}

// Analytics is loaded lazily only when a Measurement ID is configured,
// so Brave Shields never sees it on page load and can't block the app.
const measurementId = useEmulators ? "" : import.meta.env.VITE_GA_MEASUREMENT_ID || "";
let _logEvent = null;
let _analytics = null;
if (measurementId) {
  import("firebase/analytics").then(({ getAnalytics, logEvent, isSupported }) => {
    isSupported().then(yes => {
      if (yes) {
        _analytics = getAnalytics(app);
        _logEvent = (name, params) => logEvent(_analytics, name, params);
      }
    }).catch(() => {});
  }).catch(() => {});
}

export function track(eventName, params = {}) {
  try { if (_logEvent) _logEvent(eventName, params); } catch (_) {}
}

// Links all subsequent events to a specific user identity in Firebase Analytics.
// Called once on sign-in so Rohan/Sweta sessions are distinguishable in the dashboard.
export function setAnalyticsUser(uid) {
  if (!measurementId) return;
  import("firebase/analytics").then(({ getAnalytics, setUserId, isSupported }) => {
    isSupported().then(yes => {
      if (yes) setUserId(getAnalytics(app), uid);
    }).catch(() => {});
  }).catch(() => {});
}
