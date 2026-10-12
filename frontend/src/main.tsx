import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service Worker anmelden, damit sich die App installieren lässt (nur in der gebauten App,
// beim Entwickeln mit "npm run dev" würde er sonst alte Dateien ausliefern).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service Worker nicht angemeldet:", err));
  });
}
