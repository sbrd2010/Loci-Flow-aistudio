import { initializeApp } from "firebase/app";
import { getDatabase, forceLongPolling } from "firebase/database";
import { getAuth } from "firebase/auth";

// NOTE: appId should be the real value from Firebase Console →
// Project Settings → Your apps → Web app → App ID.
// The current value "loci-web-app" is a placeholder — replace with the real
// 16-char hex suffix (format: 1:PROJECT_NUMBER:web:HEX16) to avoid
// Firebase Installations / App Check failures on real devices.
const firebaseConfig = {
  apiKey: "AIzaSyDKCF2WcJk9kI1YovHBTPrWj2QSdmrjUx0",
  authDomain: "loci-flow.firebaseapp.com",
  databaseURL: "https://loci-flow-default-rtdb.firebaseio.com",
  projectId: "loci-flow",
  storageBucket: "loci-flow.appspot.com",
  messagingSenderId: "862993748883",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:862993748883:web:loci-web-app"
};

// Use HTTP long-polling instead of WebSocket for RTDB connections.
// WebSocket (wss://) is blocked by Brave Shields, carrier-level DPI filters,
// corporate proxies, and many mobile networks. Long-polling uses standard
// HTTPS on port 443 which works on virtually every network.
// MUST be called before getDatabase().
forceLongPolling();

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Analytics is loaded lazily only when a Measurement ID is configured,
// so Brave Shields never sees it on page load and can't block the app.
const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID || "";
let _logEvent = null;
if (measurementId) {
  import("firebase/analytics").then(({ getAnalytics, logEvent, isSupported }) => {
    isSupported().then(yes => {
      if (yes) _logEvent = (name, params) => logEvent(getAnalytics(app), name, params);
    }).catch(() => {});
  }).catch(() => {});
}

export function track(eventName, params = {}) {
  try { if (_logEvent) _logEvent(eventName, params); } catch (_) {}
}
