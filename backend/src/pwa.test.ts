import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { Store } from "./db.js";
import { FordClient } from "./ford/client.js";
import { buildServer } from "./server.js";

// Die Dateien für die installierbare App (PWA) liegen in frontend/public.
const publicDir = fileURLToPath(new URL("../../frontend/public", import.meta.url));

function setup() {
  const config: Config = {
    port: 0,
    dataDir: ":memory:",
    pollIntervalMinutes: 5,
    frontendUrl: "/",
    timeZone: "Europe/Berlin",
    // Mit Login, wie auf dem Server: Handy und Browser holen Manifest und Icons ohne Cookie.
    auth: { username: "noah", passwordHash: "x", domain: "ford.example.test", lockWithoutLogin: true },
    ford: {
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "http://localhost:8080/callback",
      authUrl: "https://example.test/auth",
      tokenUrl: "https://example.test/token",
      apiBase: "https://example.test/api",
    },
  };
  const store = new Store(":memory:");
  return buildServer(config, store, new FordClient(config.ford, store), publicDir);
}

describe("PWA", () => {
  it("liefert Manifest, Service Worker und Icons auch ohne Anmeldung", async () => {
    const app = setup();
    const manifest = await app.inject("/manifest.webmanifest");
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers["content-type"]).toMatch(/^application\/manifest\+json/);
    const icons: { src: string }[] = manifest.json().icons;
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      const res = await app.inject(icon.src);
      expect(res.statusCode, icon.src).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
    }

    const sw = await app.inject("/sw.js");
    expect(sw.statusCode).toBe(200);
    expect(sw.headers["content-type"]).toMatch(/javascript/);

    // Die Daten vom Auto bleiben geschützt.
    expect((await app.inject("/api/snapshots/latest")).statusCode).toBe(401);
  });
});
