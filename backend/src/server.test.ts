import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { Store } from "./db.js";
import { FordClient } from "./ford/client.js";
import { parseTelemetry } from "./ford/telemetry.js";
import { buildServer } from "./server.js";

const config: Config = {
  port: 0,
  dataDir: ":memory:",
  pollIntervalMinutes: 5,
  frontendUrl: "/",
  timeZone: "Europe/Berlin",
  // Ohne Login, wie beim Entwickeln am eigenen Rechner. Der Login wird in auth/routes.test.ts getestet.
  auth: { username: null, passwordHash: null, domain: null, lockWithoutLogin: false },
  ford: {
    clientId: "id",
    clientSecret: "secret",
    redirectUri: "http://localhost:8080/callback",
    authUrl: "https://example.test/auth",
    tokenUrl: "https://example.test/token",
    apiBase: "https://example.test/api",
  },
};

function setup(fill?: (store: Store) => void) {
  const store = new Store(":memory:");
  fill?.(store);
  return buildServer(config, store, new FordClient(config.ford, store));
}

/** Speichert einen Kilometerstand für Auto V1. */
function odometer(store: Store, ts: string, km: number) {
  store.saveSnapshot(parseTelemetry({ vin: "V1", metrics: { odometer: { value: km, updateTime: ts } } })[0]);
}

describe("server", () => {
  it("meldet, dass noch niemand eingeloggt ist", async () => {
    const res = await setup().inject("/api/status");
    expect(res.json()).toEqual({ loggedIn: false });
  });

  it("leitet /login zu Ford weiter", async () => {
    const res = await setup().inject("/login");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/example\.test\/auth\?/);
  });

  it("lehnt einen Rücksprung ohne passenden state ab", async () => {
    const res = await setup().inject("/callback?code=x&state=falsch");
    expect(res.statusCode).toBe(400);
  });

  it("liefert null, solange keine Abfahrtszeiten abgefragt wurden", async () => {
    const res = await setup().inject("/api/departure-times");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("null");
  });

  it("liefert null, solange keine Fahrzeugdaten abgefragt wurden", async () => {
    const res = await setup().inject("/api/vehicle-info");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("null");
  });

  it("beschreibt die eigenen Endpunkte als OpenAPI", async () => {
    const res = await setup().inject("/api/docs/json");
    expect(res.statusCode).toBe(200);
    const paths = Object.keys(res.json().paths);
    expect(paths).toEqual(
      expect.arrayContaining(["/api/status", "/api/snapshots/latest", "/api/vehicle-info", "/api/departure-times", "/login"]),
    );
    expect(paths).not.toContain("/api/docs/json");
  });

  it("zeigt die Swagger-Oberfläche unter /api/docs", async () => {
    const res = await setup().inject("/api/docs/");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
  });

  it("liefert den Kilometerstand nach Monaten und die Jahresübersicht", async () => {
    const app = setup((store) => {
      odometer(store, "2026-01-10T10:00:00Z", 1000);
      odometer(store, "2026-02-10T10:00:00Z", 1500);
    });
    const months = await app.inject("/api/odometer?period=month");
    expect(months.json()).toMatchObject({ vin: "V1", period: "month", rows: [{ period: "2026-02", distanceKm: 500 }, { period: "2026-01" }] });

    const year = await app.inject("/api/odometer/year?year=2026");
    expect(year.json()).toMatchObject({ vin: "V1", year: 2026, totalKm: 500, years: expect.arrayContaining([2026]) });
    expect(year.json().months).toHaveLength(12);
  });

  it("lädt die Jahresübersicht als CSV, TXT und Excel herunter", async () => {
    const app = setup((store) => odometer(store, "2026-01-10T10:00:00Z", 1000));
    const csv = await app.inject("/api/odometer/year/export?year=2026&format=csv");
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="kilometerstand-2026.csv"');
    expect(csv.body).toContain("Januar 2026;1000;1000;0;1;");
    const txt = await app.inject("/api/odometer/year/export?year=2026&format=txt");
    expect(txt.body).toContain("Kilometerstand 2026");
    const xlsx = await app.inject("/api/odometer/year/export?year=2026&format=xlsx");
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe("PK");
    const bad = await app.inject("/api/odometer/year/export?format=pdf");
    expect(bad.statusCode).toBe(400);
  });

  it("meldet 404 für die Jahresübersicht, solange es keine Kilometerstände gibt", async () => {
    const res = await setup().inject("/api/odometer/year");
    expect(res.statusCode).toBe(404);
  });
});
