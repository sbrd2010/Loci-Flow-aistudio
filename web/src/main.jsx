import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { finishPendingWipe } from "./utils/deleteAccount";
import "./styles/app.css";
import "./styles/mobile-density.css";

// #612: finish clearing a deleted account's local data before anything reads it.
finishPendingWipe();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
