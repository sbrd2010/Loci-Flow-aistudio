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

