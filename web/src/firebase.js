import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDKCF2WcJk9kI1YovHBTPrWj2QSdmrjUx0",
  authDomain: "loci-flow.firebaseapp.com",
  databaseURL: "https://loci-flow-default-rtdb.firebaseio.com",
  projectId: "loci-flow",
  storageBucket: "loci-flow.appspot.com",
  messagingSenderId: "862993748883",
  appId: "1:862993748883:web:loci-web-app"
};

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
