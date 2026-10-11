import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Im Entwicklungsmodus leitet Vite API- und Login-Aufrufe ans Backend weiter.
    proxy: {
      "/api": "http://localhost:8080",
      "/login": "http://localhost:8080",
    },
  },
});
