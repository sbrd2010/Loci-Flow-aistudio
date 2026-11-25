// Test-only harness (#680): the real useSync against the database emulator,
// with its API on window for the auth-e2e specs. It is not part of the app
// (vite build uses index.html only) and exposes nothing in production.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../src/firebase.js";
import { useSync } from "../../src/useSync.js";

function Harness() {
  const [user, setUser] = useState(undefined);
  // undefined: follow the signed-in user; null or a uid: what useSync is given.
  const [uidOverride, setUidOverride] = useState(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  const uid = uidOverride === undefined ? user?.uid || null : uidOverride;
  const api = useSync(uid, user?.email || null);
  window.__h = { api, uid, renders: (window.__h?.renders || 0) + 1, setUid: setUidOverride };
  return <pre id="harness-state">{api.payload ? `tasks:${api.payload.tasks.length}` : "no payload"}</pre>;
}

createRoot(document.getElementById("root")).render(<Harness />);
